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
  showHandle?: boolean
  /** Skip the CSS-zoom font scaling for this panel's content. Canvases handle
   *  their own DPR scaling and double-scaling makes them blurry. */
  noContentZoom?: boolean
  children: ReactNode
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const FONT_STEP = 0.1
const FONT_MIN = 0.5
const FONT_MAX = 3.0

// ─── Component ─────────────────────────────────────────────────────────────────

export function FloatingPanel({
  id,
  defaultRect,
  minW = 120,
  minH = 48,
  visible = true,
  onClose,
  title,
  showHandle = true,
  noContentZoom = false,
  children,
}: FloatingPanelProps) {
  const { getPanelRect, setPanelRect, bringToFront, sendPanelToNext, sendPanelToPrev, otherInstances } = usePanelLayout()

  // Track if we've mounted (for SSR safety with window-based defaults)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Resolve the stored/default rect, clamping below-minimums so a stale
  // persisted rect can't render the panel too small to interact with.
  const rawRect = getPanelRect(id, defaultRect)
  const rect: PanelRect = {
    ...rawRect,
    w: Math.max(rawRect.w, minW),
    h: Math.max(rawRect.h, minH),
  }

  // Per-panel user font scale (default 1.0). Resizing multiplies on top.
  const userScale = rect.s ?? 1
  const resizeMultiplier = Math.min(
    2.5,
    Math.max(1, Math.min(rect.w / defaultRect.w, rect.h / defaultRect.h)),
  )
  const contentZoom = Math.min(5, Math.max(0.25, userScale * resizeMultiplier))

  // Keep a ref so drag/resize handlers always read the latest rect
  const rectRef = useRef<PanelRect>(rect)
  rectRef.current = rect

  const adjustFont = useCallback((delta: number) => {
    const current = (rectRef.current.s ?? 1)
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, +(current + delta).toFixed(2)))
    setPanelRect(id, { ...rectRef.current, s: next })
  }, [id, setPanelRect])

  // Double-click on a resize handle: snap w/h to defaultRect, keep x/y if possible
  // (clamp into viewport so the panel never lands partly off-screen).
  const resetToDefaultSize = useCallback(() => {
    const winW = typeof window !== 'undefined' ? window.innerWidth : 1280
    const winH = typeof window !== 'undefined' ? window.innerHeight : 720
    const w = Math.min(defaultRect.w, winW)
    const h = Math.min(defaultRect.h, winH)
    let x = rectRef.current.x
    let y = rectRef.current.y
    if (x + w > winW) x = Math.max(0, winW - w)
    if (y + h > winH) y = Math.max(0, winH - h)
    if (x < 0) x = 0
    if (y < 0) y = 0
    setPanelRect(id, { ...rectRef.current, x, y, w, h })
  }, [id, defaultRect.w, defaultRect.h, setPanelRect])

  const handleDragStop = useCallback((_e: unknown, d: { x: number; y: number }) => {
    setPanelRect(id, { ...rectRef.current, x: d.x, y: d.y })
  }, [id, setPanelRect])

  const handleResizeStop = useCallback(
    (_e: unknown, _dir: unknown, ref: HTMLElement, _delta: unknown, position: { x: number; y: number }) => {
      setPanelRect(id, {
        ...rectRef.current,
        w: ref.offsetWidth,
        h: ref.offsetHeight,
        x: position.x,
        y: position.y,
      })
    },
    [id, setPanelRect],
  )

  const handleMouseDown = useCallback(() => {
    bringToFront(id, rectRef.current)
  }, [id, bringToFront])

  if (!visible || !mounted) return null
  if (rect.hidden) return null

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
      resizeHandleComponent={{
        top: <ResizeHandleSurface onDoubleClick={resetToDefaultSize} />,
        right: <ResizeHandleSurface onDoubleClick={resetToDefaultSize} />,
        bottom: <ResizeHandleSurface onDoubleClick={resetToDefaultSize} />,
        left: <ResizeHandleSurface onDoubleClick={resetToDefaultSize} />,
        topRight: <ResizeHandleSurface onDoubleClick={resetToDefaultSize} />,
        bottomRight: <ResizeHandleSurface onDoubleClick={resetToDefaultSize} />,
        bottomLeft: <ResizeHandleSurface onDoubleClick={resetToDefaultSize} />,
        topLeft: <ResizeHandleSurface onDoubleClick={resetToDefaultSize} />,
      }}
    >
      <div
        // Capture-phase mousedown so bringToFront fires *before* the inner
        // content's stopPropagationHandlers can halt the event. Without this,
        // clicking inside a panel that has stopPropagation handlers (e.g. a
        // session canvas) would never reach Rnd's bubble-phase onMouseDown.
        onMouseDownCapture={handleMouseDown}
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
              position: 'relative',
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
            {showHandle && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 28,
                  height: 3,
                  borderRadius: 1.5,
                  background: COLORS.textPrimary,
                  opacity: 0.65,
                  pointerEvents: 'none',
                }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <FontScaleButtons onAdjust={adjustFont} />
              {otherInstances.length > 0 && (
                <>
                  <SendButton direction="prev" onSend={() => sendPanelToPrev(id)} />
                  <SendButton direction="next" onSend={() => sendPanelToNext(id)} />
                </>
              )}
              {onClose && (
                <button
                  onClick={onClose}
                  style={{
                    fontSize: 15,
                    color: COLORS.textMuted,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0 4px',
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}

        {/* If no title, render a thin bar (grip + font controls). Grip is hidden when showHandle is false but the bar still acts as the drag handle. */}
        {title == null && (
          <div
            className="floating-panel-handle"
            style={{
              position: 'relative',
              height: 24,
              cursor: 'grab',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: `1px solid ${COLORS.holoBorder06}`,
              userSelect: 'none',
            }}
          >
            {showHandle && (
              <div
                style={{
                  width: 32,
                  height: 3,
                  borderRadius: 1.5,
                  background: COLORS.textPrimary,
                  opacity: 0.65,
                }}
              />
            )}
            <div style={{ position: 'absolute', right: 4, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
              <FontScaleButtons onAdjust={adjustFont} />
              {otherInstances.length > 0 && (
                <>
                  <SendButton direction="prev" onSend={() => sendPanelToPrev(id)} />
                  <SendButton direction="next" onSend={() => sendPanelToNext(id)} />
                </>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div
          {...stopPropagationHandlers}
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            ...(noContentZoom ? null : { zoom: contentZoom }),
          }}
        >
          {children}
        </div>
      </div>
    </Rnd>
  )
}

// ─── Font scale buttons ─────────────────────────────────────────────────────────

function FontScaleButtons({ onAdjust }: { onAdjust: (delta: number) => void }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const buttonStyle: React.CSSProperties = {
    fontSize: 17,
    lineHeight: 1,
    color: COLORS.textPrimary,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 6px',
    opacity: 0.7,
  }
  return (
    <>
      <button
        type="button"
        onMouseDown={stop}
        onClick={(e) => { stop(e); onAdjust(-FONT_STEP) }}
        title="Decrease font size"
        style={buttonStyle}
      >
        −
      </button>
      <button
        type="button"
        onMouseDown={stop}
        onClick={(e) => { stop(e); onAdjust(FONT_STEP) }}
        title="Increase font size"
        style={buttonStyle}
      >
        +
      </button>
    </>
  )
}

// ─── Resize-handle surface ─────────────────────────────────────────────────────
// Fills the entire handle area react-rnd creates. Captures double-click without
// interfering with single-click resize drag (mousedown still bubbles to Rnd).

function ResizeHandleSurface({ onDoubleClick }: { onDoubleClick: () => void }) {
  return <div onDoubleClick={onDoubleClick} style={{ width: '100%', height: '100%' }} />
}

// ─── Send-to-next-instance button ──────────────────────────────────────────────

function SendButton({ direction, onSend }: { direction: 'prev' | 'next'; onSend: () => void }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <button
      type="button"
      onMouseDown={stop}
      onClick={(e) => { stop(e); onSend() }}
      title={direction === 'next' ? 'Send to next browser instance' : 'Send to previous browser instance'}
      style={{
        fontSize: 17,
        lineHeight: 1,
        color: COLORS.textPrimary,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '0 6px',
        opacity: 0.7,
      }}
    >
      {direction === 'next' ? '→' : '←'}
    </button>
  )
}
