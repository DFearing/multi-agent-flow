/**
 * Shared simulation manager: owns one rAF loop driving N session sub-states.
 *
 * Each session gets its own physics instance and event pipeline, but they all
 * tick in the same requestAnimationFrame callback. This eliminates the O(N)
 * rAF + physics overhead that the per-session `useAgentSimulation` hook
 * created.
 *
 * React components subscribe via `useSyncExternalStore` — the manager emits
 * notifications only when a session's structural state changes (new events
 * processed), not on every animation tick.
 */

import type {
  Agent,
  ToolCallNode,
  Edge,
  SimulationEvent,
} from '@/lib/agent-types'
import { MOCK_SCENARIO } from '@/lib/mock-scenario'
import {
  TOOL_CARD_W,
  TOOL_CARD_H,
  TOOL_SLOT,
  BUBBLE_VISIBLE_S,
  MODEL_FAMILY_CONTEXT,
  DEFAULT_CONTEXT_SIZE,
  FALLBACK_CONTEXT_SIZE,
  ANIM_SPEED,
} from '@/lib/canvas-constants'

import type { SimulationState } from '@/hooks/simulation/types'
import { createEmptyState, MAX_EVENT_LOG } from '@/hooks/simulation/types'
import { processEvent, type ProcessEventContext } from '@/hooks/simulation/process-event'
import { computeNextFrame } from '@/hooks/simulation/animate'
import { snapVisualState } from '@/hooks/simulation/snap-visual-state'
import {
  createPhysicsState,
  syncPhysics,
  pinNode,
  tickPhysics,
  type PhysicsState,
} from '@/hooks/simulation/physics'
import { RingBuffer } from '@/lib/ring-buffer'
import { PositionBuffer } from '@/lib/position-buffer'

// ── Constants ──────────────────────────────────────────────────────────────

/** ms between React state notifications — canvas uses frameRef for smooth 60fps */
const UI_THROTTLE_MS = 250

/** Maximum ms of event processing allowed per animation frame per session. */
const INGEST_BUDGET_MS = 5

// ── Per-session sub-state ──────────────────────────────────────────────────

interface SessionSubState {
  /** Mutable simulation state — updated every animation frame. */
  frameState: SimulationState
  /** Physics solver for this session. */
  physics: PhysicsState
  /** Typed-array position buffer — eliminates per-frame agent object
   *  allocations during drag and physics ticks. */
  positions: PositionBuffer
  /** Monotonic block-id counter for timeline entries. */
  blockIdCounter: number
  /** Deferred events from the previous frame (time-slicing). */
  deferredEvents: SimulationEvent[]
  /** Last wall-clock time an event was ingested (for throttling UI). */
  lastUINotifyTimestamp: number
  /** Set by handlers when topology changes; sync runs once per frame. */
  forceSyncDirty: boolean
  /** Skip force sync during seek replay. */
  skipForceSync: boolean
  /** External events queued for this session. */
  pendingEvents: SimulationEvent[]
  /** Disable 1M context window. */
  disable1MContext: boolean
}

// ── Listener type ──────────────────────────────────────────────────────────

type Listener = () => void

// ── SimulationManager ──────────────────────────────────────────────────────

export interface SimulationManager {
  // ── Session lifecycle ───────────────────────────────────────────────────
  /** Register a new session. If it already exists, this is a no-op. */
  addSession(sessionId: string, opts?: { disable1MContext?: boolean }): void
  /** Remove a session and clean up its state. */
  removeSession(sessionId: string): void
  /** Check whether a session is registered. */
  hasSession(sessionId: string): boolean

  // ── Event ingestion ─────────────────────────────────────────────────────
  /** Queue external events for a session. They'll be processed next frame. */
  pushEvents(sessionId: string, events: readonly SimulationEvent[]): void

  // ── Per-session frame ref ───────────────────────────────────────────────
  /** Get the latest simulation state for a session (read every render frame). */
  getSessionState(sessionId: string): SimulationState
  /** Get all session IDs currently registered. */
  getSessionIds(): string[]

  // ── Per-session controls ────────────────────────────────────────────────
  play(sessionId: string): void
  pause(sessionId: string): void
  setSpeed(sessionId: string, speed: number): void
  seekToTime(sessionId: string, targetTime: number): void
  restart(sessionId: string, keepActive?: boolean): void
  updateAgentPosition(sessionId: string, agentId: string, x: number, y: number): void
  saveSnapshot(sessionId: string): { simState: SimulationState; blockId: number }
  restoreSnapshot(sessionId: string, snapshot: { simState: SimulationState; blockId: number }): void

