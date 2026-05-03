"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { COLORS } from "@/lib/colors"
import { formatTokens } from "@/lib/utils"
import { agentCost } from "./canvas/draw-cost"
import { SessionTabs } from "./session-tabs"
import { FloatingPanel } from "./floating-panel"
import { FPSIndicator } from "./fps-indicator"
import { usePanelLayout } from "@/hooks/use-panel-layout"
import type { WorkspaceFilterAPI } from "@/hooks/use-workspace-filter"
import type { SessionInfo, ConnectionStatus } from "@/lib/bridge-types"
import type { EffectToggles } from "@/hooks/use-perf-settings"

// ─── Mute/Unmute SVG Icons ───────────────────────────────────────────────────

// Tile-layout icons — three horizontal bars / three vertical bars.
function TileVerticalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="2"  width="10" height="2.5" rx="0.5" />
      <rect x="2" y="5.75" width="10" height="2.5" rx="0.5" />
      <rect x="2" y="9.5"  width="10" height="2.5" rx="0.5" />
    </svg>
  )
}
function TileHorizontalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2"   y="2" width="2.5" height="10" rx="0.5" />
      <rect x="5.75" y="2" width="2.5" height="10" rx="0.5" />
      <rect x="9.5"  y="2" width="2.5" height="10" rx="0.5" />
    </svg>
  )
}

function MutedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  )
}

function UnmutedIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  )
}

// ─── Toggle Button ──────────────────────────────────────────────────────────

