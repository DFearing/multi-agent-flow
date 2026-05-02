'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAgentSimulation } from '@/hooks/use-agent-simulation'
import { usePanelLayout } from '@/hooks/use-panel-layout'
import { useSessionNames } from '@/hooks/use-session-names'
import { colorForSession } from '@/lib/colors'
import { AgentCanvas } from './canvas'
import { ControlBar } from './control-bar'
import { FloatingPanel } from './floating-panel'
import { useSessionStatsDispatch, type SessionStats } from './session-stats-provider'
import { TIMING, type SimulationEvent, type TimelineEvent } from '@/lib/agent-types'

/** Stable empty-events sentinel — keeps the externalEvents prop reference
 *  identical across idle renders so useAgentSimulation's animate callback
 *  doesn't get rebuilt for nothing. */
const EMPTY_EVENTS: readonly SimulationEvent[] = []

/** ms between SessionStats publishes — caps the context cascade rate that
 *  re-renders every consumer of useSessionStats (feed panel, cost panel,
 *  top bar). The underlying simulation still advances every frame; this
 *  only affects the React-level summary updates. */
const STATS_PUBLISH_INTERVAL_MS = 1000

// Per-session canvas panel: each session gets its own simulation + draggable
// FloatingPanel containing an AgentCanvas. Events for the session are pulled
// from the bridge's per-session event log via a local cursor.

interface SessionCanvasPanelProps {
  sessionId: string
  sessionLabel: string
  /** Layout slot for this session. Each slot's rect is persisted under
   *  `canvas-slot-<slot>`, so positions are remembered by slot rather than
   *  by per-run session id (which changes every Claude Code restart). */
  slot: number
  selectedAgentId: string | null
  hoveredAgentId: string | null
  selectedToolCallId: string | null
  selectedDiscoveryId: string | null
  showStats: boolean
  showHexGrid: boolean
  showCostOverlay: boolean
  zoomToFitTrigger: number
  pauseAutoFit: boolean
  getSessionEventLog: (sessionId: string) => readonly SimulationEvent[]
  onAgentClick: (agentId: string | null, sessionId: string) => void
  onAgentHover: (agentId: string | null) => void
  onAgentDrag: (agentId: string, x: number, y: number) => void
  onContextMenu: (e: React.MouseEvent, type: 'agent' | 'edge' | 'canvas', id?: string) => void
  onToolCallClick?: (toolCallId: string | null) => void
  onDiscoveryClick?: (discoveryId: string | null) => void
  /** ✕-close handler. Parent persists the hidden state and shows a chip
   *  in the top bar so the canvas can be reopened. */
  onClose?: () => void
}

