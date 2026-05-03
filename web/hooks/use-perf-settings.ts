'use client'

import { useCallback } from 'react'
import { usePersistedState } from './use-persisted-state'

// ─── Frame cap ──────────────────────────────────────────────────────────────
// `0` means "uncapped" (let rAF run at the display refresh rate).
export const FRAME_CAP_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0,   label: 'Uncapped' },
  { value: 120, label: '120 FPS' },
  { value: 60,  label: '60 FPS' },
  { value: 30,  label: '30 FPS' },
  { value: 15,  label: '15 FPS' },
]

// ─── Bloom throttle ────────────────────────────────────────────────────────
// Run the bloom post-processing pass every Nth frame, caching the last result
// for intermediate frames.  `1` = every frame (default, no change in visual).
// Higher values reduce bloom CPU/GPU cost proportionally.
export const BLOOM_THROTTLE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Every frame' },
  { value: 2, label: 'Every 2nd frame (~50% saving)' },
  { value: 3, label: 'Every 3rd frame (~67% saving)' },
  { value: 4, label: 'Every 4th frame (~75% saving)' },
]

// ─── Effects ────────────────────────────────────────────────────────────────
// Each toggle controls one rendering feature that can be disabled to reduce
// per-frame GPU/CPU cost. Defaults are "everything on" — matches current
// behavior so users opt in to a perf trade rather than discovering missing
// effects after upgrading.
export interface EffectToggles {
  bloom: boolean
}

const DEFAULT_EFFECTS: EffectToggles = {
  bloom: true,
}

export const EFFECT_LABELS: Record<keyof EffectToggles, string> = {
  bloom: 'Bloom (post-processing glow)',
}

export function usePerfSettings() {
  const [frameCap, setFrameCap] = usePersistedState<number>(
    'agent-flow:frame-cap:v1',
    0,
  )
  const [effects, setEffects] = usePersistedState<EffectToggles>(
    'agent-flow:effects:v1',
    DEFAULT_EFFECTS,
  )
  const [bloomThrottle, setBloomThrottle] = usePersistedState<number>(
    'agent-flow:bloom-throttle:v1',
    1,
  )

  // Tolerate older persisted shapes by merging with defaults — adding a new
  // toggle later shouldn't blank out the saved value for the existing ones.
  const safeEffects: EffectToggles = { ...DEFAULT_EFFECTS, ...effects }

  const setEffect = useCallback(
    (key: keyof EffectToggles, value: boolean) => {
      setEffects(prev => ({ ...DEFAULT_EFFECTS, ...prev, [key]: value }))
    },
    [setEffects],
  )

  return { frameCap, setFrameCap, effects: safeEffects, setEffect, bloomThrottle, setBloomThrottle }
}
