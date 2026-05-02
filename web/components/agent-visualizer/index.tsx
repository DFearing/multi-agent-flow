"use client"

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react"
import { useAgentSimulation } from "@/hooks/use-agent-simulation"
import { useVSCodeBridge } from "@/hooks/use-vscode-bridge"
import { useSelectionState } from "@/hooks/use-selection-state"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { SessionCanvasPanel } from "./session-canvas-panel"
import { SessionStatsProvider } from "./session-stats-provider"
import { CostSummaryPanel } from "./cost-summary-panel"
import { AgentNamesProvider } from "@/hooks/use-agent-names"
import { ControlBar } from "./control-bar"
import { AgentDetailCard } from "./agent-detail-card"
import { GlassContextMenu } from "./glass-context-menu"
import { ToolDetailPopup } from "./tool-detail-popup"
import { DiscoveryDetailPopup } from "./discovery-detail-popup"
import { FileAttentionPanel } from "./file-attention-panel"
import { TimelinePanel } from "./timeline-panel"
import { AgentChatPanel } from "./chat-panel"
import { SessionTranscriptPanel } from "./session-transcript-panel"
import { OpenFileProvider } from "./tool-content-renderer"
import { stopPropagationHandlers } from "./shared-ui"
import { TimelineEvent, TIMING } from "@/lib/agent-types"
import { COLORS } from "@/lib/colors"

import { MOCK_DURATION } from "@/lib/mock-scenario"
import { MessageFeedPanel } from "./message-feed-panel"
import { TopBar } from "./top-bar"
import { useAudioEffects } from "@/hooks/use-audio-effects"
import { PanelLayoutProvider } from "./panel-layout-provider"
import { usePanelLayout } from "@/hooks/use-panel-layout"

export function AgentVisualizer() {
  return (
    <PanelLayoutProvider>
      <SessionStatsProvider>
        <AgentNamesProvider>
          <AgentVisualizerInner />
        </AgentNamesProvider>
      </SessionStatsProvider>
    </PanelLayoutProvider>
  )
}