export function SessionCanvasPanel({
  sessionId,
  sessionLabel,
  slot,
  selectedAgentId, hoveredAgentId, selectedToolCallId, selectedDiscoveryId,
  showStats, showHexGrid, showCostOverlay,
  zoomToFitTrigger, pauseAutoFit,
  getSessionEventLog,
  onAgentClick, onAgentHover, onAgentDrag,
  onContextMenu, onToolCallClick, onDiscoveryClick,
  onClose,
}: SessionCanvasPanelProps) {
  const panelId = `canvas-slot-${slot}` as const
  // Local cursor over the bridge's per-session event log. Slice only when
  // there are actually new events so idle re-renders pass a stable empty
  // reference instead of allocating fresh arrays.
  const consumedRef = useRef(0)
  const log = getSessionEventLog(sessionId)
  const sliceEnd = log.length
  const newEvents: readonly SimulationEvent[] = consumedRef.current < sliceEnd
    ? (log.slice(consumedRef.current, sliceEnd) as SimulationEvent[])
    : EMPTY_EVENTS

  const sim = useAgentSimulation({
    useMockData: false,
    externalEvents: newEvents,
    onExternalEventsConsumed: () => { consumedRef.current = sliceEnd },
    sessionFilter: sessionId,
  })

  // Each per-session simulation defaults to isPlaying=false; if we don't kick
  // it on mount the animation loop early-returns and externalEvents are never
  // consumed (so agents never appear).
  useEffect(() => {
    sim.play()
  }, [sim.play])

  const { setSessionStats, removeSessionStats } = useSessionStatsDispatch()

  // Keep a ref to the latest sim collections so the throttled publisher can
  // read them without re-subscribing. Refs may be assigned during render —
  // this is the standard React pattern for "always read the latest value".
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

  // Publish on mount and once per STATS_PUBLISH_INTERVAL_MS thereafter. The
  // provider de-dupes by reference equality on each Map field, so an interval
  // tick where nothing changed is a no-op — we just cap the worst-case cascade
  // rate that re-renders every consumer of useSessionStats.
  useEffect(() => {
    setSessionStats(sessionId, latestStatsRef.current)
    const id = setInterval(
      () => setSessionStats(sessionId, latestStatsRef.current),
      STATS_PUBLISH_INTERVAL_MS,
    )
    return () => clearInterval(id)
  }, [sessionId, setSessionStats])

  useEffect(() => {
    return () => removeSessionStats(sessionId)
  }, [sessionId, removeSessionStats])

  // First-paint default position: stagger by slot so multiple session panels
  // don't pile up exactly on top of each other.
  const [defaultRect] = useState(() => {
    if (typeof window === 'undefined') return { x: 80, y: 100, w: 720, h: 500 }
    const w = Math.min(720, window.innerWidth - 200)
    const h = Math.min(500, window.innerHeight - 200)
    const offset = ((slot - 1) % 6) * 32
    return { x: 60 + offset, y: 80 + offset, w, h }
  })

  // Sticky: once this session has shown any agents in this browser session,
  // keep the panel mounted even if the current count drops to zero. Also bypass
  // the check entirely when this panel was explicitly made visible by a send
  // command from another instance (rect.hidden === false in the layout map).
  const hadAgentsRef = useRef(false)
  if (sim.agents.size > 0) hadAgentsRef.current = true

  const { panels, bootedAsAttached } = usePanelLayout()
  const explicitlyVisible = panels[panelId]?.hidden === false

  const sessionColor = colorForSession(sessionId)

  const { getName, setName } = useSessionNames()
  const displayTitle = getName(sessionId) ?? sessionLabel

  // ── Per-session control bar state ──────────────────────────────────────────
  // Each canvas drives its own play/pause/seek/review independently of the
  // others. Review mode pauses live updates so the user can scrub history.
  const [isReviewing, setIsReviewing] = useState(false)
  const [zoomToFitTick, setZoomToFitTick] = useState(0)

  // Build timeline event dots incrementally from this session's conversations.
  // Mirrors the global computation in index.tsx but scoped to one session.
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
    if (appended) cache.events.sort((a, b) => a.timestamp - b.timestamp)
    return cache.events
  }, [sim.conversations])

  const handlePlayPause = useCallback(() => {
    if (sim.isPlaying) {
      sim.pause()
      setIsReviewing(true)
    } else {
      sim.play()
    }
  }, [sim.isPlaying, sim.play, sim.pause])

  const handleEnterReview = useCallback(() => {
    sim.pause()
    setIsReviewing(true)
  }, [sim.pause])

  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleResumeLive = useCallback(() => {
    setIsReviewing(false)
    sim.seekToTime(sim.maxTimeReached)
    setZoomToFitTick(n => n + 1)
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(
      () => { resumeTimerRef.current = null; sim.play() },
      TIMING.resumeLiveDelayMs,
    )
  }, [sim.seekToTime, sim.maxTimeReached, sim.play])
  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current) }, [])

  const handleRestart = useCallback(() => {
    setIsReviewing(false)
    sim.restart(true)
  }, [sim.restart])

  const handleSeek = useCallback((time: number) => {
    sim.pause()
    sim.seekToTime(time)
    setZoomToFitTick(n => n + 1)
  }, [sim.pause, sim.seekToTime])

  // Combine the parent's zoom-to-fit trigger with this canvas's own (fired by
  // seek/resume) so both routes invalidate the canvas's auto-fit cache.
  const combinedZoomToFitTrigger = zoomToFitTrigger + zoomToFitTick

  // Fresh attach (`?host=<id>` with no `?session=`) starts blank: only show
  // canvas tiles that the host has explicitly sent over via `→`.
  if (bootedAsAttached && !explicitlyVisible) return null
  if (!hadAgentsRef.current && !explicitlyVisible) return null

  return (
    <FloatingPanel
      id={panelId}
      defaultRect={defaultRect}
      minW={320}
      minH={240}
      title={displayTitle}
      accentColor={sessionColor.accent}
      onTitleEdit={(next) => setName(sessionId, next)}
      onClose={onClose}
      noContentZoom
    >
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: sessionColor.tint }}>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
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
            onAgentDrag={onAgentDrag}
            onContextMenu={onContextMenu}
            onToolCallClick={onToolCallClick}
            selectedToolCallId={selectedToolCallId}
            onDiscoveryClick={onDiscoveryClick}
            selectedDiscoveryId={selectedDiscoveryId}
            showCostOverlay={showCostOverlay}
          />
        </div>
        <ControlBar
          isPlaying={sim.isPlaying}
          speed={sim.speed}
          currentTime={sim.currentTime}
          totalDuration={Math.max(sim.maxTimeReached, sim.currentTime)}
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
