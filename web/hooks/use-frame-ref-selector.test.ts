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

  it('mounts N selectors but registers only one shared timer', () => {
    // Regression guard for the multi-canvas perf fix: 12 selectors used to
    // create 12 setIntervals (3 canvases × 4 selectors each), clustering
    // wakeups into long-task fragments under CPU throttle. The shared
    // ticker collapses them into a single setInterval.
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const initialCalls = setIntervalSpy.mock.calls.length

    const state = createEmptyState({ currentTime: 1, isPlaying: true })
    const ref = { current: state }

    const hooks = [
      renderHook(() => useFrameRefSelector(ref, (s) => s.currentTime)),
      renderHook(() => useFrameRefSelector(ref, (s) => s.isPlaying)),
      renderHook(() => useFrameRefSelector(ref, (s) => s.speed)),
      renderHook(() => useFrameRefSelector(ref, (s) => s.maxTimeReached)),
    ]

    // 4 selectors mounted — only ONE additional setInterval should have fired.
    expect(setIntervalSpy.mock.calls.length - initialCalls).toBe(1)

    // Mounting more selectors must not allocate further intervals.
    const more = [
      renderHook(() => useFrameRefSelector(ref, (s) => s.currentTime)),
      renderHook(() => useFrameRefSelector(ref, (s) => s.isPlaying)),
    ]
    expect(setIntervalSpy.mock.calls.length - initialCalls).toBe(1)

    // Cleanup so the shared ticker doesn't leak across tests.
    for (const h of [...hooks, ...more]) h.unmount()
    setIntervalSpy.mockRestore()
  })
})
