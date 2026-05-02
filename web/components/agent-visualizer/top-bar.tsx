"use client"

import { memo, useRef, useState } from "react"
import { COLORS } from "@/lib/colors"
import { formatTokens } from "@/lib/utils"
import { agentCost } from "./canvas/draw-cost"
import { SessionTabs } from "./session-tabs"
import { FloatingPanel } from "./floating-panel"
import { usePanelLayout } from "@/hooks/use-panel-layout"
import type { SessionInfo, ConnectionStatus } from "@/lib/bridge-types"

// ─── Mute/Unmute SVG Icons ───────────────────────────────────────────────────

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
  selectedSessionId: string | null
  sessionsWithActivity: Set<string>
  onSelectSession: (id: string) => void
  onCloseSession: (id: string) => void
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
  isMuted: boolean
  onTogglePanel: (panel: 'files' | 'transcript' | 'cost') => void
  onToggleTimeline: () => void
  onToggleMute: () => void
  /** Optional UI feedback sound for top-bar button clicks. */
  onUiClick?: (variant: 'save' | 'reset') => void
}

export const TopBar = memo(function TopBar({
  sessions, selectedSessionId, sessionsWithActivity,
  onSelectSession, onCloseSession,
  isVSCode, connectionStatus,
  agentCount, totalTokens,
  showFileAttention, showTranscript, showCostOverlay, showTimeline, isMuted,
  onTogglePanel, onToggleTimeline, onToggleMute, onUiClick,
}: TopBarProps) {
  const { resetLayout, saveLayout, hardResetLayout, instanceId, hostId, otherInstances } = usePanelLayout()
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
            height: 26, padding: '0 10px',
            fontSize: 11, lineHeight: '26px',
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

        {/* Spacer pushes info to the right */}
        <div className="flex-1" />

        {/* Right-side info/controls */}
        <div className="flex items-center gap-4 flex-shrink-0" style={{ color: COLORS.textMuted }}>
          {isVSCode && <ConnectionIndicator status={connectionStatus} />}

          {/* Panel toggle group */}
          <div className="flex items-center gap-1 px-1 py-0.5 rounded" style={{
            background: COLORS.holoBg03,
            border: `1px solid ${COLORS.holoBorder06}`,
          }}>
            <ToggleButton active={showFileAttention} onClick={() => onTogglePanel('files')} style={{ background: showFileAttention ? undefined : 'transparent', border: 'none' }}>Files</ToggleButton>
            <ToggleButton active={showTranscript} onClick={() => onTogglePanel('transcript')} style={{ background: showTranscript ? undefined : 'transparent', border: 'none' }}>Chat</ToggleButton>
            <ToggleButton
              active={showCostOverlay}
              onClick={() => onTogglePanel('cost')}
              activeColor={{ bg: COLORS.costActiveBg, text: COLORS.complete }}
              style={{ background: showCostOverlay ? undefined : 'transparent', border: 'none' }}
            >
              $Cost
            </ToggleButton>
          </div>

          {/* Independent toggles */}
          <ToggleButton active={showTimeline} onClick={onToggleTimeline}>Timeline</ToggleButton>
          <ToggleButton active={!isMuted} onClick={onToggleMute} style={{ border: `1px solid ${COLORS.toggleBorder}` }}>
            {isMuted ? <MutedIcon /> : <UnmutedIcon />}
          </ToggleButton>
          <ToggleButton active={false} onClick={() => { onUiClick?.('save'); saveLayout() }}>Save UI</ToggleButton>
          <ToggleButton active={false} onClick={() => { onUiClick?.('reset'); handleReset() }}>Reset UI</ToggleButton>
        </div>
      </div>
    </FloatingPanel>
  )
})
