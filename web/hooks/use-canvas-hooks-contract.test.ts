/**
 * Contract test for useCanvasCamera and useCanvasInteraction.
 *
 * Proves that both hooks work with a plain HTMLElement ref (e.g. a div),
 * not just an HTMLCanvasElement. The hooks only use:
 *   - getBoundingClientRect()
 *   - addEventListener('wheel', ...) / removeEventListener('wheel', ...)
 *
 * This test stubs the ref with a minimal object exposing only those methods.
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCanvasCamera } from './use-canvas-camera'
import { useCanvasInteraction } from './use-canvas-interaction'
import type { Agent, ToolCallNode, Discovery } from '@/lib/agent-types'

/**
 * Create a minimal stub that satisfies the HTMLElement contract required
 * by the hooks — only getBoundingClientRect, addEventListener, and
 * removeEventListener.
 */
function createElementStub(): HTMLElement {
  const listeners = new Map<string, EventListener>()
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    addEventListener: vi.fn((type: string, handler: EventListener) => {
      listeners.set(type, handler)
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type)
    }),
  } as unknown as HTMLElement
}

function makeDrawPropsRef() {
  return {
    current: {
      agents: new Map<string, Agent>(),
      toolCalls: new Map<string, ToolCallNode>(),
      discoveries: [] as Discovery[],
      dimensions: { width: 800, height: 600 },
      selectedAgentId: null as string | null,
      pauseAutoFit: false,
      isDragging: false,
      onAgentClick: vi.fn(),
      onAgentHover: vi.fn(),
      onAgentDrag: vi.fn(),
      onContextMenu: vi.fn(),
      onToolCallClick: vi.fn(),
      onDiscoveryClick: vi.fn(),
    },
  }
}

describe('useCanvasCamera contract', () => {
  it('accepts a plain HTMLElement ref (not HTMLCanvasElement)', () => {
    const element = createElementStub()
    const mainCanvasRef = { current: element }
    const drawPropsRef = makeDrawPropsRef()
    const simTimeRef = { current: 0 }

    const { result } = renderHook(() =>
      useCanvasCamera({
        mainCanvasRef,
        drawPropsRef,
        simTimeRef,
        dimensions: { width: 800, height: 600 },
        agentCount: 0,
        selectedAgentId: null,
      }),
    )

    expect(result.current.transformRef).toBeDefined()
    expect(result.current.screenToCanvas).toBeInstanceOf(Function)
    expect(result.current.doZoomToFit).toBeInstanceOf(Function)
    expect(result.current.updateCamera).toBeInstanceOf(Function)
  })

  it('screenToCanvas calls getBoundingClientRect on the element', () => {
    const element = createElementStub()
    const spy = vi.spyOn(element, 'getBoundingClientRect')
    const mainCanvasRef = { current: element }
    const drawPropsRef = makeDrawPropsRef()
    const simTimeRef = { current: 0 }

    const { result } = renderHook(() =>
      useCanvasCamera({
        mainCanvasRef,
        drawPropsRef,
        simTimeRef,
        dimensions: { width: 800, height: 600 },
        agentCount: 0,
        selectedAgentId: null,
      }),
    )

    const pos = result.current.screenToCanvas(400, 300)
    expect(spy).toHaveBeenCalled()
    expect(pos).toHaveProperty('x')
    expect(pos).toHaveProperty('y')
  })
})

describe('useCanvasInteraction contract', () => {
  it('accepts a plain HTMLElement ref and attaches wheel listener', () => {
    const element = createElementStub()
    const mainCanvasRef = { current: element }
    const drawPropsRef = makeDrawPropsRef()
    const transformRef = { current: { x: 0, y: 0, scale: 1 } }
    const userHasNavigatedRef = { current: false }
    const panVelocityRef = { current: { vx: 0, vy: 0, active: false } }
    const simTimeRef = { current: 0 }

    const { result } = renderHook(() =>
      useCanvasInteraction({
        drawPropsRef,
        transformRef,
        userHasNavigatedRef,
        panVelocityRef,
        simTimeRef,
        screenToCanvas: (sx: number, sy: number) => ({ x: sx, y: sy }),
        doZoomToFit: vi.fn(),
        mainCanvasRef,
      }),
    )

    // Wheel listener should have been attached
    expect(element.addEventListener).toHaveBeenCalledWith(
      'wheel',
      expect.any(Function),
      { passive: false },
    )

    expect(result.current.handlers).toBeDefined()
    expect(result.current.handlers.onMouseDown).toBeInstanceOf(Function)
    expect(result.current.handlers.onMouseUp).toBeInstanceOf(Function)
    expect(result.current.handlers.onMouseMove).toBeInstanceOf(Function)
  })
})