  // ── Subscriptions (useSyncExternalStore compatible) ──────────────────────
  /** Subscribe to changes for a specific session. The listener fires when
   *  structural state changes (new events processed), not every frame. */
  subscribe(sessionId: string, listener: Listener): () => void
  /** Get the snapshot version for a session (bumps on every structural change). */
  getSnapshotVersion(sessionId: string): number

  // ── Lifecycle ───────────────────────────────────────────────────────────
  /** Start the shared rAF loop. Called once on mount. */
  start(): void
  /** Stop the shared rAF loop and clean up. */
  destroy(): void
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createSimulationManager(): SimulationManager {
  const sessions = new Map<string, SessionSubState>()
  const listeners = new Map<string, Set<Listener>>()
  const snapshotVersions = new Map<string, number>()

  let rafId = 0
  let lastTimestamp = 0
  let running = false

  // ── Helpers ─────────────────────────────────────────────────────────────

  function notifyListeners(sessionId: string): void {
    const version = (snapshotVersions.get(sessionId) ?? 0) + 1
    snapshotVersions.set(sessionId, version)
    const set = listeners.get(sessionId)
    if (set) {
      for (const l of set) l()
    }
  }

  function findToolSlot(
    agent: Agent,
    agents: Map<string, Agent>,
    toolCalls: Map<string, ToolCallNode>,
    currentTime: number,
  ): { x: number; y: number } {
    const visibleBubbles = agent.messageBubbles.filter(
      (b) => currentTime - b.time <= BUBBLE_VISIBLE_S,
    )
    const bubbleRect =
      visibleBubbles.length > 0
        ? {
            x1: agent.x + 30,
            y1: agent.y - 30,
            x2: agent.x + 300,
            y2: agent.y - 20 + visibleBubbles.length * 60 + 20,
          }
        : null

    const overlaps = (cx: number, cy: number) => {
      if (
        bubbleRect &&
        cx + TOOL_CARD_W / 2 > bubbleRect.x1 &&
        cx - TOOL_CARD_W / 2 < bubbleRect.x2 &&
        cy + TOOL_CARD_H / 2 > bubbleRect.y1 &&
        cy - TOOL_CARD_H / 2 < bubbleRect.y2
      )
        return true
      for (const tc of toolCalls.values()) {
        if (Math.abs(cx - tc.x) < TOOL_CARD_W && Math.abs(cy - tc.y) < TOOL_CARD_H)
          return true
      }
      return false
    }

    let outAngle = -Math.PI / 2
    if (agent.parentId) {
      const parent = agents.get(agent.parentId)
      if (parent) {
        outAngle = Math.atan2(agent.y - parent.y, agent.x - parent.x)
      }
    }

    for (let ring = 1; ring <= TOOL_SLOT.maxRings; ring++) {
      const dist = TOOL_SLOT.baseDistance + ring * TOOL_SLOT.ringIncrement
      const steps = TOOL_SLOT.baseSteps + ring * TOOL_SLOT.stepsPerRing
      for (let i = 0; i < steps; i++) {
        const sweep = (i / (steps - 1) - 0.5) * Math.PI
        const angle = outAngle + sweep
        const cx = agent.x + Math.cos(angle) * dist
        const cy = agent.y + Math.sin(angle) * dist
        if (!overlaps(cx, cy)) return { x: cx, y: cy }
      }
    }
    return {
      x: agent.x + Math.cos(outAngle) * TOOL_SLOT.fallbackDistance,
      y: agent.y + Math.sin(outAngle) * TOOL_SLOT.fallbackDistance,
    }
  }

  function getContextWindowSize(disable1MContext: boolean, modelId?: string): number {
    if (!modelId)
      return disable1MContext ? DEFAULT_CONTEXT_SIZE : FALLBACK_CONTEXT_SIZE
    const id = modelId.toLowerCase()
    for (const { pattern, size } of MODEL_FAMILY_CONTEXT) {
      if (pattern.test(id))
        return disable1MContext ? Math.min(size, DEFAULT_CONTEXT_SIZE) : size
    }
    return DEFAULT_CONTEXT_SIZE
  }

  function makeProcessCtx(sub: SessionSubState): ProcessEventContext {
    return {
      syncForceSimulation: (agents, edges) => {
        syncPhysics(sub.physics, agents, edges)
      },
      markForceSyncDirty: () => {
        sub.forceSyncDirty = true
      },
      findToolSlot,
      getContextWindowSize: (modelId?: string) =>
        getContextWindowSize(sub.disable1MContext, modelId),
      blockIdCounter: { current: sub.blockIdCounter },
      skipForceSync: sub.skipForceSync,
    }
  }

  function processEventForSession(
    event: SimulationEvent,
    prev: SimulationState,
    sub: SessionSubState,
  ): SimulationState {
    const ctx = makeProcessCtx(sub)
    const result = processEvent(event, prev, ctx)
    // Read back the blockIdCounter in case it was incremented.
    sub.blockIdCounter = ctx.blockIdCounter.current
    return result
  }

  // ── Position buffer sync ─────────────────────────────────────────────

  /** Ensure every agent in the map has a slot in the position buffer. */
  function syncPositionBuffer(sub: SessionSubState): void {
    const buf = sub.positions
    for (const [id, agent] of sub.frameState.agents) {
      if (buf.indexOf(id) === undefined) {
        buf.register(id, agent.x, agent.y, agent.vx ?? 0, agent.vy ?? 0)
      }
    }
  }

  /** Write physics node positions back to agents via in-place mutation.
   *  Returns true if any agent moved >0.1 px. No new Map or agent objects
   *  are allocated — positions are mutated directly on the mutable
   *  frameState agents between React commits. */
  function applyPhysicsPositionsInPlace(sub: SessionSubState): boolean {
    const { physics, positions } = sub
    const agents = sub.frameState.agents
    let anyMoved = false

    for (const node of physics.nodes.values()) {
      const agent = agents.get(node.id)
      if (!agent || agent.pinned) continue
      if (Math.abs(agent.x - node.x) > 0.1 || Math.abs(agent.y - node.y) > 0.1) {
        anyMoved = true
        // Mutate in place — no spread allocation. Safe because frameState
        // is the mutable per-frame state; React only sees committed snapshots.
        ;(agent as { x: number; y: number }).x = node.x
        ;(agent as { x: number; y: number }).y = node.y

        // Keep position buffer in sync
        const idx = positions.indexOf(node.id)
        if (idx !== undefined) {
          positions.setPosition(idx, node.x, node.y)
          positions.setVelocity(idx, node.vx, node.vy)
        }
      }
    }

    return anyMoved
  }

  // ── Commit snapshot: produce immutable copy for React ───────────────────

  function commitSnapshot(state: SimulationState): SimulationState {
    return { ...state, eventLog: state.eventLog.clone() }
  }

  // ── Per-session tick ────────────────────────────────────────────────────

  function tickSession(
    sessionId: string,
    sub: SessionSubState,
    timestamp: number,
    deltaTime: number,
  ): void {
    const prev = sub.frameState
    if (!prev.isPlaying) return

    let newTime = prev.currentTime + deltaTime * prev.speed
    let maxT = Math.max(prev.maxTimeReached, newTime)
    let newEventIndex = prev.eventIndex

    let currentState = prev
    let hadNewEvents = false
    const ingestStart = performance.now()

    // Process deferred events from the previous frame first.
    if (sub.deferredEvents.length > 0) {
      const deferred = sub.deferredEvents
      sub.deferredEvents = []
      let i = 0
      for (; i < deferred.length; i++) {
        if (performance.now() - ingestStart > INGEST_BUDGET_MS) break
        const event = deferred[i]
        const eventTime = Math.max(event.time || newTime, newTime)
        const timedEvent = { ...event, time: eventTime }
        currentState = { ...currentState, currentTime: eventTime }
        currentState = processEventForSession(timedEvent, currentState, sub)
        currentState.eventLog.push(timedEvent)
        hadNewEvents = true
      }
      if (i < deferred.length) {
        sub.deferredEvents = deferred.slice(i)
      }
    }

    // Process pending external events.
    if (sub.pendingEvents.length > 0) {
      const pending = sub.pendingEvents
      sub.pendingEvents = []
      let i = 0
      for (; i < pending.length; i++) {
        if (performance.now() - ingestStart > INGEST_BUDGET_MS) break
        const event = pending[i]
        const eventTime = Math.max(event.time || newTime, newTime)
        const timedEvent = { ...event, time: eventTime }
        currentState = { ...currentState, currentTime: eventTime }
        currentState = processEventForSession(timedEvent, currentState, sub)
        currentState.eventLog.push(timedEvent)
        hadNewEvents = true
      }
      if (i < pending.length) {
        sub.deferredEvents = sub.deferredEvents.concat(pending.slice(i))
      }
    }

    // Sync event index to ring buffer length in live mode.
    if (hadNewEvents) {
      newEventIndex = currentState.eventLog.length
    }

    newTime = Math.max(newTime, currentState.currentTime)
    maxT = Math.max(maxT, newTime)

    currentState = { ...currentState, eventIndex: newEventIndex }

    const result = computeNextFrame(prev, deltaTime, newTime, maxT, currentState, {
      useMockData: false,
      mockScenarioLength: 0,
      mockScenarioEndTime: 0,
    })

    sub.frameState = result

    // Coalesced physics resync.
    if (sub.forceSyncDirty) {
      sub.forceSyncDirty = false
      syncPhysics(sub.physics, result.agents, result.edges)
    }

    // Sync position buffer with any newly spawned agents.
    syncPositionBuffer(sub)

    // Physics tick — write positions back in place (zero allocations).
    if (!sub.physics.settled) {
      tickPhysics(sub.physics)
      applyPhysicsPositionsInPlace(sub)
    }

    // Throttle React notifications to ~4/sec.
    if (hadNewEvents) {
      if (
        !sub.lastUINotifyTimestamp ||
        timestamp - sub.lastUINotifyTimestamp >= UI_THROTTLE_MS
      ) {
        sub.lastUINotifyTimestamp = timestamp
        sub.frameState = commitSnapshot(sub.frameState)
        notifyListeners(sessionId)
      }
    }
  }

  // ── Shared rAF loop ─────────────────────────────────────────────────────

  function loop(timestamp: number): void {
    if (!running) return

    const elapsed = timestamp - lastTimestamp
    if (lastTimestamp && elapsed < ANIM_SPEED.minFrameInterval) {
      rafId = requestAnimationFrame(loop)
      return
    }

    if (!lastTimestamp) lastTimestamp = timestamp
    const deltaTime = Math.min(
      (timestamp - lastTimestamp) / 1000,
      ANIM_SPEED.maxDeltaTime,
    )
    lastTimestamp = timestamp

    for (const [sessionId, sub] of sessions) {
      tickSession(sessionId, sub, timestamp, deltaTime)
    }

    rafId = requestAnimationFrame(loop)
  }

  // ── Public API ──────────────────────────────────────────────────────────

  function createSubState(opts?: { disable1MContext?: boolean }): SessionSubState {
    return {
      frameState: createEmptyState({ isPlaying: true }),
      physics: createPhysicsState(),
      positions: new PositionBuffer(),
      blockIdCounter: 0,
      deferredEvents: [],
      lastUINotifyTimestamp: 0,
      forceSyncDirty: false,
      skipForceSync: false,
      pendingEvents: [],
      disable1MContext: opts?.disable1MContext ?? false,
    }
  }

  const manager: SimulationManager = {
    addSession(sessionId, opts) {
      if (sessions.has(sessionId)) return
      sessions.set(sessionId, createSubState(opts))
      listeners.set(sessionId, new Set())
      snapshotVersions.set(sessionId, 0)
    },

    removeSession(sessionId) {
      sessions.delete(sessionId)
      listeners.delete(sessionId)
      snapshotVersions.delete(sessionId)
    },

    hasSession(sessionId) {
      return sessions.has(sessionId)
    },

    pushEvents(sessionId, events) {
      const sub = sessions.get(sessionId)
      if (!sub) return
      for (const e of events) {
        sub.pendingEvents.push(e)
      }
    },

    getSessionState(sessionId) {
      const sub = sessions.get(sessionId)
      if (!sub) return createEmptyState()
      return sub.frameState
    },

    getSessionIds() {
      return Array.from(sessions.keys())
    },

    play(sessionId) {
      const sub = sessions.get(sessionId)
      if (!sub) return
      sub.frameState = { ...sub.frameState, isPlaying: true }
      notifyListeners(sessionId)
    },

    pause(sessionId) {
      const sub = sessions.get(sessionId)
      if (!sub) return
      sub.frameState = { ...sub.frameState, isPlaying: false }
      notifyListeners(sessionId)
    },

    setSpeed(sessionId, speed) {
      const sub = sessions.get(sessionId)
      if (!sub) return
      sub.frameState = { ...sub.frameState, speed }
    },

    seekToTime(sessionId, targetTime) {
      const sub = sessions.get(sessionId)
      if (!sub) return

      sub.positions.clear()
      const prev = sub.frameState
      const events = prev.eventLog.toArray()

      let replayState = createEmptyState({
        speed: prev.speed,
        eventLog: prev.eventLog.clone(),
        maxTimeReached: prev.maxTimeReached,
      })

      sub.skipForceSync = true
      sub.blockIdCounter = 0
      let newEventIndex = 0
      for (const event of events) {
        if (event.time > targetTime) break
        replayState.currentTime = event.time
        replayState = {
          ...processEventForSession(event, replayState, sub),
          currentTime: event.time,
        }
        newEventIndex++
      }
      sub.skipForceSync = false

      replayState = snapVisualState(replayState, targetTime)
      replayState.currentTime = targetTime
      replayState.eventIndex = newEventIndex

      sub.frameState = replayState
      syncPhysics(sub.physics, replayState.agents, replayState.edges)
      notifyListeners(sessionId)
    },

    restart(sessionId, keepActive = false) {
      const sub = sessions.get(sessionId)
      if (!sub) return

      sub.blockIdCounter = 0
      sub.positions.clear()

      if (!keepActive) {
        sub.frameState = createEmptyState({
          isPlaying: true,
          speed: sub.frameState.speed,
        })
        syncPhysics(sub.physics, sub.frameState.agents, sub.frameState.edges)
        notifyListeners(sessionId)
        return
      }

      // Keep active agents but clear completed state
      const prev = sub.frameState
      const agents = new Map<string, Agent>()
      for (const [id, agent] of prev.agents) {
        if (agent.state !== 'complete') {
          agents.set(id, {
            ...agent,
            toolCalls: 0,
            messageBubbles: [],
            timeAlive: 0,
          })
        }
      }

      const edges = prev.edges.filter(
        (e) =>
          e.type === 'parent-child' && agents.has(e.from) && agents.has(e.to),
      )

      const timelineEntries = new Map(prev.timelineEntries)
      for (const [id, entry] of timelineEntries) {
        if (!agents.has(id)) {
          timelineEntries.delete(id)
        } else {
          timelineEntries.set(id, { ...entry, blocks: [] })
        }
      }

      const conversations: SimulationState['conversations'] = new Map()
      for (const id of agents.keys()) conversations.set(id, [])

      const eventLog = new RingBuffer<SimulationEvent>(MAX_EVENT_LOG)
      for (const e of prev.eventLog) {
        if (
          e.type === 'agent_spawn' &&
          agents.has(e.payload?.name as string)
        ) {
          eventLog.push(e)
        }
      }

      const next = {
        ...createEmptyState({ isPlaying: true, speed: prev.speed }),
        agents,
        edges,
        timelineEntries,
        conversations,
        eventLog,
        eventIndex: eventLog.length,
      }
      sub.frameState = next
      syncPhysics(sub.physics, next.agents, next.edges)
      notifyListeners(sessionId)
    },

    updateAgentPosition(sessionId, agentId, x, y) {
      const sub = sessions.get(sessionId)
      if (!sub) return

      // Mutate the agent's position in place — no Map clone, no object
      // spread. Safe because frameState is the mutable per-frame state;
      // React only sees committed snapshots.
      const agent = sub.frameState.agents.get(agentId)
      if (agent) {
        ;(agent as { x: number; y: number; pinned: boolean }).x = x
        ;(agent as { x: number; y: number; pinned: boolean }).y = y
        ;(agent as { x: number; y: number; pinned: boolean }).pinned = true
      }

      // Write directly to the typed-array position buffer.
      const idx = sub.positions.indexOf(agentId)
      if (idx !== undefined) {
        sub.positions.setPosition(idx, x, y)
        sub.positions.setVelocity(idx, 0, 0)
      }

      pinNode(sub.physics, agentId, x, y)
    },

    saveSnapshot(sessionId) {
      const sub = sessions.get(sessionId)
      if (!sub)
        return {
          simState: createEmptyState(),
          blockId: 0,
        }
      return {
        simState: commitSnapshot(sub.frameState),
        blockId: sub.blockIdCounter,
      }
    },

    restoreSnapshot(sessionId, snapshot) {
      const sub = sessions.get(sessionId)
      if (!sub) return

      sub.blockIdCounter = snapshot.blockId
      sub.positions.clear()
      const restored = {
        ...snapshot.simState,
        isPlaying: true,
        eventLog: snapshot.simState.eventLog.clone(),
      }
      sub.frameState = restored
      syncPhysics(sub.physics, restored.agents, restored.edges)
      notifyListeners(sessionId)
    },

    subscribe(sessionId, listener) {
      let set = listeners.get(sessionId)
      if (!set) {
        set = new Set()
        listeners.set(sessionId, set)
      }
      set.add(listener)
      return () => {
        set!.delete(listener)
      }
    },

    getSnapshotVersion(sessionId) {
      return snapshotVersions.get(sessionId) ?? 0
    },

    start() {
      if (running) return
      running = true
      lastTimestamp = 0
      rafId = requestAnimationFrame(loop)
    },

    destroy() {
      running = false
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
    },
  }

  return manager
}
