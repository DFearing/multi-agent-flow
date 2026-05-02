/**
 * Unit tests for BackgroundLayer -- validates depth particle update,
 * hex grid visibility, and disposal.
 *
 * Run with: cd web && pnpm test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pixi.js ─────────────────────────────────────────────────────

vi.mock('pixi.js', () => {
  class MockContainer {
    label = ''
    children: unknown[] = []
    x = 0
    y = 0
    alpha = 1
    visible = true
    addChild(child: unknown) { this.children.push(child) }
    removeChild(child: unknown) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) this.children.splice(idx, 1)
    }
    destroy(_opts?: unknown) { this.children.length = 0 }
  }

  class MockSprite {
    label = ''
    x = 0
    y = 0
    tint = 0xffffff
    alpha = 1
    visible = true
    blendMode = 'normal'
    texture: unknown
    _anchorX = 0
    _anchorY = 0
    _scaleX = 1
    _scaleY = 1
    anchor = {
      set: (x: number, y?: number) => {
        this._anchorX = x
        this._anchorY = y ?? x
      },
    }
    scale = {
      set: (x: number, y?: number) => {
        this._scaleX = x
        this._scaleY = y ?? x
      },
    }
    constructor(texture?: unknown) { this.texture = texture }
    destroy() { /* no-op */ }
  }

  class MockGraphics {
    label = ''
    visible = true
    _cleared = false
    _pathCount = 0
    clear() { this._cleared = true; this._pathCount = 0; return this }
    moveTo() { this._pathCount++; return this }
    lineTo() { return this }
    closePath() { return this }
    stroke(_opts: unknown) { return this }
    fill(_opts: unknown) { return this }
    destroy() { /* no-op */ }
  }

  return {
    Container: MockContainer,
    Sprite: MockSprite,
    Graphics: MockGraphics,
    Texture: { from: () => ({ destroy: () => {} }) },
  }
})

// ─── Mock pixi-app texture helpers ──────────────────────────────────────

vi.mock('./pixi-app', () => ({
  getCircleTexture: () => ({ destroy: () => {} }),
  getGlowTexture: () => ({ destroy: () => {} }),
}))

// ─── Import after mocks ─────────────────────────────────────────────────

import { BackgroundLayer } from './background-layer'

// ─── Tests ──────────────────────────────────────────────────────────────

describe('BackgroundLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initialises depth particles on first update', () => {
    const layer = new BackgroundLayer()
    const transform = { x: 0, y: 0, scale: 1 }

    layer.update(800, 600, transform, 0.016, 0, false)

    expect(layer.particleCount).toBe(80)
  })

  it('depth particle update does not realloc on subsequent frames', () => {
    const layer = new BackgroundLayer()
    const transform = { x: 0, y: 0, scale: 1 }

    layer.update(800, 600, transform, 0.016, 0, false)
    expect(layer.particleCount).toBe(80)

    layer.update(800, 600, transform, 0.016, 0.016, false)
    expect(layer.particleCount).toBe(80)

    layer.update(800, 600, transform, 0.016, 0.032, false)
    expect(layer.particleCount).toBe(80)
  })

  it('hex grid visibility follows showHexGrid parameter', () => {
    const layer = new BackgroundLayer()
    const transform = { x: 0, y: 0, scale: 1 }

    layer.update(800, 600, transform, 0.016, 0, true)
    expect(layer.hexGridVisible).toBe(true)

    layer.update(800, 600, transform, 0.016, 0.016, false)
    expect(layer.hexGridVisible).toBe(false)
  })

  it('dispose cleans up particles', () => {
    const layer = new BackgroundLayer()
    const transform = { x: 0, y: 0, scale: 1 }

    layer.update(800, 600, transform, 0.016, 0, false)
    expect(layer.particleCount).toBe(80)

    layer.dispose()
    expect(layer.particleCount).toBe(0)
  })
})
