'use client'

import { useEffect, useRef, useState } from 'react'
import { COLORS } from '@/lib/colors'

const SAMPLE_WINDOW_MS = 1000
const UPDATE_INTERVAL_MS = 500

const FPS_GOOD = 55
const FPS_CAUTION = 30

function colorFor(fps: number): string {
  if (fps >= FPS_GOOD) return COLORS.complete
  if (fps >= FPS_CAUTION) return COLORS.tool
  return COLORS.error
}

export function FPSIndicator() {
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

  const color = colorFor(fps)
  return (
    <div
      title="Browser frame rate (rAF). Page-wide; reflects overall render budget."
      className="font-mono"
      style={{
        height: 26,
        padding: '0 10px',
        fontSize: 11,
        lineHeight: '26px',
        background: 'rgba(100, 200, 255, 0.06)',
        border: '1px solid rgba(100, 200, 255, 0.18)',
        borderRadius: 4,
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        color: COLORS.textPrimary,
      }}
    >
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color, boxShadow: `0 0 4px ${color}`,
        }}
      />
      <span style={{ color }}>{fps}</span>
      <span style={{ color: COLORS.textMuted, fontSize: 10 }}>fps</span>
    </div>
  )
}
