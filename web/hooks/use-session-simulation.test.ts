import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createSimulationManager, type SimulationManager } from '@/lib/simulation-manager'
import { useSessionSimulation } from './use-session-simulation'

describe('useSessionSimulation', () => {
  let manager: SimulationManager

  beforeEach(() => {
    manager = createSimulationManager()
    // Pre-register sessions so the hook doesn't need useEffect to run.
    manager.addSession('session-a')
    manager.addSession('session-b')
  })

  afterEach(() => {
    manager.destroy()
  })

  it('returns the session state', () => {
    const { result } = renderHook(() =>
      useSessionSimulation(manager, 'session-a'),
    )
    expect(result.current.agents.size).toBe(0)
    expect(result.current.isPlaying).toBe(true)
  })

  it('play/pause controls work', () => {
    const { result } = renderHook(() =>
      useSessionSimulation(manager, 'session-a'),
    )

    act(() => result.current.pause())
    expect(manager.getSessionState('session-a').isPlaying).toBe(false)

    act(() => result.current.play())
    expect(manager.getSessionState('session-a').isPlaying).toBe(true)
  })

  it('setSpeed updates the session speed', () => {
    const { result } = renderHook(() =>
      useSessionSimulation(manager, 'session-a'),
    )

    act(() => result.current.setSpeed(4))
    expect(manager.getSessionState('session-a').speed).toBe(4)
  })

  it('two hooks subscribed to different sessions are independent', () => {
    const renderCountA = { value: 0 }
    const renderCountB = { value: 0 }

    const hookA = renderHook(() => {
      renderCountA.value++
      return useSessionSimulation(manager, 'session-a')
    })

    const hookB = renderHook(() => {
      renderCountB.value++
      return useSessionSimulation(manager, 'session-b')
    })

    const afterInitA = renderCountA.value
    const afterInitB = renderCountB.value

    // Modify session B only.
    act(() => {
      manager.pause('session-b')
    })

    // Hook B should have re-rendered (isPlaying changed).
    expect(renderCountB.value).toBeGreaterThan(afterInitB)

    // Hook A should NOT have re-rendered.
    expect(renderCountA.value).toBe(afterInitA)
  })

  it('frameRef.current reads the latest state', () => {
    const { result } = renderHook(() =>
      useSessionSimulation(manager, 'session-a'),
    )

    act(() => manager.setSpeed('session-a', 5))

    // frameRef.current should reflect the updated speed.
    expect(result.current.frameRef.current.speed).toBe(5)
  })
})
