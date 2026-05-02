/**
 * Unit tests for useCanvasVisibility hook.
 *
 * Validates the combined IntersectionObserver + document.visibilityState
 * gating logic, transition catch-up behavior, and pauseWhenOffscreen bypass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasVisibility } from './use-canvas-visibility'

// ─── IntersectionObserver mock ──────────────────────────────────────────────

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void

let ioInstances: Array<{ callback: IOCallback; disconnect: ReturnType<typeof vi.fn> }>

class MockIntersectionObserver {
  callback: IOCallback
  disconnect = vi.fn()

  constructor(callback: IOCallback) {
    this.callback = callback
    ioInstances.push({ callback, disconnect: this.disconnect })
  }

  observe() {
    // Fire initial callback as "intersecting" (matches real IO behavior)
    this.callback([{ isIntersecting: true }])
  }

  unobserve() { /* no-op */ }
}

// ─── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  ioInstances = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  // Default: document is visible
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeContainerRef() {
  // Create a real element so ownerDocument works
  const el = document.createElement('div')
  return { current: el }
}

function setDocVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

function fireVisibilityChange() {
  document.dispatchEvent(new Event('visibilitychange'))
}

function fireIO(intersecting: boolean) {
  const instance = ioInstances[ioInstances.length - 1]
  if (instance) {
    act(() => {
      instance.callback([{ isIntersecting: intersecting }])
    })
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useCanvasVisibility — cross-window ownerDocument', () => {
  it('attaches visibility listener to ownerDocument, not global document', () => {
    // Create a secondary document (simulates a detached/pop-out window)
    const secondaryDoc = document.implementation.createHTMLDocument('test')
    // jsdom creates docs with visibilityState='prerender'; override to 'visible'
    Object.defineProperty(secondaryDoc, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })

    // Create element in the secondary document
    const el = secondaryDoc.createElement('div')
    secondaryDoc.body.appendChild(el)
    const containerRef = { current: el }

    // Spy on the secondary document's addEventListener
    const addSpy = vi.spyOn(secondaryDoc, 'addEventListener')

    const { result } = renderHook(() => useCanvasVisibility(containerRef, true))

    // Verify listener was attached to the secondary document
    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

    // Verify initial state is visible
    expect(result.current.visibleRef.current).toBe(true)

    addSpy.mockRestore()
  })

  it('responds to visibilitychange on ownerDocument, not global document', () => {
    const secondaryDoc = document.implementation.createHTMLDocument('test')
    Object.defineProperty(secondaryDoc, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    const el = secondaryDoc.createElement('div')
    secondaryDoc.body.appendChild(el)
    const containerRef = { current: el }

    const { result } = renderHook(() => useCanvasVisibility(containerRef, true))

    // Initially visible
    expect(result.current.visibleRef.current).toBe(true)

    // Simulate the secondary document going hidden
    Object.defineProperty(secondaryDoc, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    act(() => {
      secondaryDoc.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.visibleRef.current).toBe(false)

    // Dispatching visibilitychange on the GLOBAL document should NOT affect this hook
    // (global document is still 'visible')
    result.current.needsCatchUpRef.current = false
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // Should still be false — the hook listens to secondaryDoc, not global doc
    expect(result.current.visibleRef.current).toBe(false)

    // Bring the secondary doc back to visible
    Object.defineProperty(secondaryDoc, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    act(() => {
      secondaryDoc.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.visibleRef.current).toBe(true)
    expect(result.current.needsCatchUpRef.current).toBe(true)
  })

  it('global document visibility has no effect when element is in secondary document', () => {
    const secondaryDoc = document.implementation.createHTMLDocument('test')
    Object.defineProperty(secondaryDoc, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    const el = secondaryDoc.createElement('div')
    secondaryDoc.body.appendChild(el)
    const containerRef = { current: el }

    const { result } = renderHook(() => useCanvasVisibility(containerRef, true))

    // Make global document hidden
    setDocVisibility('hidden')
    act(() => { fireVisibilityChange() })

    // Hook should still be visible (it's watching secondaryDoc, not global doc)
    expect(result.current.visibleRef.current).toBe(true)
  })
})

describe('useCanvasVisibility', () => {
  it('IO visible + doc visible → visibleRef is true', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() => useCanvasVisibility(containerRef, true))

    // IO fires "intersecting" on observe, doc is visible
    expect(result.current.visibleRef.current).toBe(true)
  })

  it('IO visible + doc hidden → visibleRef is false', () => {
    setDocVisibility('hidden')
    const containerRef = makeContainerRef()
    const { result } = renderHook(() => useCanvasVisibility(containerRef, true))

    // IO fires intersecting, but doc is hidden
    expect(result.current.visibleRef.current).toBe(false)
  })

  it('IO hidden + doc visible → visibleRef is false', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() => useCanvasVisibility(containerRef, true))

    // IO initially fires as visible, then goes out of viewport
    fireIO(false)
    expect(result.current.visibleRef.current).toBe(false)
  })

  it('transition hidden → visible sets needsCatchUpRef to true', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() => useCanvasVisibility(containerRef, true))

    // Start visible
    expect(result.current.visibleRef.current).toBe(true)

    // Go off-screen
    fireIO(false)
    expect(result.current.visibleRef.current).toBe(false)
    // Reset catch-up flag manually (simulating the draw loop consuming it)
    result.current.needsCatchUpRef.current = false

    // Come back on-screen
    fireIO(true)
    expect(result.current.visibleRef.current).toBe(true)
    expect(result.current.needsCatchUpRef.current).toBe(true)
  })

  it('transition via visibilitychange sets needsCatchUpRef', () => {
    const containerRef = makeContainerRef()
    const { result } = renderHook(() => useCanvasVisibility(containerRef, true))

    // Go hidden via document
    setDocVisibility('hidden')
    act(() => { fireVisibilityChange() })
    expect(result.current.visibleRef.current).toBe(false)
    result.current.needsCatchUpRef.current = false

    // Come back visible
    setDocVisibility('visible')
    act(() => { fireVisibilityChange() })
    expect(result.current.visibleRef.current).toBe(true)
    expect(result.current.needsCatchUpRef.current).toBe(true)
  })

  it('pauseWhenOffscreen=false → always visible', () => {
    setDocVisibility('hidden')
    const containerRef = makeContainerRef()
    const { result } = renderHook(() => useCanvasVisibility(containerRef, false))

    expect(result.current.visibleRef.current).toBe(true)
    // No IO should be created
    expect(ioInstances.length).toBe(0)
  })

  it('cleans up IO and event listener on unmount', () => {
    const containerRef = makeContainerRef()
    const { unmount } = renderHook(() => useCanvasVisibility(containerRef, true))

    expect(ioInstances.length).toBe(1)
    unmount()
    expect(ioInstances[0].disconnect).toHaveBeenCalled()
  })
})
