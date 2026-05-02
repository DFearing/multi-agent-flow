'use client'

import { useEffect, useRef, useState } from 'react'
import { useAgentSimulation } from '@/hooks/use-agent-simulation'
import { usePanelLayout } from '@/hooks/use-panel-layout'
import { AgentCanvas } from './canvas'
import { FloatingPanel } from './floating-panel'
import { useSessionStats } from './session-stats-provider'
import type { SimulationEvent } from '@/lib/agent-types'

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
}: SessionCanvasPanelProps) {
  const panelId = `canvas-slot-${slot}` as const
  // Local cursor over the bridge's per-session event log.
  const consumedRef = useRef(0)
  const log = getSessionEventLog(sessionId)
  const sliceEnd = log.length
  const newEvents = log.slice(consumedRef.current, sliceEnd) as SimulationEvent[]

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

  // Publish this session's agents/toolCalls so the cost-summary panel (and any
  // future cross-session aggregators) can read them.
  const { setSessionStats, removeSessionStats } = useSessionStats()
  useEffect(() => {
    setSessionStats(sessionId, { agents: sim.agents, toolCalls: sim.toolCalls })
  }, [sessionId, sim.agents, sim.toolCalls, setSessionStats])
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
      title={sessionLabel}
      noContentZoom
    >
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <AgentCanvas
          simulationRef={sim.frameRef}
          sessionId={sessionId}
          selectedAgentId={selectedAgentId}
          hoveredAgentId={hoveredAgentId}
          showStats={showStats}
          showHexGrid={showHexGrid}
          zoomToFitTrigger={zoomToFitTrigger}
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
    </FloatingPanel>
  )
}
