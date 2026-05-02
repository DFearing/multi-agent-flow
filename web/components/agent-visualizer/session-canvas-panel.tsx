'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSessionSimulation } from '@/hooks/use-session-simulation'
import { useSimulationManager } from './simulation-manager-provider'
import { useFrameRefSelector } from '@/hooks/use-frame-ref-selector'
import type { SimulationState } from '@/hooks/simulation/types'
import { usePanelLayout } from '@/hooks/use-panel-layout'
import { useSessionNames } from '@/hooks/use-session-names'
import { usePersistedState } from '@/hooks/use-persisted-state'
import { colorForSession } from '@/lib/colors'
import { AgentCanvas } from './canvas'
import { PixiCanvas } from './pixi/pixi-canvas'
import { ControlBar } from './control-bar'
import { FloatingPanel } from './floating-panel'
import { CanvasZoomControl } from './canvas-zoom-control'
import { useSessionStatsDispatch, type SessionStats } from './session-stats-provider'
import { TIMING, type SimulationEvent, type TimelineEvent } from '@/lib/agent-types'
import type { EffectToggles } from '@/hooks/use-perf-settings'

import { IS_PIXI_RENDERER as USE_PIXI_RENDERER } from '@/lib/renderer-mode'

/** Stable empty-events sentinel — keeps the externalEvents prop reference
 *  identical across idle renders so useAgentSimulation's animate callback
 *  doesn't get rebuilt for nothing. */
const EMPTY_EVENTS: readonly SimulationEvent[] = []

/** Minimum gap (ms) between SessionStats publishes. Publishing is now
 *  event-driven (triggers when sim map references change) rather than
 *  polling at a fixed 1 Hz cadence. This constant rate-limits the
 *  worst-case burst rate so subscribers don't churn during rapid-fire
 *  event replay. */
const STATS_MIN_INTERVAL_MS = 1000

// Per-session canvas panel: each session gets its own simulation + draggable
// FloatingPanel containing an AgentCanvas. Events for the session are pulled
// from the bridge's per-session event log via a local cursor.

interface SessionCanvasPanelProps {
  sessionId: string
  sessionLabel: string
  slot: number
  selectedAgentId: string | null
  hoveredAgentId: string | null
  selectedToolCallId: string | null
  selectedDiscoveryId: string | null
  showStats: boolean
  showHexGrid: boolean
  showCostOverlay: boolean
  effects: EffectToggles
  zoomToFitTrigger: number
  pauseAutoFit: boolean
  getSessionEventLog: (sessionId: string) => readonly SimulationEvent[]
  onAgentClick: (agentId: string | null, sessionId: string) => void
  onAgentHover: (agentId: string | null) => void
  onContextMenu: (e: React.MouseEvent, type: 'agent' | 'edge' | 'canvas', id?: string) => void
  onToolCallClick?: (toolCallId: string | null) => void
  onDiscoveryClick?: (discoveryId: string | null) => void
  /** Called with the panel's sessionId so the parent can use one stable
   *  callback instead of allocating a new arrow per panel per render. */
  onClose?: (sessionId: string) => void
}

