"use client"

import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react"
import { usePersistedState } from "@/hooks/use-persisted-state"
import { useAgentSimulation } from "@/hooks/use-agent-simulation"
import { useVSCodeBridge } from "@/hooks/use-vscode-bridge"
import { useSelectionState } from "@/hooks/use-selection-state"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { SessionCanvasPanel } from "./session-canvas-panel"
import { SessionStatsProvider, useSessionStatsData } from "./session-stats-provider"
import { CostSummaryPanel } from "./cost-summary-panel"
import { SessionNamesProvider } from "@/hooks/use-session-names"
import { useWorkspaceFilter } from "@/hooks/use-workspace-filter"
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
import { TIMING, type Agent } from "@/lib/agent-types"
import type { ConversationMessage } from "@/hooks/simulation/types"
import { COLORS } from "@/lib/colors"
import { mergeByTimestamp } from "@/lib/sort-utils"

import { MessageFeedPanel } from "./message-feed-panel"
import { TopBar } from "./top-bar"
import { useAudioEffects } from "@/hooks/use-audio-effects"
import { PanelLayoutProvider } from "./panel-layout-provider"
import { usePanelLayout } from "@/hooks/use-panel-layout"

export function AgentVisualizer() {
  return (
    <PanelLayoutProvider>
      <SessionStatsProvider>
        <SessionNamesProvider>
          <AgentVisualizerInner />
        </SessionNamesProvider>
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
    agents,
    toolCalls,
    discoveries,
    fileAttention,
    timelineEntries,
    currentTime,
    isPlaying,
    conversations,
    play,
    pause,
    restart,
    setSpeed,
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

  // Panel toggles persist across reloads — closing a panel via its ✕ should
  // stick. Saved to localStorage automatically (separate from the panel-rect
  // layout, which has its own SAVED_KEY managed by panel-layout-provider).
  const [showStats, setShowStats] = useState(true)
  const [showHexGrid, setShowHexGrid] = useState(true)
  const [showCostOverlay, setShowCostOverlay] = usePersistedState('agent-flow:show-cost-overlay:v1', false)
  const [showCostPanel, setShowCostPanel] = usePersistedState('agent-flow:show-cost-panel:v1', false)
  const [showTimeline, setShowTimeline] = usePersistedState('agent-flow:show-timeline:v1', false)
  const [showFileAttention, setShowFileAttention] = usePersistedState('agent-flow:show-file-attention:v1', false)
  const [showTranscript, setShowTranscript] = usePersistedState('agent-flow:show-transcript:v1', false)
  const [showMessageFeed, setShowMessageFeed] = usePersistedState('agent-flow:show-message-feed:v1', true)
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
      else if (id === 'message-feed') setShowMessageFeed(true)
    }
    const onHide = (e: Event) => {
      const id = (e as CustomEvent<{ panelId: string }>).detail.panelId
      if (id === 'session-transcript') setShowTranscript(false)
      else if (id === 'file-attention') setShowFileAttention(false)
      else if (id === 'timeline') setShowTimeline(false)
      else if (id === 'message-feed') setShowMessageFeed(false)
    }
    window.addEventListener('agent-flow:show-panel', onShow)
    window.addEventListener('agent-flow:hide-panel', onHide)
    return () => {
      window.removeEventListener('agent-flow:show-panel', onShow)
      window.removeEventListener('agent-flow:hide-panel', onHide)
    }
  }, [])

  // Independent panel toggling — each panel can be open simultaneously
  const togglePanel = useCallback((panel: 'files' | 'transcript' | 'cost' | 'messages') => {
    if (panel === 'files') setShowFileAttention(prev => !prev)
    else if (panel === 'transcript') setShowTranscript(prev => !prev)
    else if (panel === 'messages') setShowMessageFeed(prev => !prev)
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
  const { isMuted, handleToggleMute, playUiClick } = useAudioEffects(agents, toolCalls, isReviewing)

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

  // Spacebar toggles the global simulation that powers selection / file-attention /
  // transcript panels. Per-canvas play/pause is handled by each canvas's own
  // ControlBar at the bottom of the canvas window.
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause()
      setIsReviewing(true)
    } else {
      play()
    }
  }, [isPlaying, play, pause])

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

  // Session-wide conversation (all agents merged chronologically).
  // Incremental merge: only sort newly appended messages, then O(N+M) merge
  // into the cached sorted result to avoid full O(N log N) at every tick.
  const sessionConvCacheRef = useRef<{
    counts: Map<string, number>
    result: ConversationMessage[]
  }>({ counts: new Map(), result: [] })

  const sessionConversation = useMemo(() => {
    if (!showTranscript) return []
    const cache = sessionConvCacheRef.current
    const newItems: ConversationMessage[] = []
    for (const [agentId, msgs] of conversations) {
      const prevLen = cache.counts.get(agentId) ?? 0
      if (msgs.length > prevLen) {
        for (let i = prevLen; i < msgs.length; i++) newItems.push(msgs[i])
        cache.counts.set(agentId, msgs.length)
      }
    }
    if (newItems.length > 0) {
      newItems.sort((a, b) => a.timestamp - b.timestamp)
      cache.result = mergeByTimestamp(cache.result, newItems)
    }
    return cache.result
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

  // Hoisted from the SessionCanvasPanel map to avoid inline arrow allocations.
  // The child already passes (agentId, sessionId) so we can handle both args.
  const handleCanvasAgentClick = useCallback((id: string | null, sessionId: string) => {
    if (sessionId !== bridge.selectedSessionId) bridge.selectSession(sessionId)
    if (selection.selectedAgentId) selection.clearAgent()
    void id
  }, [bridge, selection.selectedAgentId, selection.clearAgent])

  const openFile = useCallback((filePath: string, line?: number) => {
    bridge.bridgeOpenFile(filePath, line)
  }, [bridge])

  const isEmpty = agents.size === 0 && !bridge.useMockData

  const workspaceFilter = useWorkspaceFilter()
  useEffect(() => {
    for (const s of bridge.sessions) {
      if (s.cwd) workspaceFilter.registerCwd(s.cwd)
    }
  }, [bridge.sessions, workspaceFilter])

  // Auto-fit zoom floor — 0 = no min (current behavior). The top bar exposes
  // a small slider; canvases respect this in their auto-fit calculation so
  // crowded scenes stay readable instead of zooming all the way out.
  const [minZoomLevel, setMinZoomLevel] = usePersistedState<number>(
    `agent-flow:min-zoom:v1:${instanceId}`,
    0,
  )

  // Per-canvas close state. The user can ✕-close a session canvas and we
  // keep it dismissed across reloads (per-instance, like other UI prefs);
  // the top bar shows a chip for each closed canvas so it can be reopened.
  const [hiddenCanvasesList, setHiddenCanvasesList] = usePersistedState<string[]>(
    `agent-flow:hidden-canvases:v1:${instanceId}`,
    [],
  )
  const hiddenCanvasesSet = useMemo(() => new Set(hiddenCanvasesList), [hiddenCanvasesList])
  const hideCanvas = useCallback((id: string) => {
    setHiddenCanvasesList(prev => prev.includes(id) ? prev : [...prev, id])
  }, [setHiddenCanvasesList])
  const showCanvas = useCallback((id: string) => {
    setHiddenCanvasesList(prev => prev.filter(x => x !== id))
  }, [setHiddenCanvasesList])

  const visibleSessions = useMemo(
    () => bridge.sessions.filter(s =>
      workspaceFilter.isVisible(s.cwd) && !hiddenCanvasesSet.has(s.id),
    ),
    [bridge.sessions, workspaceFilter, hiddenCanvasesSet],
  )

  // Keys are `${sessionId}:${agentId}` to disambiguate same-named agents
  // (e.g. two "orchestrator"s) across sessions.
  const perSession = useSessionStatsData()
  const visibleSessionIds = useMemo(
    () => new Set(visibleSessions.map(s => s.id)),
    [visibleSessions],
  )

  const feedConversations = useMemo(() => {
    const fc = new Map<string, ConversationMessage[]>()
    for (const [sid, stats] of perSession) {
      if (!visibleSessionIds.has(sid)) continue
      for (const [agentId, msgs] of stats.conversations) {
        fc.set(`${sid}:${agentId}`, msgs)
      }
    }
    return fc
  }, [perSession, visibleSessionIds])

  const feedAgents = useMemo(() => {
    const fa = new Map<string, Agent>()
    for (const [sid, stats] of perSession) {
      if (!visibleSessionIds.has(sid)) continue
      for (const [agentId, ag] of stats.agents) {
        fa.set(`${sid}:${agentId}`, ag)
      }
    }
    return fa
  }, [perSession, visibleSessionIds])

  const agentToSession = useMemo(() => {
    const a2s = new Map<string, string>()
    for (const [sid, stats] of perSession) {
      if (!visibleSessionIds.has(sid)) continue
      for (const [agentId] of stats.agents) {
        a2s.set(`${sid}:${agentId}`, sid)
      }
    }
    return a2s
    // TODO: Per-session caching — track individual session Map references to
    // avoid rebuilding entries for sessions that haven't changed.
  }, [perSession, visibleSessionIds])

  // Slot assignment: each live session gets the lowest unused slot, stable for
  // the lifetime of this page load. Slot rects persist in localStorage as
  // `canvas-slot-<N>`, so positions are remembered across reloads even though
  // session UUIDs change with each Claude Code restart.
  const sessionSlotsRef = useRef<Map<string, number>>(new Map())
  const sessionSlots = useMemo(() => {
    const map = sessionSlotsRef.current
    const liveIds = new Set(visibleSessions.map(s => s.id))
    for (const id of [...map.keys()]) {
      if (!liveIds.has(id)) map.delete(id)
    }
    for (const session of visibleSessions) {
      if (map.has(session.id)) continue
      const used = new Set(map.values())
      let n = 1
      while (used.has(n)) n++
      map.set(session.id, n)
    }
    return new Map(map)
  }, [visibleSessions])

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

      {/* Slot rects persist as `canvas-slot-N` so positions outlive the
          session UUIDs they were captured under. */}
      {visibleSessions.map(session => {
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
            onAgentClick={handleCanvasAgentClick}
            onAgentHover={selection.setHoveredAgentId}
            onAgentDrag={updateAgentPosition}
            onContextMenu={selection.handleContextMenu}
            onToolCallClick={selection.handleToolCallClick}
            onDiscoveryClick={selection.handleDiscoveryClick}
            onClose={() => hideCanvas(session.id)}
            minZoomLevel={minZoomLevel}
          />
        )
      })}

      {/* Gate at the parent so the panel unmounts when hidden — its expensive
       *  per-conversation memos and effects don't run while the user has it
       *  closed. */}
      {showMessageFeed && (
        <MessageFeedPanel
          conversations={feedConversations}
          agents={feedAgents}
          agentToSession={agentToSession}
          onAgentClick={selection.handleAgentClick}
          selectedAgentId={selection.selectedAgentId}
          onClose={() => setShowMessageFeed(false)}
        />
      )}

      {/* Agent detail card (floating panel) — closeable independently of the chat. */}
      {selectedAgent && selection.selectedAgentWorldPos && !detailCardHidden && (
        <AgentDetailCard
          agent={selectedAgent}
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
        sessionId={bridge.selectedSessionId}
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
        sessions={visibleSessions}
        allSessions={bridge.sessions}
        selectedSessionId={bridge.selectedSessionId}
        sessionsWithActivity={bridge.sessionsWithActivity}
        onSelectSession={bridge.selectSession}
        onCloseSession={handleCloseSession}
        onRemoveSession={bridge.removeSession}
        isVSCode={bridge.isVSCode}
        connectionStatus={bridge.connectionStatus}
        agentCount={agents.size}
        totalTokens={totalTokens}
        showFileAttention={showFileAttention}
        showTranscript={showTranscript}
        showCostOverlay={showCostOverlay}
        showTimeline={showTimeline}
        showMessageFeed={showMessageFeed}
        isMuted={isMuted}
        workspaceFilter={workspaceFilter}
        hiddenCanvases={hiddenCanvasesSet}
        onShowCanvas={showCanvas}
        minZoomLevel={minZoomLevel}
        onMinZoomLevelChange={setMinZoomLevel}
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