function AgentVisualizerInner() {
  const bridge = useVSCodeBridge()
  const { resetLayout, instanceId, isFreshInstance, hostId, hostNotFound } = usePanelLayout()

  // Fade-out toast on mount: brief identifier on page load. Gated on a
  // useEffect-set flag so SSR (which doesn't know the real session id)
  // doesn't mismatch the client's first render.
  const [showInstanceToast, setShowInstanceToast] = useState(false)
  useEffect(() => {
    setShowInstanceToast(true)
    const t = setTimeout(() => setShowInstanceToast(false), 4500)
    return () => clearTimeout(t)
  }, [])

  if (hostNotFound) return <HostNotFoundScreen hostId={hostId} />

  const {
    frameRef,
    agents,
    toolCalls,
    particles,
    edges,
    discoveries,
    fileAttention,
    timelineEntries,
    currentTime,
    isPlaying,
    speed,
    maxTimeReached,
    conversations,
    play,
    pause,
    restart,
    setSpeed,
    seekToTime,
    updateAgentPosition,
    saveSnapshot,
    restoreSnapshot,
  } = useAgentSimulation({
    useMockData: bridge.useMockData,
    externalEvents: bridge.pendingEvents,
    onExternalEventsConsumed: bridge.consumeEvents,
    sessionFilter: bridge.selectedSessionId,
    // Pass the ref that's updated synchronously in session-started handler,
    // so the animation frame never uses a stale filter value.
    sessionFilterRef: bridge.selectedSessionIdRef,
    disable1MContext: bridge.disable1MContext,
  })

  const selection = useSelectionState({ agents, toolCalls, discoveries })

  const [showStats, setShowStats] = useState(true)
  const [showHexGrid, setShowHexGrid] = useState(true)
  const [showCostOverlay, setShowCostOverlay] = useState(false)
  const [showCostPanel, setShowCostPanel] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showFileAttention, setShowFileAttention] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [detailCardHidden, setDetailCardHidden] = useState(false)

  // When the user selects a different agent, re-show the detail card.
  useEffect(() => {
    if (selection.selectedAgentId) setDetailCardHidden(false)
  }, [selection.selectedAgentId])

  // Sync toggle state with cross-instance send/receive: those panels are gated
  // by `visible` props above FloatingPanel, so the panel-layout `hidden` flag
  // alone isn't enough — the parent's toggle must flip too.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onShow = (e: Event) => {
      const id = (e as CustomEvent<{ panelId: string }>).detail.panelId
      if (id === 'session-transcript') setShowTranscript(true)
      else if (id === 'file-attention') setShowFileAttention(true)
      else if (id === 'timeline') setShowTimeline(true)
    }
    const onHide = (e: Event) => {
      const id = (e as CustomEvent<{ panelId: string }>).detail.panelId
      if (id === 'session-transcript') setShowTranscript(false)
      else if (id === 'file-attention') setShowFileAttention(false)
      else if (id === 'timeline') setShowTimeline(false)
    }
    window.addEventListener('agent-flow:show-panel', onShow)
    window.addEventListener('agent-flow:hide-panel', onHide)
    return () => {
      window.removeEventListener('agent-flow:show-panel', onShow)
      window.removeEventListener('agent-flow:hide-panel', onHide)
    }
  }, [])

  // Independent panel toggling — each panel can be open simultaneously
  const togglePanel = useCallback((panel: 'files' | 'transcript' | 'cost') => {
    if (panel === 'files') setShowFileAttention(prev => !prev)
    else if (panel === 'transcript') setShowTranscript(prev => !prev)
    else if (panel === 'cost') setShowCostOverlay(prev => {
      // $Cost button toggles canvas labels AND opens the cost-summary panel.
      // The panel can be closed independently via its ✕ without affecting
      // labels; clicking $Cost again turns labels off.
      const next = !prev
      setShowCostPanel(next)
      return next
    })
  }, [])
  const [zoomToFitTrigger, setZoomToFitTrigger] = useState(0)

  const [isReviewing, setIsReviewing] = useState(false)
  const { isMuted, seekingRef, handleToggleMute, playUiClick } = useAudioEffects(agents, toolCalls, isReviewing)

  // Auto-play on mount
  useEffect(() => {
    const timer = setTimeout(() => play(), TIMING.autoPlayDelayMs)
    return () => clearTimeout(timer)
  }, [play])

  // Per-session state cache: save/restore simulation state on tab switch
  // so sessions stay up to date and switching is instant.
  // useLayoutEffect ensures restart happens synchronously before any animation
  // frame can consume and discard events from pendingEventsRef.
  const sessionCacheRef = useRef<Map<string, { snapshot: ReturnType<typeof saveSnapshot>; eventCount: number }>>(new Map())
  const prevSelectedRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (bridge.selectedSessionId && bridge.selectedSessionId !== prevSelectedRef.current) {
      // Save outgoing session state (if any)
      if (prevSelectedRef.current !== null) {
        sessionCacheRef.current.set(prevSelectedRef.current, {
          snapshot: saveSnapshot(),
          eventCount: bridge.getSessionEventCount(prevSelectedRef.current),
        })
      }

      // Restore or cold-start the incoming session, then flush events.
      // Flushing happens HERE (after state swap) to prevent the animation
      // frame from processing events in the wrong simulation context.
      const cached = sessionCacheRef.current.get(bridge.selectedSessionId)
      if (cached) {
        restoreSnapshot(cached.snapshot)
        bridge.flushSessionEvents(bridge.selectedSessionId, cached.eventCount)
      } else {
        restart()
        bridge.flushSessionEvents(bridge.selectedSessionId)
      }

      prevSelectedRef.current = bridge.selectedSessionId
    }
  }, [bridge.selectedSessionId, restart, bridge.flushSessionEvents, saveSnapshot, restoreSnapshot, bridge.getSessionEventCount])

  // Timeline events — incremental: only processes new conversation messages
  const timelineCacheRef = useRef<{
    counts: Map<string, number>
    events: TimelineEvent[]
    idCounter: number
  }>({ counts: new Map(), events: [], idCounter: 0 })

  const timelineEvents = useMemo((): TimelineEvent[] => {
    const cache = timelineCacheRef.current
    let appended = false
    for (const [agentId, msgs] of conversations) {
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
  }, [conversations])

  // Review mode: when in live mode and user pauses to scrub through history

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause()
      setIsReviewing(true)
    } else {
      play()
    }
  }, [isPlaying, play, pause])

  const handleEnterReview = useCallback(() => {
    pause()
    setIsReviewing(true)
  }, [pause])

  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleResumeLive = useCallback(() => {
    setIsReviewing(false)
    seekToTime(maxTimeReached)
    setZoomToFitTrigger(n => n + 1)
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => { resumeTimerRef.current = null; play() }, TIMING.resumeLiveDelayMs)
  }, [seekToTime, maxTimeReached, play])
  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current) }, [])

  const handleRestart = useCallback(() => {
    setIsReviewing(false)
    restart(true)
  }, [restart])

  // Keyboard shortcuts
  const keyboardActions = useMemo(() => ({
    togglePlayPause: handlePlayPause,
    toggleFilePanel: () => togglePanel('files'),
    toggleTranscript: () => togglePanel('transcript'),
    toggleTimeline: () => { setShowTimeline(prev => !prev) },
    toggleHexGrid: () => { setShowHexGrid(prev => !prev) },
    toggleStats: () => { setShowStats(prev => !prev) },
    toggleCostOverlay: () => togglePanel('cost'),
    zoomToFit: () => { setZoomToFitTrigger(n => n + 1) },
    clearSelection: () => { selection.clearAllSelections() },
    deselectAgent: () => { selection.clearAgent() },
    closeTranscript: () => { setShowTranscript(false) },
    toggleMute: handleToggleMute,
    setSpeed,
    selectedAgentId: selection.selectedAgentId,
  }), [handlePlayPause, selection.clearAllSelections, selection.clearAgent, selection.selectedAgentId, setSpeed, handleToggleMute, togglePanel])

  useKeyboardShortcuts(keyboardActions)

  const totalTokens = useMemo(() => {
    let sum = 0
    for (const a of agents.values()) sum += a.tokensUsed
    return sum
  }, [agents])

  const selectedAgent = selection.selectedAgentId ? agents.get(selection.selectedAgentId) : null
  const selectedConversation = selection.selectedAgentId ? (conversations.get(selection.selectedAgentId) || []) : []

  // Session-wide conversation (all agents merged chronologically)
  // Only compute when the transcript panel is visible to avoid O(n log n) sort every frame
  const sessionConversation = useMemo(() => {
    if (!showTranscript) return []
    const all = Array.from(conversations.values()).flat()
    return all.sort((a, b) => a.timestamp - b.timestamp)
  }, [conversations, showTranscript])

  // Context menu items
  const contextMenuItems = selection.contextMenu ? (
    selection.contextMenu.agentId ? [
      { label: '📊  Toggle Stats', onClick: () => setShowStats(prev => !prev) },
    ] : [
      { label: '🔍  Zoom to Fit', onClick: () => setZoomToFitTrigger(n => n + 1) },
      { label: '📊  Toggle Stats', onClick: () => setShowStats(prev => !prev) },
      { label: '⬡  Toggle Grid', onClick: () => setShowHexGrid(prev => !prev) },
      { label: '', onClick: () => {}, separator: true },
      { label: '⊞  Reset Layout', onClick: resetLayout },
      { label: '⟲  Restart', onClick: restart },
    ]
  ) : []

  const handleCloseSession = useCallback((id: string) => {
    bridge.removeSession(id)
    sessionCacheRef.current.delete(id)
    if (bridge.selectedSessionId === id) {
      const remaining = bridge.sessions.filter(s => s.id !== id)
      if (remaining.length > 0) {
        bridge.selectSession(remaining[remaining.length - 1].id)
      }
    }
  }, [bridge])

  const openFile = useCallback((filePath: string, line?: number) => {
    bridge.bridgeOpenFile(filePath, line)
  }, [bridge])

  const isEmpty = agents.size === 0 && !bridge.useMockData

  // Slot assignment: each live session gets the lowest unused slot, stable for
  // the lifetime of this page load. Slot rects persist in localStorage as
  // `canvas-slot-<N>`, so positions are remembered across reloads even though
  // session UUIDs change with each Claude Code restart.
  const sessionSlotsRef = useRef<Map<string, number>>(new Map())
  const sessionSlots = useMemo(() => {
    const map = sessionSlotsRef.current
    const liveIds = new Set(bridge.sessions.map(s => s.id))
    for (const id of [...map.keys()]) {
      if (!liveIds.has(id)) map.delete(id)
    }
    for (const session of bridge.sessions) {
      if (map.has(session.id)) continue
      const used = new Set(map.values())
      let n = 1
      while (used.has(n)) n++
      map.set(session.id, n)
    }
    return new Map(map)
  }, [bridge.sessions])

  return (
    <OpenFileProvider value={bridge.isVSCode ? openFile : null}>
    <div className="h-screen w-screen relative overflow-hidden" style={{ background: COLORS.void }}>
      {/* Instance toast: brief identifier on page load. */}
      {showInstanceToast && (
        <div
          style={{
            position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)',
            zIndex: 99998, pointerEvents: 'none',
            padding: '6px 12px',
            background: 'rgba(10, 15, 30, 0.85)',
            border: `1px solid ${COLORS.holoBorder12}`,
            borderRadius: 6,
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: 11,
            color: COLORS.textPrimary,
            transition: 'opacity 600ms ease',
            opacity: 0.92,
          }}
        >
          {hostId
            ? <>Joined session: <span style={{ color: COLORS.holoBright }}>{instanceId}</span> · host: <span style={{ color: COLORS.holoBright }}>{hostId}</span></>
            : isFreshInstance
              ? <>New session: <span style={{ color: COLORS.holoBright }}>{instanceId}</span></>
              : <>Session: <span style={{ color: COLORS.holoBright }}>{instanceId}</span></>}
        </div>
      )}

      {/* Empty state when no demo and no live data */}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center" style={{ fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
            <div className="text-sm" style={{ color: '#66ccff80' }}>WAITING FOR AGENT SESSION</div>
            <div className="mt-2 text-xs" style={{ color: '#66ccff40' }}>Start a Claude Code session to see activity</div>
          </div>
        </div>
      )}

      {/* One draggable canvas per active session, mapped onto persistent slots.
          Slot rects (`canvas-slot-N`) are remembered in localStorage; sessions
          are assigned the lowest unused slot in arrival order, so positions
          stick across Claude Code restarts (which mint new session UUIDs). */}
      {bridge.sessions.map(session => {
        const slot = sessionSlots.get(session.id) ?? 0
        if (slot === 0) return null
        return (
          <SessionCanvasPanel
            key={session.id}
            sessionId={session.id}
            sessionLabel={session.label ?? session.id.slice(0, 8)}
            slot={slot}
            selectedAgentId={selection.selectedAgentId}
            hoveredAgentId={selection.hoveredAgentId}
            selectedToolCallId={selection.selectedToolCallId}
            selectedDiscoveryId={selection.selectedDiscoveryId}
            showStats={showStats}
            showHexGrid={showHexGrid}
            showCostOverlay={showCostOverlay}
            zoomToFitTrigger={zoomToFitTrigger}
            pauseAutoFit={selection.contextMenu !== null}
            getSessionEventLog={bridge.getSessionEventLog}
            onAgentClick={(id, sessionId) => {
              if (sessionId !== bridge.selectedSessionId) bridge.selectSession(sessionId)
              if (selection.selectedAgentId) selection.clearAgent()
              void id
            }}
            onAgentHover={selection.setHoveredAgentId}
            onAgentDrag={updateAgentPosition}
            onContextMenu={selection.handleContextMenu}
            onToolCallClick={selection.handleToolCallClick}
            onDiscoveryClick={selection.handleDiscoveryClick}
          />
        )
      })}

      {/* Message feed panel (top-left) */}
      <MessageFeedPanel
        conversations={conversations}
        agents={agents}
        onAgentClick={selection.handleAgentClick}
        selectedAgentId={selection.selectedAgentId}
      />

      {/* Agent detail card (floating panel) — closeable independently of the chat. */}
      {selectedAgent && selection.selectedAgentWorldPos && !detailCardHidden && (
        <AgentDetailCard
          agent={selectedAgent}
          sessionId={bridge.selectedSessionId ?? ''}
          onClose={() => setDetailCardHidden(true)}
        />
      )}

      {/* Tool call detail popup */}
      {selection.selectedToolData && selection.selectedToolScreenPos && (
        <div {...stopPropagationHandlers}>
          <ToolDetailPopup
            tool={selection.selectedToolData}
            position={selection.selectedToolScreenPos}
            onClose={selection.clearTool}
          />
        </div>
      )}

      {/* Discovery detail popup */}
      {selection.selectedDiscoveryData && selection.selectedDiscoveryScreenPos && (
        <div {...stopPropagationHandlers}>
          <DiscoveryDetailPopup
            discovery={selection.selectedDiscoveryData}
            position={selection.selectedDiscoveryScreenPos}
            onClose={selection.clearDiscovery}
          />
        </div>
      )}

      {/* Chat panel (bottom-right, shown when agent selected) */}
      <AgentChatPanel
        visible={!!selectedAgent}
        agentName={selectedAgent?.name ?? ''}
        agentState={selectedAgent?.state ?? 'idle'}
        conversation={selectedConversation}
        onClose={selection.clearAgent}
      />

      {/* Context menu */}
      {selection.contextMenu && (
        <GlassContextMenu
          position={selection.contextMenu}
          items={contextMenuItems}
          onClose={() => selection.setContextMenu(null)}
        />
      )}

      {/* Floating control strip */}
      <ControlBar
        isPlaying={isPlaying}
        speed={speed}
        currentTime={currentTime}
        totalDuration={bridge.useMockData
          ? (isReviewing ? Math.max(maxTimeReached, currentTime) : MOCK_DURATION)
          : Math.max(maxTimeReached, currentTime)
        }
        onPlayPause={handlePlayPause}
        onRestart={handleRestart}
        onSpeedChange={setSpeed}
        onSeek={(time) => {
          seekingRef.current = true
          pause()
          seekToTime(time)
          setZoomToFitTrigger(n => n + 1)
          if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current)
          resumeTimerRef.current = setTimeout(() => { resumeTimerRef.current = null; seekingRef.current = false }, TIMING.seekCompleteDelayMs)
        }}
        timelineEvents={timelineEvents}
        isReviewing={isReviewing}
        eventCount={timelineEvents.length}
        onEnterReview={handleEnterReview}
        onResumeLive={handleResumeLive}
      />

      {/* File attention panel (slide-in from right) */}
      <FileAttentionPanel
        visible={showFileAttention}
        fileAttention={fileAttention}
        onClose={() => setShowFileAttention(false)}
        onOpenFile={bridge.isVSCode ? openFile : undefined}
      />

      {/* Session transcript panel (slide-in from right) */}
      <SessionTranscriptPanel
        visible={showTranscript}
        conversation={sessionConversation}
        onClose={() => setShowTranscript(false)}
      />

      {/* Timeline panel (slide-in from bottom) */}
      <TimelinePanel
        visible={showTimeline}
        timelineEntries={timelineEntries}
        currentTime={currentTime}
        onClose={() => setShowTimeline(false)}
      />

      {/* Cost summary panel — aggregates across all session canvases. */}
      <CostSummaryPanel
        visible={showCostPanel}
        onClose={() => setShowCostPanel(false)}
      />

      {/* Top bar: session tabs + info/controls */}
      <TopBar
        sessions={bridge.sessions}
        selectedSessionId={bridge.selectedSessionId}
        sessionsWithActivity={bridge.sessionsWithActivity}
        onSelectSession={bridge.selectSession}
        onCloseSession={handleCloseSession}
        isVSCode={bridge.isVSCode}
        connectionStatus={bridge.connectionStatus}
        agentCount={agents.size}
        totalTokens={totalTokens}
        showFileAttention={showFileAttention}
        showTranscript={showTranscript}
        showCostOverlay={showCostOverlay}
        showTimeline={showTimeline}
        isMuted={isMuted}
        onTogglePanel={togglePanel}
        onToggleTimeline={() => setShowTimeline(prev => !prev)}
        onToggleMute={handleToggleMute}
        onUiClick={playUiClick}
      />
    </div>
    </OpenFileProvider>
  )
}