function SessionCanvasPanelImpl({
  sessionId,
  sessionLabel,
  slot,
  selectedAgentId, hoveredAgentId, selectedToolCallId, selectedDiscoveryId,
  showStats, showHexGrid, showCostOverlay, effects,
  zoomToFitTrigger, pauseAutoFit,
  getSessionEventLog,
  onAgentClick, onAgentHover,
  onContextMenu, onToolCallClick, onDiscoveryClick,
  onClose,
}: SessionCanvasPanelProps) {
  const panelId = `canvas-slot-${slot}` as const
  const manager = useSimulationManager()
  const consumedRef = useRef(0)
  const log = getSessionEventLog(sessionId)
  const sliceEnd = log.length
  const newEvents: readonly SimulationEvent[] = consumedRef.current < sliceEnd
    ? (log.slice(consumedRef.current, sliceEnd) as SimulationEvent[])
    : EMPTY_EVENTS

  const sim = useSessionSimulation(manager, sessionId, {
    externalEvents: newEvents,
    onExternalEventsConsumed: () => { consumedRef.current = sliceEnd },
  })

  useEffect(() => {
    sim.play()
  }, [sim.play])

  // Stabilize the FloatingPanel close callback so React.memo on this
  // component isn't defeated by parents passing a fresh arrow each render.
  const handleClose = useCallback(() => onClose?.(sessionId), [onClose, sessionId])

  const { setSessionStats, removeSessionStats } = useSessionStatsDispatch()

  const latestStatsRef = useRef<SessionStats>({
    agents: sim.agents,
    toolCalls: sim.toolCalls,
    conversations: sim.conversations,
  })
  latestStatsRef.current = {
    agents: sim.agents,
    toolCalls: sim.toolCalls,
    conversations: sim.conversations,
  }

  // Event-driven publish: fire whenever the sim map references actually
  // change, rate-limited to STATS_MIN_INTERVAL_MS so burst replays don't
  // churn subscribers.
  const lastPublishRef = useRef(0)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const stats = latestStatsRef.current
    const now = Date.now()
    const elapsed = now - lastPublishRef.current

    if (elapsed >= STATS_MIN_INTERVAL_MS) {
      if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null }
      lastPublishRef.current = now
      setSessionStats(sessionId, stats)
    } else if (!pendingTimerRef.current) {
      const delay = STATS_MIN_INTERVAL_MS - elapsed
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null
        lastPublishRef.current = Date.now()
        setSessionStats(sessionId, latestStatsRef.current)
      }, delay)
    }
  }, [sessionId, setSessionStats, sim.agents, sim.toolCalls, sim.conversations])

  useEffect(() => () => {
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
  }, [])

  useEffect(() => {
    return () => removeSessionStats(sessionId)
  }, [sessionId, removeSessionStats])

  const [defaultRect] = useState(() => {
    if (typeof window === 'undefined') return { x: 80, y: 100, w: 720, h: 500 }
    const w = Math.min(720, window.innerWidth - 200)
    const h = Math.min(500, window.innerHeight - 200)
    const offset = ((slot - 1) % 6) * 32
    return { x: 60 + offset, y: 80 + offset, w, h }
  })

  const hadAgentsRef = useRef(false)
  if (sim.agents.size > 0) hadAgentsRef.current = true

  const { panels, bootedAsAttached, instanceId } = usePanelLayout()
  const explicitlyVisible = panels[panelId]?.hidden === false

  const [minZoomLevel, setMinZoomLevel] = usePersistedState<number>(
    `agent-flow:min-zoom:v1:${instanceId}:slot-${slot}`,
    0,
  )

  const sessionColor = colorForSession(sessionId)

  const { getName, setName } = useSessionNames()
  const displayTitle = getName(sessionId) ?? sessionLabel

  const [isReviewing, setIsReviewing] = useState(false)
  const [zoomToFitTick, setZoomToFitTick] = useState(0)

  const timelineCacheRef = useRef<{ counts: Map<string, number>; events: TimelineEvent[]; idCounter: number }>({
    counts: new Map(),
    events: [],
    idCounter: 0,
  })
  const timelineEvents = useMemo((): TimelineEvent[] => {
    const cache = timelineCacheRef.current
    let appended = false
    for (const [agentId, msgs] of sim.conversations) {
      const prevLen = cache.counts.get(agentId) ?? 0
      if (msgs.length > prevLen) {
        for (let i = prevLen; i < msgs.length; i++) {
          const msg = msgs[i]
          cache.events.push({
            id: `event-${cache.idCounter++}`,
            type: msg.type === 'tool_call' ? 'tool_call' : msg.type === 'tool_result' ? 'tool_result' : 'message',
            label: msg.content.slice(0, 20),
            timestamp: msg.timestamp,
            nodeId: agentId,
          })
        }
        cache.counts.set(agentId, msgs.length)
        appended = true
      }
    }
    if (appended) {
      cache.events.sort((a, b) => a.timestamp - b.timestamp)
      cache.events = cache.events.slice()
    }
    return cache.events
  }, [sim.conversations])

  // ControlBar reads via useFrameRefSelector — capped at ~4 Hz so the
  // chrome doesn't re-render at 60fps with the simulation's animation loop.
  const selectCurrentTime = useCallback((s: SimulationState) => s.currentTime, [])
  const selectIsPlaying = useCallback((s: SimulationState) => s.isPlaying, [])
  const selectSpeed = useCallback((s: SimulationState) => s.speed, [])
  const selectMaxTime = useCallback((s: SimulationState) => s.maxTimeReached, [])

  const frameCurrentTime = useFrameRefSelector(sim.frameRef, selectCurrentTime)
  const frameIsPlaying = useFrameRefSelector(sim.frameRef, selectIsPlaying)
  const frameSpeed = useFrameRefSelector(sim.frameRef, selectSpeed)
  const frameMaxTime = useFrameRefSelector(sim.frameRef, selectMaxTime)

  const simRef = useRef(sim)
  simRef.current = sim

  const handlePlayPause = useCallback(() => {
    const s = simRef.current
    if (s.isPlaying) {
      s.pause()
      setIsReviewing(true)
    } else {
      s.play()
    }
  }, [])

  const handleEnterReview = useCallback(() => {
    simRef.current.pause()
    setIsReviewing(true)
  }, [])

  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleResumeLive = useCallback(() => {
    const s = simRef.current
    setIsReviewing(false)
    s.seekToTime(s.maxTimeReached)
    setZoomToFitTick(n => n + 1)
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(
      () => { resumeTimerRef.current = null; simRef.current.play() },
      TIMING.resumeLiveDelayMs,
    )
  }, [])
  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current) }, [])

  const handleRestart = useCallback(() => {
    setIsReviewing(false)
    simRef.current.restart(true)
  }, [])

  const handleSeek = useCallback((time: number) => {
    const s = simRef.current
    s.pause()
    s.seekToTime(time)
    setZoomToFitTick(n => n + 1)
  }, [])

  const combinedZoomToFitTrigger = zoomToFitTrigger + zoomToFitTick

  if (bootedAsAttached && !explicitlyVisible) return null

  return (
    <FloatingPanel
      id={panelId}
      defaultRect={defaultRect}
      minW={320}
      minH={240}
      title={displayTitle}
      accentColor={sessionColor.accent}
      onTitleEdit={(next) => setName(sessionId, next)}
      onClose={onClose ? handleClose : undefined}
      noContentZoom
    >
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: sessionColor.tint }}>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {USE_PIXI_RENDERER ? (
            <PixiCanvas
              simulationRef={sim.frameRef}
              sessionId={sessionId}
              selectedAgentId={selectedAgentId}
              hoveredAgentId={hoveredAgentId}
              showStats={showStats}
              showHexGrid={showHexGrid}
              effects={effects}
              zoomToFitTrigger={combinedZoomToFitTrigger}
              pauseAutoFit={pauseAutoFit}
              onAgentClick={(id) => onAgentClick(id, sessionId)}
              onAgentHover={onAgentHover}
              onAgentDrag={sim.updateAgentPosition}
              onContextMenu={onContextMenu}
              onToolCallClick={onToolCallClick}
              selectedToolCallId={selectedToolCallId}
              onDiscoveryClick={onDiscoveryClick}
              selectedDiscoveryId={selectedDiscoveryId}
              showCostOverlay={showCostOverlay}
              minZoomLevel={minZoomLevel}
            />
          ) : (
            <AgentCanvas
              simulationRef={sim.frameRef}
              sessionId={sessionId}
              selectedAgentId={selectedAgentId}
              hoveredAgentId={hoveredAgentId}
              showStats={showStats}
              showHexGrid={showHexGrid}
              zoomToFitTrigger={combinedZoomToFitTrigger}
              pauseAutoFit={pauseAutoFit}
              onAgentClick={(id) => onAgentClick(id, sessionId)}
              onAgentHover={onAgentHover}
              onAgentDrag={sim.updateAgentPosition}
              onContextMenu={onContextMenu}
              onToolCallClick={onToolCallClick}
              selectedToolCallId={selectedToolCallId}
              onDiscoveryClick={onDiscoveryClick}
              selectedDiscoveryId={selectedDiscoveryId}
              showCostOverlay={showCostOverlay}
              minZoomLevel={minZoomLevel}
            />
          )}
          <CanvasZoomControl value={minZoomLevel} onChange={setMinZoomLevel} />
        </div>
        <ControlBar
          isPlaying={frameIsPlaying}
          speed={frameSpeed}
          currentTime={frameCurrentTime}
          totalDuration={Math.max(frameMaxTime, frameCurrentTime)}
          onPlayPause={handlePlayPause}
          onRestart={handleRestart}
          onSpeedChange={sim.setSpeed}
          onSeek={handleSeek}
          timelineEvents={timelineEvents}
          isReviewing={isReviewing}
          eventCount={timelineEvents.length}
          onEnterReview={handleEnterReview}
          onResumeLive={handleResumeLive}
        />
      </div>
    </FloatingPanel>
  )
}

// React.memo so SSE event-version bumps in the parent (which fan out to
// every panel via setEventVersion → AgentVisualizerInner re-render) don't
// re-render panels whose props haven't actually changed. The relevant
// changes for any one panel are: its own session's events (consumed via
// the externalEvents pipeline inside the impl), selection state, panel
// toggles, and resize triggers. All other parent re-renders should skip.
export const SessionCanvasPanel = memo(SessionCanvasPanelImpl)
