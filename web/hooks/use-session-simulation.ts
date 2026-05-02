/**
 * Per-session simulation subscription hook.
 *
 * `useSessionSimulation(sessionId)` returns the same shape as the old
 * `useAgentSimulation` so call-sites can migrate cleanly. Internally it
 * subscribes to the shared `SimulationManager` — no rAF, no physics, no
 * event processing inside the hook.
 */

'use client'

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { SimulationEvent } from '@/lib/agent-types'
import type { SimulationState } from './simulation/types'
import { createEmptyState } from './simulation/types'
import type { SimulationManager } from '@/lib/simulation-manager'

// ── Return type (matches useAgentSimulation's return shape) ────────────────

export interface SessionSimulationResult {
  /** Ref-like accessor to the latest simulation state. Canvas reads this
   *  every frame without React re-renders. */
  frameRef: { readonly current: SimulationState }
  /** React state slices (updated at ~4 Hz via useSyncExternalStore). */
  agents: SimulationState['agents']
  toolCalls: SimulationState['toolCalls']
  particles: SimulationState['particles']
  edges: SimulationState['edges']
  discoveries: SimulationState['discoveries']
  fileAttention: SimulationState['fileAttention']
  timelineEntries: SimulationState['timelineEntries']
  currentTime: number
  isPlaying: boolean
  speed: number
  maxTimeReached: number
  conversations: SimulationState['conversations']
  // Controls
  play: () => void
  pause: () => void
  restart: (keepActive?: boolean) => void
  setSpeed: (speed: number) => void
  seekToTime: (targetTime: number) => void
  updateAgentPosition: (agentId: string, x: number, y: number) => void
  saveSnapshot: () => { simState: SimulationState; blockId: number }
  restoreSnapshot: (snapshot: { simState: SimulationState; blockId: number }) => void
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useSessionSimulation(
  manager: SimulationManager,
  sessionId: string,
  opts?: {
    /** External events to push into the session each render cycle. */
    externalEvents?: readonly SimulationEvent[]
    /** Called after external events are consumed. */
    onExternalEventsConsumed?: () => void
    /** If true, cap context window to 200k. */
    disable1MContext?: boolean
  },
): SessionSimulationResult {
  const { externalEvents, onExternalEventsConsumed, disable1MContext } = opts ?? {}

  // Ensure session is registered.
  useEffect(() => {
    if (!manager.hasSession(sessionId)) {
      manager.addSession(sessionId, { disable1MContext })
    }
  }, [manager, sessionId, disable1MContext])

  // Push external events into the manager.
  const consumedRef = useRef(false)
  useEffect(() => {
    if (externalEvents && externalEvents.length > 0) {
      manager.pushEvents(sessionId, externalEvents)
      consumedRef.current = true
    }
  }, [manager, sessionId, externalEvents])

  // Notify consumer after events are pushed.
  useEffect(() => {
    if (consumedRef.current) {
      consumedRef.current = false
      onExternalEventsConsumed?.()
    }
  })

  // Subscribe to the manager's session notifications via useSyncExternalStore.
  const subscribe = useCallback(
    (listener: () => void) => manager.subscribe(sessionId, listener),
    [manager, sessionId],
  )

  const getSnapshot = useCallback(
    () => manager.getSnapshotVersion(sessionId),
    [manager, sessionId],
  )

  // This triggers a re-render only when the session's snapshot version bumps.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Read the latest state from the manager. Since useSyncExternalStore above
  // re-renders us on version bumps, the state we read here is always fresh.
  const state = manager.getSessionState(sessionId)

  // Build a stable ref-like object that always points at the latest state.
  // Canvas reads `frameRef.current` on every draw frame.
  const frameRef = useMemo(() => {
    return {
      get current(): SimulationState {
        return manager.getSessionState(sessionId)
      },
    }
  }, [manager, sessionId])

  // Stable control callbacks.
  const play = useCallback(() => manager.play(sessionId), [manager, sessionId])
  const pause = useCallback(() => manager.pause(sessionId), [manager, sessionId])
  const restart = useCallback(
    (keepActive?: boolean) => manager.restart(sessionId, keepActive),
    [manager, sessionId],
  )
  const setSpeed = useCallback(
    (speed: number) => manager.setSpeed(sessionId, speed),
    [manager, sessionId],
  )
  const seekToTime = useCallback(
    (targetTime: number) => manager.seekToTime(sessionId, targetTime),
    [manager, sessionId],
  )
  const updateAgentPosition = useCallback(
    (agentId: string, x: number, y: number) =>
      manager.updateAgentPosition(sessionId, agentId, x, y),
    [manager, sessionId],
  )
  const saveSnapshot = useCallback(
    () => manager.saveSnapshot(sessionId),
    [manager, sessionId],
  )
  const restoreSnapshot = useCallback(
    (snapshot: { simState: SimulationState; blockId: number }) =>
      manager.restoreSnapshot(sessionId, snapshot),
    [manager, sessionId],
  )

  return {
    frameRef,
    agents: state.agents,
    toolCalls: state.toolCalls,
    particles: state.particles,
    edges: state.edges,
    discoveries: state.discoveries,
    fileAttention: state.fileAttention,
    timelineEntries: state.timelineEntries,
    currentTime: state.currentTime,
    isPlaying: state.isPlaying,
    speed: state.speed,
    maxTimeReached: state.maxTimeReached,
    conversations: state.conversations,
    play,
    pause,
    restart,
    setSpeed,
    seekToTime,
    updateAgentPosition,
    saveSnapshot,
    restoreSnapshot,
  }
}
