'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { COLORS } from '@/lib/colors'
import { stopPropagationHandlers } from './shared-ui'

/**
 * Small overlay button rendered on top of an AgentCanvas. Lets the user set
 * a per-canvas minimum auto-fit zoom (0 = off, 0.05–2.0). When non-zero,
 * the auto-fit camera won't zoom the canvas out below this level — pan
 * stays free and wheel zoom is unaffected.
 *
 * The popover is rendered through a portal so it can escape the canvas's
 * overflow:hidden and the FloatingPanel that wraps it.
 */
export function CanvasZoomControl({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number } | null>(null)

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
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const pct = Math.round(value * 100)
  const active = value > 0
  const label = active ? `${pct}%` : '⊘'

  const popover = (
    <div
      ref={popoverRef}
      {...stopPropagationHandlers}
      style={{
        position: 'fixed',
        top: anchorRect?.top ?? 0,
        right: anchorRect?.right ?? 0,
        zIndex: 10000,
        minWidth: 320,
        padding: 16,
        background: COLORS.glassBg,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${COLORS.glassBorder}`,
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        fontFamily: 'monospace',
      }}
    >
      <div style={{ fontSize: 14, color: COLORS.textPrimary, marginBottom: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
        <span>Min zoom</span>
        <span style={{ color: COLORS.textMuted }}>{active ? `${pct}%` : 'off'}</span>
      </div>
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ width: '100%', accentColor: COLORS.holoBase, height: 20 }}
        aria-label="Minimum auto-fit zoom level"
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>
        <span>off</span>
        <span>50%</span>
        <span>100%</span>
        <span>150%</span>
        <span>200%</span>
      </div>
      <div style={{ marginTop: 12, fontSize: 12, color: COLORS.textMuted, lineHeight: 1.5 }}>
        Floors this canvas&apos;s auto-fit zoom at the chosen level.
        Set to 200% to lock at the upper cap. Wheel zoom is unaffected.
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, gap: 8 }}>
        <button
          onClick={() => { onChange(0); setOpen(false) }}
          disabled={value === 0}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            color: value === 0 ? COLORS.textMuted : COLORS.textPrimary,
            background: 'transparent',
            border: `1px solid ${COLORS.toggleBorder}`,
            borderRadius: 5,
            cursor: value === 0 ? 'default' : 'pointer',
            opacity: value === 0 ? 0.5 : 1,
          }}
        >
          Reset
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{
            padding: '6px 18px',
            fontSize: 12,
            fontWeight: 600,
            color: COLORS.holoBright,
            background: `${COLORS.holoBase}22`,
            border: `1px solid ${COLORS.holoBase}66`,
            borderRadius: 5,
            cursor: 'pointer',
          }}
        >
          Set
        </button>
      </div>
    </div>
  )

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        onMouseDown={(e) => e.stopPropagation()}
        title={active ? `Min zoom locked at ${pct}%` : 'Set minimum auto-fit zoom'}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 5,
          padding: '6px 12px',
          fontSize: 14,
          fontFamily: 'monospace',
          fontWeight: 600,
          color: active ? COLORS.holoBase : COLORS.textMuted,
          background: active ? `${COLORS.holoBase}18` : 'rgba(10, 15, 30, 0.65)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: `1px solid ${active ? COLORS.holoBase + '40' : COLORS.toggleBorder}`,
          borderRadius: 6,
          cursor: 'pointer',
          minWidth: 56,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          opacity: active ? 1 : 0.85,
          lineHeight: 1,
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>🔍</span>
        <span>{label}</span>
      </button>
      {open && anchorRect && typeof document !== 'undefined' && createPortal(popover, document.body)}
    </>
  )
}
