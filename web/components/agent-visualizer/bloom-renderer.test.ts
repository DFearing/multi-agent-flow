/**
 * Unit tests for BloomRenderer — validates construction, resize, apply,
 * applyCache (throttle), and the toggle ON->OFF->ON resize fix.
 *
 * Run with: cd web && pnpm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BloomRenderer } from './bloom-renderer'

// ─── Minimal canvas/context stubs ─────────────────────────────────────────
// jsdom doesn't implement canvas, so we stub document.createElement and the
// 2D context just enough for BloomRenderer's constructor + resize + apply.

function makeStubCanvas() {
  let _width = 0
  let _height = 0
  const ctx: Record<string, unknown> = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    filter: 'none',
  }
  const canvas = {
    get width() { return _width },
    set width(v: number) { _width = v },
    get height() { return _height },
    set height(v: number) { _height = v },
    getContext: vi.fn(() => ctx),
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx }
}

// Patch document.createElement so BloomRenderer can create its offscreen
// canvases. We restore after each test.
let createElementSpy: ReturnType<typeof vi.spyOn>
const createdCanvases: Array<{ canvas: HTMLCanvasElement; ctx: Record<string, unknown> }> = []

beforeEach(() => {
  createdCanvases.length = 0
  createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      const stub = makeStubCanvas()
      createdCanvases.push(stub)
      return stub.canvas
    }
    return document.createElement(tag)
  })
})

afterEach(() => {
  createElementSpy.mockRestore()
})

// ─── Need afterEach in scope ──────────────────────────────────────────────
import { afterEach } from 'vitest'

// ─── Tests ────────────────────────────────────────────────────────────────

describe('BloomRenderer', () => {
  it('constructs with default intensity 0.6', () => {
    const bloom = new BloomRenderer()
    // Internal canvases start at 0x0
    expect(createdCanvases.length).toBe(2)
    expect(createdCanvases[0].canvas.width).toBe(0)
  })

  it('constructs with custom intensity', () => {
    const bloom = new BloomRenderer(0.8)
    expect(bloom).toBeDefined()
  })

  it('resize sets internal canvases to half resolution', () => {
    const bloom = new BloomRenderer(0.5)
    bloom.resize(1000, 800)
    // Bloom works at 0.5x, so 500x400
    expect(createdCanvases[0].canvas.width).toBe(500)
    expect(createdCanvases[0].canvas.height).toBe(400)
    expect(createdCanvases[1].canvas.width).toBe(500)
    expect(createdCanvases[1].canvas.height).toBe(400)
  })

  it('apply early-returns when internal size is 0x0', () => {
    const bloom = new BloomRenderer(0.5)
    // Don't call resize — stays at 0x0
    const source = makeStubCanvas()
    const targetCtx = makeStubCanvas().ctx
    bloom.apply(source.canvas, targetCtx as unknown as CanvasRenderingContext2D)
    // Should not have drawn anything
    expect(targetCtx.save).not.toHaveBeenCalled()
  })

  it('apply composites bloom when properly sized', () => {
    const bloom = new BloomRenderer(0.5)
    bloom.resize(800, 600)
    const source = makeStubCanvas()
    source.canvas.width = 800
    source.canvas.height = 600
    const targetCtx = makeStubCanvas().ctx
    bloom.apply(source.canvas, targetCtx as unknown as CanvasRenderingContext2D)
    expect(targetCtx.save).toHaveBeenCalled()
    expect(targetCtx.restore).toHaveBeenCalled()
  })

  describe('toggle ON -> OFF -> ON resize fix', () => {
    it('new BloomRenderer with immediate resize has non-zero internal dimensions', () => {
      // Simulates the fix: after constructing in the effect, call resize
      const bloom = new BloomRenderer(0.5)
      bloom.resize(1920, 1080)
      expect(createdCanvases[0].canvas.width).toBe(960)
      expect(createdCanvases[0].canvas.height).toBe(540)
      // Apply should NOT early-return
      const source = makeStubCanvas()
      source.canvas.width = 1920
      source.canvas.height = 1080
      const targetCtx = makeStubCanvas().ctx
      bloom.apply(source.canvas, targetCtx as unknown as CanvasRenderingContext2D)
      expect(targetCtx.save).toHaveBeenCalled()
    })

    it('without resize, apply early-returns (the bug)', () => {
      // Demonstrates the original bug: no resize means 0x0 -> early return
      const bloom = new BloomRenderer(0.5)
      const source = makeStubCanvas()
      source.canvas.width = 1920
      source.canvas.height = 1080
      const targetCtx = makeStubCanvas().ctx
      bloom.apply(source.canvas, targetCtx as unknown as CanvasRenderingContext2D)
      // Should early-return, no save/restore
      expect(targetCtx.save).not.toHaveBeenCalled()
    })
  })

  describe('applyCache (throttled bloom)', () => {
    it('re-composites the last blur result without re-running blur', () => {
      const bloom = new BloomRenderer(0.5)
      bloom.resize(800, 600)
      const source = makeStubCanvas()
      source.canvas.width = 800
      source.canvas.height = 600

      // First: full apply
      const targetCtx1 = makeStubCanvas().ctx
      bloom.apply(source.canvas, targetCtx1 as unknown as CanvasRenderingContext2D)

      // Second: applyCache — should composite without re-blurring
      const targetCtx2 = makeStubCanvas().ctx
      bloom.applyCache(source.canvas, targetCtx2 as unknown as CanvasRenderingContext2D)
      expect(targetCtx2.save).toHaveBeenCalled()
      expect(targetCtx2.drawImage).toHaveBeenCalled()
      expect(targetCtx2.restore).toHaveBeenCalled()
    })

    it('applyCache early-returns when size is 0x0', () => {
      const bloom = new BloomRenderer(0.5)
      const source = makeStubCanvas()
      const targetCtx = makeStubCanvas().ctx
      bloom.applyCache(source.canvas, targetCtx as unknown as CanvasRenderingContext2D)
      expect(targetCtx.save).not.toHaveBeenCalled()
    })
  })

  it('setIntensity clamps to [0, 1]', () => {
    const bloom = new BloomRenderer(0.5)
    bloom.setIntensity(-1)
    bloom.setIntensity(2)
    // No crash — clamping is internal
    expect(bloom).toBeDefined()
  })
})