function ToggleButton({ active, onClick, children, style, activeColor }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  style?: React.CSSProperties
  activeColor?: { bg: string; text: string }
}) {
  const [hover, setHover] = useState(false)
  const baseBg = active
    ? (activeColor?.bg ?? COLORS.toggleActive)
    : (hover ? COLORS.toggleHover : COLORS.toggleInactive)
  const baseColor = active
    ? (activeColor?.text ?? COLORS.holoBright)
    : (hover ? COLORS.textPrimary : COLORS.textDim)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="px-2.5 py-1 rounded transition-all"
      style={{
        background: baseBg,
        border: `1px solid ${COLORS.toggleBorder}`,
        color: baseColor,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ─── Connection Status Indicator ────────────────────────────────────────────

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const color = status === 'watching' ? COLORS.complete
    : status === 'connected' ? COLORS.idle : COLORS.error
  const label = status === 'watching' ? 'LIVE'
    : status === 'connected' ? 'CONNECTED' : 'OFFLINE'

  return (
    <span className="flex items-center gap-2">
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 4px ${color}` }}
      />
      {label}
    </span>
  )
}

// ─── Top Bar ────────────────────────────────────────────────────────────────

export interface TopBarProps {
  // Session tabs
  sessions: SessionInfo[]
  /** All known sessions (incl. hidden-by-filter). Used by the Workspaces
   *  popover so counts and the per-row "clear stale" action see workspaces
   *  the user has filtered out. */
  allSessions: SessionInfo[]
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
  onRemoveSession: (id: string) => void
  // Connection
  isVSCode: boolean
  connectionStatus: ConnectionStatus
  // Stats
  agentCount: number
  totalTokens: number
  // Panel toggles
  showFileAttention: boolean
  showTranscript: boolean
  showCostOverlay: boolean
  showTimeline: boolean
  showMessageFeed: boolean
  isMuted: boolean
  workspaceFilter: WorkspaceFilterAPI
  // Performance settings (frame cap + per-effect toggles)
  frameCap: number
  onFrameCapChange: (fps: number) => void
  effects: EffectToggles
  onEffectChange: (key: keyof EffectToggles, value: boolean) => void
  bloomThrottle: number
  onBloomThrottleChange: (value: number) => void
  /** Session ids whose canvas the user has ✕-closed. The top bar renders a
   *  chip per id so they can be reopened via onShowCanvas. */
  hiddenCanvases?: ReadonlySet<string>
  onShowCanvas?: (sessionId: string) => void
  onTogglePanel: (panel: 'files' | 'transcript' | 'cost' | 'messages') => void
  onToggleTimeline: () => void
  onToggleMute: () => void
  /** Optional UI feedback sound for top-bar button clicks. */
  onUiClick?: (variant: 'save' | 'reset') => void
}

export const TopBar = memo(function TopBar({
  sessions, allSessions, selectedSessionId, sessionsWithActivity,
  onSelectSession, onCloseSession, onRemoveSession,
  isVSCode, connectionStatus,
  agentCount, totalTokens,
  showFileAttention, showTranscript, showCostOverlay, showTimeline, showMessageFeed, isMuted,
  workspaceFilter,
  hiddenCanvases, onShowCanvas,
  onTogglePanel, onToggleTimeline, onToggleMute, onUiClick,
  frameCap, onFrameCapChange, effects, onEffectChange,
  bloomThrottle, onBloomThrottleChange,
}: TopBarProps) {
  const { resetLayout, saveLayout, hardResetLayout, tilePanels, instanceId, hostId, otherInstances } = usePanelLayout()
  const resetClickRef = useRef(0)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleReset = () => {
    if (resetClickRef.current === 0) {
      resetLayout()
      resetClickRef.current = 1
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => { resetClickRef.current = 0 }, 2000)
      return
    }
    // 2nd click within 2s — confirm hard reset
    resetClickRef.current = 0
    if (resetTimerRef.current) { clearTimeout(resetTimerRef.current); resetTimerRef.current = null }
    if (window.confirm('Reset all panels to defaults and clear your saved layout?')) {
      hardResetLayout()
    }
  }
  const [defaultRect] = useState(() => {
    if (typeof window === 'undefined') return { x: 12, y: 12, w: 1256, h: 60 }
    return { x: 12, y: 12, w: window.innerWidth - 24, h: 60 }
  })
  return (
    <FloatingPanel
      id="top-bar"
      defaultRect={defaultRect}
      minW={300}
      minH={36}
    >
      <div className="flex items-center gap-4 font-mono text-[12px] px-3 py-2 h-full">
        {/* Session badge (top-left corner) */}
        <div
          title={`Session: ${instanceId}${hostId ? `\nHost: ${hostId}` : ''}\nPeers: ${otherInstances.length === 0 ? '(none)' : otherInstances.join(', ')}`}
          className="flex-shrink-0"
          style={{
            height: 32, padding: '0 14px',
            fontSize: 13, lineHeight: '32px',
            background: 'rgba(100, 200, 255, 0.06)',
            border: '1px solid rgba(100, 200, 255, 0.18)',
            color: COLORS.textPrimary,
            borderRadius: 4,
            opacity: 0.85,
            userSelect: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: COLORS.complete,
              boxShadow: `0 0 4px ${COLORS.complete}`,
            }}
          />
          <span style={{ color: COLORS.holoBright }}>{instanceId}</span>
          {hostId && (
            <>
              <span style={{ color: COLORS.textMuted }}>↳</span>
              <span style={{ color: COLORS.holoBright }}>{hostId}</span>
            </>
          )}
          {otherInstances.length > 0 && (
            <>
              <span style={{ color: COLORS.textMuted }}>·</span>
              <span>{otherInstances.length} peer{otherInstances.length === 1 ? '' : 's'}</span>
            </>
          )}
        </div>

        <FPSIndicator
          frameCap={frameCap}
          onFrameCapChange={onFrameCapChange}
          effects={effects}
          onEffectChange={onEffectChange}
          bloomThrottle={bloomThrottle}
          onBloomThrottleChange={onBloomThrottleChange}
        />

        {/* Spacer pushes info to the right */}
        <div className="flex-1" />

        {/* Right-side info/controls */}
        <div className="flex items-center gap-4 flex-shrink-0" style={{ color: COLORS.textMuted }}>
          {isVSCode && <ConnectionIndicator status={connectionStatus} />}

          {/* Panel toggle group — kept tightly spaced via inner gap-1, but each
              button uses the default ToggleButton style for visual consistency
              with the rest of the top bar. */}
          <div className="flex items-center gap-1">
            <ToggleButton active={showMessageFeed} onClick={() => onTogglePanel('messages')}>Messages</ToggleButton>
            <ToggleButton active={showFileAttention} onClick={() => onTogglePanel('files')}>Files</ToggleButton>
            <ToggleButton active={showTranscript} onClick={() => onTogglePanel('transcript')}>Chat</ToggleButton>
            <ToggleButton
              active={showCostOverlay}
              onClick={() => onTogglePanel('cost')}
              activeColor={{ bg: COLORS.costActiveBg, text: COLORS.complete }}
            >
              $Cost
            </ToggleButton>
          </div>

          {/* Independent toggles */}
          <ToggleButton active={showTimeline} onClick={onToggleTimeline}>Timeline</ToggleButton>
          <WorkspaceFilterButton
            workspaceFilter={workspaceFilter}
            sessions={allSessions}
            onRemoveSession={onRemoveSession}
          />
          {hiddenCanvases && onShowCanvas && (
            <ClosedWindowsButton
              hiddenIds={hiddenCanvases}
              sessions={allSessions}
              activeIds={sessionsWithActivity}
              onShow={onShowCanvas}
            />
          )}
          <div className="flex items-center gap-1">
            <ToggleButton
              active={false}
              onClick={() => { onUiClick?.('save'); tilePanels('vertical') }}
              style={{ padding: '6px 8px' }}
            >
              <span title="Tile open windows vertically (stacked)" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <TileVerticalIcon />
              </span>
            </ToggleButton>
            <ToggleButton
              active={false}
              onClick={() => { onUiClick?.('save'); tilePanels('horizontal') }}
              style={{ padding: '6px 8px' }}
            >
              <span title="Tile open windows horizontally (side by side)" style={{ display: 'inline-flex', alignItems: 'center' }}>
                <TileHorizontalIcon />
              </span>
            </ToggleButton>
          </div>
          <ToggleButton active={false} onClick={() => { onUiClick?.('save'); saveLayout() }}>Save UI</ToggleButton>
          <ToggleButton active={false} onClick={() => { onUiClick?.('reset'); handleReset() }}>Reset UI</ToggleButton>
          <ToggleButton active={!isMuted} onClick={onToggleMute} style={{ border: `1px solid ${COLORS.toggleBorder}` }}>
            {isMuted ? <MutedIcon /> : <UnmutedIcon />}
          </ToggleButton>
        </div>
      </div>
    </FloatingPanel>
  )
})

// ─── Workspace filter button + popover ──────────────────────────────────────

function WorkspaceFilterButton({
  workspaceFilter,
  sessions,
  onRemoveSession,
}: {
  workspaceFilter: WorkspaceFilterAPI
  sessions: SessionInfo[]
  onRemoveSession: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Anchored to the button via getBoundingClientRect; rendered through a
  // portal so the FloatingPanel's `overflow: hidden` doesn't clip it.
  const buttonRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number } | null>(null)
  const { knownWorkspaces, isVisible, setVisibility, showAll, isolate } = workspaceFilter

  useEffect(() => {
    if (!open) { setAnchorRect(null); return }
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (r) setAnchorRect({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  // Per-cwd: total sessions, and how many of those aren't actively
  // broadcasting (status !== 'active'). The latter is what the "clear" button
  // removes from the registry.
  const { totals, stale } = useMemo(() => {
    const t = new Map<string, number>()
    const s = new Map<string, number>()
    for (const sess of sessions) {
      if (!sess.cwd) continue
      t.set(sess.cwd, (t.get(sess.cwd) ?? 0) + 1)
      if (sess.status !== 'active') s.set(sess.cwd, (s.get(sess.cwd) ?? 0) + 1)
    }
    return { totals: t, stale: s }
  }, [sessions])

  const clearStale = useCallback((cwd: string) => {
    for (const sess of sessions) {
      if (sess.cwd === cwd && sess.status !== 'active') onRemoveSession(sess.id)
    }
  }, [sessions, onRemoveSession])

  const totalCount = knownWorkspaces.length
  const hiddenCount = knownWorkspaces.filter(w => !isVisible(w)).length
  const visibleCount = totalCount - hiddenCount
  const labelStr = totalCount > 0 ? `Workspaces (${visibleCount}/${totalCount})` : 'Workspaces'

  const popoverContent = (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: anchorRect?.top ?? 0,
        right: anchorRect?.right ?? 0,
        minWidth: 560,
        maxHeight: 420,
        overflowY: 'auto',
        padding: 8,
        background: COLORS.panelBg,
        border: `1px solid ${COLORS.glassBorder}`,
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        zIndex: 99999,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono" style={{ color: COLORS.textMuted, letterSpacing: '0.08em' }}>
              AVAILABLE WORKSPACES
            </span>
            <button
              onClick={showAll}
              className="text-[11px] font-mono"
              style={{ color: COLORS.holoBase, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              show all
            </button>
          </div>

          {knownWorkspaces.length === 0 ? (
            <div className="text-[12px] font-mono py-2 px-1" style={{ color: COLORS.textMuted }}>
              No workspaces detected yet. Sessions from new cwds will appear here.
            </div>
          ) : (
            knownWorkspaces.map(cwd => {
              const visible = isVisible(cwd)
              const total = totals.get(cwd) ?? 0
              const staleCount = stale.get(cwd) ?? 0
              const active = total - staleCount
              return (
                <div
                  key={cwd}
                  className="flex items-center gap-2 py-1 px-1 rounded"
                  style={{
                    cursor: 'pointer',
                    background: visible ? 'transparent' : COLORS.holoBg03,
                    opacity: visible ? 1 : 0.55,
                  }}
                  onClick={() => setVisibility(cwd, !visible)}
                  title={cwd}
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    // Toggle here directly so clicking the checkbox itself works.
                    // stopPropagation prevents the parent row's onClick from
                    // firing a second toggle that would cancel this one out.
                    onChange={(e) => setVisibility(cwd, e.target.checked)}
                    onClick={e => e.stopPropagation()}
                    style={{ accentColor: COLORS.holoBase, cursor: 'pointer' }}
                  />
                  <span
                    className="flex-1 text-[13px] font-mono truncate"
                    style={{ color: visible ? COLORS.textPrimary : COLORS.textMuted }}
                  >
                    {shortenPath(cwd)}
                  </span>
                  <span
                    className="text-[16px] font-mono"
                    style={{ color: COLORS.textMuted }}
                    title={`${active} active, ${staleCount} stale`}
                  >
                    {total > 0 ? (
                      <>
                        <span style={{ color: active > 0 ? COLORS.complete : COLORS.textMuted }}>{active}</span>
                        {staleCount > 0 && <span style={{ color: COLORS.textMuted }}>{` +${staleCount}`}</span>}
                      </>
                    ) : '—'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); clearStale(cwd) }}
                    disabled={staleCount === 0}
                    title={staleCount > 0
                      ? `Remove ${staleCount} inactive session${staleCount === 1 ? '' : 's'}`
                      : 'No inactive sessions to clear'}
                    className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                    style={{
                      background: staleCount > 0 ? COLORS.holoBg05 : 'transparent',
                      border: `1px solid ${staleCount > 0 ? COLORS.holoBorder06 : 'transparent'}`,
                      color: staleCount > 0 ? COLORS.textPrimary : COLORS.textMuted + '60',
                      cursor: staleCount > 0 ? 'pointer' : 'default',
                      opacity: staleCount > 0 ? 1 : 0.4,
                    }}
                  >
                    clear
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); isolate(cwd) }}
                    title="Show only this workspace"
                    className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                    style={{
                      background: COLORS.holoBg05,
                      border: `1px solid ${COLORS.holoBorder06}`,
                      color: COLORS.textMuted,
                      cursor: 'pointer',
                    }}
                  >
                    only
                  </button>
                </div>
              )
            })
          )}
    </div>
  )

  return (
    <>
      <div ref={buttonRef} style={{ display: 'inline-flex' }}>
        <ToggleButton active={hiddenCount > 0} onClick={() => setOpen(o => !o)}>
          {labelStr}
        </ToggleButton>
      </div>
      {open && anchorRect && typeof document !== 'undefined' && createPortal(popoverContent, document.body)}
    </>
  )
}


// ─── Closed windows button + popover ───────────────────────────────────────
// One button labeled "Windows · N" that opens a popover listing each ✕-closed
// canvas as a clickable row. Replaces an earlier inline-chip strip that grew
// unwieldy when many canvases were closed.

function ClosedWindowsButton({
  hiddenIds,
  sessions,
  activeIds,
  onShow,
}: {
  hiddenIds: ReadonlySet<string>
  sessions: SessionInfo[]
  activeIds: ReadonlySet<string>
  onShow: (sessionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number } | null>(null)

  const items = useMemo(() => {
    const byId = new Map(sessions.map(s => [s.id, s]))
    return [...hiddenIds].map(id => ({
      id,
      label: byId.get(id)?.label ?? id.slice(0, 8),
      active: activeIds.has(id),
    }))
  }, [hiddenIds, sessions, activeIds])

  useEffect(() => {
    if (!open) { setAnchorRect(null); return }
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (r) setAnchorRect({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const isEmpty = items.length === 0

  const popoverContent = (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: anchorRect?.top ?? 0,
        right: anchorRect?.right ?? 0,
        minWidth: 240,
        maxHeight: 360,
        overflow: 'auto',
        padding: 6,
        background: COLORS.panelBg,
        border: `1px solid ${COLORS.glassBorder}`,
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        zIndex: 99999,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onShow(item.id)}
          title={item.active ? `Reopen "${item.label}" (active)` : `Reopen "${item.label}"`}
          className="rounded transition-all"
          style={{
            padding: '6px 10px',
            fontSize: 12,
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            color: COLORS.textPrimary,
            background: COLORS.toggleInactive,
            border: `1px dashed ${COLORS.toggleBorder}`,
            opacity: 0.9,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            textAlign: 'left',
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.active ? (
            <span
              aria-hidden
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: COLORS.complete,
                boxShadow: `0 0 4px ${COLORS.complete}`,
                flexShrink: 0,
              }}
            />
          ) : (
            <span aria-hidden style={{ width: 8, flexShrink: 0 }} />
          )}
          <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>↩</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <>
      <div
        ref={buttonRef}
        style={{
          display: 'inline-flex',
          opacity: isEmpty ? 0.5 : 1,
          cursor: isEmpty ? 'not-allowed' : 'pointer',
        }}
        title={isEmpty ? 'No closed windows' : undefined}
      >
        <ToggleButton
          active={open && !isEmpty}
          onClick={() => { if (!isEmpty) setOpen(o => !o) }}
          style={isEmpty ? { pointerEvents: 'none' } : undefined}
        >
          {`Windows · ${items.length}`}
        </ToggleButton>
      </div>
      {open && !isEmpty && anchorRect && typeof document !== 'undefined' && createPortal(popoverContent, document.body)}
    </>
  )
}

/** Trim home prefix and middle path segments so long cwds stay readable. */
function shortenPath(p: string): string {
  const home = '/home/'
  let s = p
  if (s.startsWith(home)) {
    const slash = s.indexOf('/', home.length)
    s = slash > 0 ? '~' + s.slice(slash) : '~'
  }
  if (s.length <= 48) return s
  // Keep first segment and last two segments, ellipsize the middle.
  const parts = s.split('/').filter(Boolean)
  if (parts.length <= 3) return s
  return `${parts[0]}/…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}
