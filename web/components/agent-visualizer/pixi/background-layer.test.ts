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
    private _tint = 0xffffff
    // Per-instance tint-write counter added for MR-2 (glow tint cache)
    // verification. The setter increments the counter on every assignment,
    // even when the value is unchanged. Existing tests read `tint` as a
    // plain field; the getter/setter pair preserves that interface.
    _tintWrites = 0
    get tint() { return this._tint }
    set tint(v: number) { this._tint = v; this._tintWrites++ }
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

  // ─── IR-7: zero-allocation hex grid ──────────────────────────────────────
  // Pre-fix the hex-grid path called `new Map()` every frame to bucket
  // cells by alpha — a steady allocation rate visible in heap profiles.
  // Post-fix uses a module-level HEX_BUCKETS Map whose value arrays are
  // truncated (`arr.length = 0`) instead of replaced.
  //
  // The test wraps the global Map constructor, runs a hex-draw frame, and
  // asserts no Map is constructed during that frame. A regression that
  // re-introduces `new Map()` in the hot path would fail immediately.

  it('IR-7: hex-grid frames do NOT construct any new Map instances', () => {
    const layer = new BackgroundLayer()
    const transform = { x: 0, y: 0, scale: 1 }

    // Warm-up: first call initialises particles + populates HEX_BUCKETS.
    // The hex grid is drawn on even frames (frameCount % 2 === 0), and the
    // very first call is frameCount=1 → particles only. The second call
    // hits the hex draw and primes module-level buckets.
    layer.update(800, 600, transform, 0.016, 0, true)
    layer.update(800, 600, transform, 0.016, 0.016, true)

    // Now wrap globalThis.Map and run another hex-draw frame.
    const RealMap = globalThis.Map
    let mapConstructions = 0
    class CountingMap<K, V> extends RealMap<K, V> {
      constructor(...args: ConstructorParameters<typeof Map>) {
        super(...(args as [Iterable<readonly [K, V]>?]))
        mapConstructions++
      }
    }
    globalThis.Map = CountingMap as unknown as typeof Map

    try {
      // Run two more frames. One will be the hex-draw frame; the other won't.
      // Either way, the post-fix code must not allocate any Maps in this window.
      layer.update(800, 600, transform, 0.016, 0.032, true)
      layer.update(800, 600, transform, 0.016, 0.048, true)
    } finally {
      globalThis.Map = RealMap
    }

    expect(mapConstructions).toBe(0)
  })

  // ─── MR-2: glow tint cache ───────────────────────────────────────────────
  // Pre-fix the active-agent glow re-parsed the color string and re-wrote
  // the sprite's tint every frame. Post-fix the work is gated on a string
  // comparison against `lastGlowColor` — no parse, no tint write when the
  // active agent's color is unchanged.

  it('MR-2: active-agent glow tint is written once per color change, not per frame', () => {
    const layer = new BackgroundLayer()
    const transform = { x: 0, y: 0, scale: 1 }
    const agentPos = { x: 100, y: 200, color: '#66ccff' }

    // Frame 1: initial paint — tint is written (lastGlowColor was '').
    layer.update(800, 600, transform, 0.016, 0, false, agentPos)
    const glowSprite = (layer as unknown as {
      glowSprite: { _tintWrites: number; tint: number }
    }).glowSprite
    expect(glowSprite._tintWrites).toBe(1)

    // 30 frames with the SAME color → no further tint writes.
    for (let frame = 1; frame <= 30; frame++) {
      layer.update(800, 600, transform, 0.016, frame * 0.016, false, agentPos)
    }
    expect(glowSprite._tintWrites).toBe(1)

    // Change the color → exactly one more tint write.
    const agentPos2 = { x: 100, y: 200, color: '#ffbb44' }
    layer.update(800, 600, transform, 0.016, 31 * 0.016, false, agentPos2)
    expect(glowSprite._tintWrites).toBe(2)

    // Another 10 frames at the new color → still 2 writes total.
    for (let frame = 32; frame <= 41; frame++) {
      layer.update(800, 600, transform, 0.016, frame * 0.016, false, agentPos2)
    }
    expect(glowSprite._tintWrites).toBe(2)
  })
})