function HostNotFoundScreen({ hostId }: { hostId: string | null }) {
  const onOpenNew = () => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.delete('host')
    url.searchParams.delete('session')
    window.location.href = url.toString()
  }
  return (
    <div
      className="h-screen w-screen flex items-center justify-center"
      style={{ background: COLORS.void, fontFamily: "'SF Mono', 'Fira Code', monospace" }}
    >
      <div
        style={{
          padding: '24px 28px',
          background: 'rgba(10, 15, 30, 0.85)',
          border: `1px solid ${COLORS.holoBorder12}`,
          borderRadius: 8,
          color: COLORS.textPrimary,
          maxWidth: 440,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 12, color: COLORS.holoBase, marginBottom: 8, letterSpacing: 1 }}>
          HOST NOT FOUND
        </div>
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          No layout exists for host{' '}
          <span style={{ color: COLORS.holoBright }}>{hostId ?? '—'}</span>.
        </div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 18 }}>
          The host window may have been closed or hard-reset.
        </div>
        <button
          onClick={onOpenNew}
          style={{
            padding: '8px 16px',
            background: 'rgba(100, 200, 255, 0.12)',
            border: `1px solid ${COLORS.holoBorder12}`,
            color: COLORS.textPrimary,
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'inherit',
          }}
        >
          Open new session
        </button>
      </div>
    </div>
  )
}
