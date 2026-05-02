import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFrameRefSelector } from './use-frame-ref-selector'
import { createEmptyState, type SimulationState } from './simulation/types'

describe('useFrameRefSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value from the ref', () => {
    const state = createEmptyState({ currentTime: 42 })
    const ref = { current: state }

    const { result } = renderHook(() =>
      useFrameRefSelector(ref, (s) => s.currentTime),
    )

    expect(result.current).toBe(42)
  })

  it('updates when the ref value changes and timer fires', () => {
    const state = createEmptyState({ currentTime: 0 })
    const ref = { current: state }

    const { result } = renderHook(() =>
      useFrameRefSelector(ref, (s) => s.currentTime),
    )

    expect(result.current).toBe(0)

    // Mutate the ref (simulating what the animation loop does).
    ref.current = createEmptyState({ currentTime: 10 })

    // Advance the polling timer.
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe(10)
  })

  it('does not re-render when the selected value is unchanged', () => {
    const state = createEmptyState({ isPlaying: true, currentTime: 5 })
    const ref = { current: state }

    const renderCount = { value: 0 }
    const { result } = renderHook(() => {
      renderCount.value++
      return useFrameRefSelector(ref, (s) => s.isPlaying)
    })

    expect(result.current).toBe(true)
    const afterInit = renderCount.value

    // Change currentTime but NOT isPlaying.
    ref.current = createEmptyState({ isPlaying: true, currentTime: 99 })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    // Should NOT have re-rendered — isPlaying didn't change.
    expect(renderCount.value).toBe(afterInit)
  })

  it('re-renders when the selected value changes', () => {
    const state = createEmptyState({ isPlaying: false })
    const ref = { current: state }

    const renderCount = { value: 0 }
    renderHook(() => {
      renderCount.value++
      return useFrameRefSelector(ref, (s) => s.isPlaying)
    })

    const afterInit = renderCount.value

    ref.current = createEmptyState({ isPlaying: true })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(renderCount.value).toBeGreaterThan(afterInit)
  })
})
