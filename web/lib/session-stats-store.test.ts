import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createSessionStatsStore, useSessionStatsSelector } from './session-stats-store'
import type { SessionStats } from '@/components/agent-visualizer/session-stats-provider'

function makeStats(overrides?: Partial<SessionStats>): SessionStats {
  return {
    agents: new Map(),
    toolCalls: new Map(),
    conversations: new Map(),
    ...overrides,
  }
}

describe('createSessionStatsStore', () => {
  it('starts with an empty map', () => {
    const store = createSessionStatsStore()
    expect(store.getSnapshot().size).toBe(0)
  })

  it('setSessionStats adds an entry and notifies subscribers', () => {
    const store = createSessionStatsStore()
    const listener = vi.fn()
    store.subscribe(listener)

    const stats = makeStats()
    store.setSessionStats('s1', stats)

    expect(store.getSnapshot().size).toBe(1)
    expect(store.getSnapshot().get('s1')).toBe(stats)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('setSessionStats dedupes when references are unchanged', () => {
    const store = createSessionStatsStore()
    const stats = makeStats()
    store.setSessionStats('s1', stats)

    const listener = vi.fn()
    store.subscribe(listener)

    // Same references — should not emit.
    store.setSessionStats('s1', stats)
    expect(listener).not.toHaveBeenCalled()
  })

  it('setSessionStats emits when a sub-field reference changes', () => {
    const store = createSessionStatsStore()
    const agents1 = new Map()
    const stats1 = makeStats({ agents: agents1 })
    store.setSessionStats('s1', stats1)

    const listener = vi.fn()
    store.subscribe(listener)

    const agents2 = new Map()
    store.setSessionStats('s1', makeStats({ agents: agents2 }))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('removeSessionStats removes the entry', () => {
    const store = createSessionStatsStore()
    store.setSessionStats('s1', makeStats())
    store.removeSessionStats('s1')
    expect(store.getSnapshot().size).toBe(0)
  })

  it('removeSessionStats is a no-op for unknown ids', () => {
    const store = createSessionStatsStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.removeSessionStats('unknown')
    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribe removes the listener', () => {
    const store = createSessionStatsStore()
    const listener = vi.fn()
    const unsub = store.subscribe(listener)
    unsub()
    store.setSessionStats('s1', makeStats())
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('useSessionStatsSelector', () => {
  it('returns the initial selector result', () => {
    const store = createSessionStatsStore()
    store.setSessionStats('s1', makeStats())

    const { result } = renderHook(() =>
      useSessionStatsSelector(store, (snap) => snap.size),
    )
    expect(result.current).toBe(1)
  })

  it('re-renders when selected slice changes', () => {
    const store = createSessionStatsStore()
    const renderCount = { value: 0 }

    const { result } = renderHook(() => {
      renderCount.value++
      return useSessionStatsSelector(store, (snap) => snap.size)
    })

    expect(result.current).toBe(0)
    const initialRenders = renderCount.value

    act(() => {
      store.setSessionStats('s1', makeStats())
    })

    expect(result.current).toBe(1)
    expect(renderCount.value).toBeGreaterThan(initialRenders)
  })

  it('does NOT re-render when selected slice is unchanged (different selector)', () => {
    const store = createSessionStatsStore()
    const agents1 = new Map()
    store.setSessionStats('s1', makeStats({ agents: agents1 }))

    const renderCount = { value: 0 }

    // Selector only looks at session count, not at the agent maps.
    const { result } = renderHook(() => {
      renderCount.value++
      return useSessionStatsSelector(store, (snap) => snap.size)
    })

    expect(result.current).toBe(1)
    const afterInitial = renderCount.value

    // Mutate s1 with new agents — size stays 1.
    act(() => {
      const agents2 = new Map()
      store.setSessionStats('s1', makeStats({ agents: agents2 }))
    })

    // The hook should NOT have re-rendered because the size didn't change.
    expect(result.current).toBe(1)
    expect(renderCount.value).toBe(afterInitial)
  })

  it('two selectors on the same store fire independently', () => {
    const store = createSessionStatsStore()
    const agents1 = new Map()
    const convos1 = new Map()
    store.setSessionStats('s1', makeStats({ agents: agents1, conversations: convos1 }))

    const agentRenderCount = { value: 0 }
    const convoRenderCount = { value: 0 }

    // Selector A: agent count
    const hookA = renderHook(() => {
      agentRenderCount.value++
      return useSessionStatsSelector(store, (snap) => {
        let count = 0
        for (const [, s] of snap) count += s.agents.size
        return count
      })
    })

    // Selector B: conversation count
    const hookB = renderHook(() => {
      convoRenderCount.value++
      return useSessionStatsSelector(store, (snap) => {
        let count = 0
        for (const [, s] of snap) count += s.conversations.size
        return count
      })
    })

    const afterInitA = agentRenderCount.value
    const afterInitB = convoRenderCount.value

    // Change only conversations.
    act(() => {
      const newConvos = new Map([['agent-1', [{ id: 'm1', type: 'assistant' as const, content: 'hi', timestamp: 0 }]]])
      store.setSessionStats('s1', makeStats({ agents: agents1, conversations: newConvos }))
    })

    // Hook B should have re-rendered (convo count went 0 -> 1).
    expect(hookB.result.current).toBe(1)
    expect(convoRenderCount.value).toBeGreaterThan(afterInitB)

    // Hook A should NOT have re-rendered (agent count stayed 0).
    expect(hookA.result.current).toBe(0)
    expect(agentRenderCount.value).toBe(afterInitA)
  })
})
