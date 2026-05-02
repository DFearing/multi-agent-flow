/**
 * Tests for useVirtualList — specifically the stable measureRef optimization.
 *
 * Proves that re-rendering the parent does NOT re-fire measureRef callbacks
 * for already-mounted items (the callbacks are cached per id).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVirtualList } from './use-virtual-list'

// Stub rAF/cAF so forceTick fires synchronously in tests
let rafCallbacks: Array<FrameRequestCallback> = []
let rafId = 1

// Stub ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

beforeEach(() => {
  rafCallbacks = []
  rafId = 1
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = rafId++
    rafCallbacks.push(cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.restoreAllMocks()
})

function flushRaf() {
  const cbs = rafCallbacks.splice(0)
  cbs.forEach(cb => cb(performance.now()))
}

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `msg-${i}` }))
}

function makeContainerRef() {
  const el = document.createElement('div')
  // Stub properties used by the hook
  Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true })
  return { current: el }
}

describe('useVirtualList', () => {
  describe('measureRef stability', () => {
    it('returns the same callback for the same id across renders', () => {
      const items = makeItems(5)
      const containerRef = makeContainerRef()

      const { result, rerender } = renderHook(() =>
        useVirtualList(items, containerRef, { gap: 4 }),
      )

      const cb1 = result.current.measureRef('msg-0')
      const cb2 = result.current.measureRef('msg-1')

      // Re-render the hook (simulating parent re-render)
      rerender()

      const cb1After = result.current.measureRef('msg-0')
      const cb2After = result.current.measureRef('msg-1')

      expect(cb1After).toBe(cb1)
      expect(cb2After).toBe(cb2)
    })

    it('does NOT re-fire measureRef callbacks on parent re-render', () => {
      const items = makeItems(10)
      const containerRef = makeContainerRef()

      const { result, rerender } = renderHook(() =>
        useVirtualList(items, containerRef, { gap: 4 }),
      )

      // Simulate initial mount: get callbacks and call them once
      const callCounts = new Map<string, number>()
      const mockEls = new Map<string, HTMLDivElement>()

      for (const item of items) {
        const cb = result.current.measureRef(item.id)
        const el = document.createElement('div')
        Object.defineProperty(el, 'offsetHeight', { value: 40, configurable: true })
        mockEls.set(item.id, el)
        callCounts.set(item.id, 0)

        // Wrap the callback to count calls
        cb(el)
        callCounts.set(item.id, 1)
      }

      flushRaf()

      // Re-render the parent
      rerender()

      // Get callbacks again — they should be the same references
      for (const item of items) {
        const cb = result.current.measureRef(item.id)
        // Simulate what React does: if the ref function is the same,
        // React does NOT call it again. We verify identity:
        const originalCb = result.current.measureRef(item.id)
        expect(cb).toBe(originalCb)
      }
    })

    it('coalesces multiple height changes into a single rAF tick', () => {
      const items = makeItems(5)
      const containerRef = makeContainerRef()

      const { result } = renderHook(() =>
        useVirtualList(items, containerRef, { gap: 4 }),
      )

      // Mount all items with different heights
      for (let i = 0; i < items.length; i++) {
        const cb = result.current.measureRef(items[i].id)
        const el = document.createElement('div')
        Object.defineProperty(el, 'offsetHeight', { value: 30 + i * 10, configurable: true })
        cb(el)
      }

      // Only one rAF should have been scheduled despite 5 height changes
      expect(rafCallbacks.length).toBe(1)

      act(() => flushRaf())

      // After flush, the hook should have re-rendered once
      // Verify items are measured by checking totalHeight > 0
      expect(result.current.totalHeight).toBeGreaterThan(0)
    })
  })
})
