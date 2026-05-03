'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { COLORS } from '@/lib/colors'
import { FRAME_CAP_OPTIONS, BLOOM_THROTTLE_OPTIONS, EFFECT_LABELS, type EffectToggles } from '@/hooks/use-perf-settings'

const SAMPLE_WINDOW_MS = 1000
const UPDATE_INTERVAL_MS = 500

const FPS_GOOD = 55
const FPS_CAUTION = 30

function colorFor(fps: number): string {
  if (fps >= FPS_GOOD) return COLORS.complete
  if (fps >= FPS_CAUTION) return COLORS.tool
  return COLORS.error
}

interface FPSIndicatorProps {
  frameCap: number
  onFrameCapChange: (fps: number) => void
  effects: EffectToggles
  onEffectChange: (key: keyof EffectToggles, value: boolean) => void
  bloomThrottle: number
  onBloomThrottleChange: (value: number) => void
}

export function FPSIndicator({
  frameCap,
  onFrameCapChange,
  effects,
  onEffectChange,
  bloomThrottle,
  onBloomThrottleChange,
}: FPSIndicatorProps) {
  const [fps, setFps] = useState(0)
  const framesRef = useRef<number[]>([])
  const lastUpdateRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const tick = (timestamp: number) => {
      const frames = framesRef.current
      frames.push(timestamp)
      const cutoff = timestamp - SAMPLE_WINDOW_MS
      while (frames.length > 0 && frames[0] < cutoff) frames.shift()

      if (timestamp - lastUpdateRef.current >= UPDATE_INTERVAL_MS) {
        lastUpdateRef.current = timestamp
        setFps(frames.length)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Anchored to the LEFT of the button (the FPS pill sits at the far left of
  // the top bar), unlike the right-anchored popovers on the right-side
  // buttons.
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) { setAnchorRect(null); return }
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (r) setAnchorRect({ top: r.bottom + 6, left: r.left })
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

  const color = colorFor(fps)

  const popoverContent = (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: anchorRect?.top ?? 0,
        left: anchorRect?.left ?? 0,
        minWidth: 260,
        padding: 10,
        background: COLORS.panelBg,
        border: `1px solid ${COLORS.glassBorder}`,
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        zIndex: 99999,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div className="text-[10px] font-mono mb-2" style={{ color: COLORS.textMuted, letterSpacing: '0.08em' }}>
        FRAME CAP
      </div>
      <select
        value={frameCap}
        onChange={(e) => onFrameCapChange(Number(e.target.value))}
        className="w-full font-mono text-[11px] px-2 py-1 rounded mb-3"
        style={{
          background: COLORS.toggleInactive,
          border: `1px solid ${COLORS.toggleBorder}`,
          color: COLORS.textPrimary,
          cursor: 'pointer',
        }}
      >
        {FRAME_CAP_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <div className="text-[10px] font-mono mb-1" style={{ color: COLORS.textMuted, letterSpacing: '0.08em' }}>
        EFFECTS
      </div>
      {(Object.keys(EFFECT_LABELS) as Array<keyof EffectToggles>).map(key => (
        <label
          key={key}
          className="flex items-center gap-2 py-1 px-1 rounded cursor-pointer"
          style={{ color: effects[key] ? COLORS.textPrimary : COLORS.textMuted }}
        >
          <input
            type="checkbox"
            checked={effects[key]}
            onChange={(e) => onEffectChange(key, e.target.checked)}
            style={{ accentColor: COLORS.holoBase, cursor: 'pointer' }}
          />
          <span className="text-[10px] font-mono">{EFFECT_LABELS[key]}</span>
        </label>
      ))}
      {effects.bloom && (
        <>
          <div className="text-[10px] font-mono mt-3 mb-1" style={{ color: COLORS.textMuted, letterSpacing: '0.08em' }}>
            BLOOM RATE
          </div>
          <select
            value={bloomThrottle}
            onChange={(e) => onBloomThrottleChange(Number(e.target.value))}
            className="w-full font-mono text-[11px] px-2 py-1 rounded mb-1"
            style={{
              background: COLORS.toggleInactive,
              border: `1px solid ${COLORS.toggleBorder}`,
              color: COLORS.textPrimary,
              cursor: 'pointer',
            }}
          >
            {BLOOM_THROTTLE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </>
      )}

      <div className="text-[9px] font-mono mt-2 pt-2" style={{ color: COLORS.textMuted, borderTop: `1px solid ${COLORS.holoBorder06}` }}>
        Lower cap saves power; bloom is the heaviest Canvas2D effect.
      </div>
    </div>
  )

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Browser frame rate (rAF). Click to open performance settings."
        className="font-mono"
        style={{
          height: 32,
          padding: '0 14px',
          fontSize: 13,
          lineHeight: '32px',
          background: hover || open
            ? 'rgba(100, 200, 255, 0.12)'
            : 'rgba(100, 200, 255, 0.06)',
          border: '1px solid rgba(100, 200, 255, 0.18)',
          borderRadius: 4,
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: COLORS.textPrimary,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: color, boxShadow: `0 0 4px ${color}`,
          }}
        />
        <span style={{ color }}>{fps}</span>
        <span style={{ color: COLORS.textMuted, fontSize: 12 }}>fps</span>
        <span style={{ color: COLORS.textMuted, fontSize: 11, marginLeft: 2 }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && anchorRect && typeof document !== 'undefined' && createPortal(popoverContent, document.body)}
    </>
  )
}
