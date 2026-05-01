'use client'

import { type ReactNode, useCallback, useRef, useEffect, useState } from 'react'
import { Rnd } from 'react-rnd'
import { usePanelLayout, type PanelId, type PanelRect } from '@/hooks/use-panel-layout'
import { COLORS } from '@/lib/colors'
import { stopPropagationHandlers } from './shared-ui'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FloatingPanelProps {
  id: PanelId
  defaultRect: { x: number; y: number; w: number; h: number }
  minW?: number
  minH?: number
  visible?: boolean
  onClose?: () => void
  title?: string
  children: ReactNode
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function FloatingPanel({
  id,
  defaultRect,
  minW = 120,
  minH = 48,
  visible = true,
  onClose,
  title,
  children,
}: FloatingPanelProps) {
  const { getPanelRect, setPanelRect, bringToFront } = usePanelLayout()

  // Track if we've mounted (for SSR safety with window-based defaults)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Resolve the stored/default rect
  const rect = getPanelRect(id, defaultRect)

  // Keep a ref so drag/resize handlers always read the latest rect
  const rectRef = useRef<PanelRect>(rect)
  rectRef.current = rect

  const handleDragStop = useCallback((_e: unknown, d: { x: number; y: number }) => {
    setPanelRect(id, { x: d.x, y: d.y })
  }, [id, setPanelRect])

  const handleResizeStop = useCallback(
    (_e: unknown, _dir: unknown, ref: HTMLElement, _delta: unknown, position: { x: number; y: number }) => {
      setPanelRect(id, {
        w: ref.offsetWidth,
        h: ref.offsetHeight,
        x: position.x,
        y: position.y,
      })
    },
    [id, setPanelRect],
  )

  const handleMouseDown = useCallback(() => {
    bringToFront(id)
  }, [id, bringToFront])

  if (!visible || !mounted) return null

  return (
    <Rnd
      position={{ x: rect.x, y: rect.y }}
      size={{ width: rect.w, height: rect.h }}
      minWidth={minW}
      minHeight={minH}
      bounds="window"
      dragHandleClassName="floating-panel-handle"
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      onMouseDown={handleMouseDown}
      style={{
        zIndex: rect.z,
        pointerEvents: 'auto',
      }}
      enableResizing={{
        top: true,
        right: true,
        bottom: true,
        left: true,
        topRight: true,
        bottomRight: true,
        bottomLeft: true,
        topLeft: true,
      }}
    >
      <div
        {...stopPropagationHandlers}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: COLORS.glassBg,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: `1px solid ${COLORS.glassBorder}`,
          borderRadius: 8,
          boxShadow: '0 0 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(100, 200, 255, 0.08)',
          overflow: 'hidden',
        }}
      >
        {/* Title bar / drag handle */}
        {title != null && (
          <div
            className="floating-panel-handle"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 10px',
              cursor: 'grab',
              borderBottom: `1px solid ${COLORS.holoBorder06}`,
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                letterSpacing: '0.08em',
                fontWeight: 600,
                color: COLORS.textPrimary,
              }}
            >
              {title}
            </span>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  fontSize: 10,
                  color: COLORS.textMuted,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0 2px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* If no title, we still need a drag handle — a thin invisible bar */}
        {title == null && (
          <div
            className="floating-panel-handle"
            style={{
              height: 6,
              cursor: 'grab',
              flexShrink: 0,
            }}
          />
        )}

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </Rnd>
  )
}
