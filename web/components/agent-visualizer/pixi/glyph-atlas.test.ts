/**
 * Unit tests for GlyphAtlas — validates caching, uniqueness, and disposal.
 *
 * Run with: cd web && pnpm test
 *
 * Mocks pixi.js to avoid needing a real GPU context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock HTMLCanvasElement.getContext for jsdom ─────────────────────────
// jsdom doesn't implement canvas 2D context. We provide a minimal stub.

const mockCtx = {
  font: '',
  textBaseline: '',
  fillStyle: '',
  measureText: (text: string) => ({ width: text.length * 6 }),
  fillText: vi.fn(),
}

const origCreateElement = document.createElement.bind(document)
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  const el = origCreateElement(tag)
  if (tag === 'canvas') {
    (el as HTMLCanvasElement).getContext = (() => mockCtx) as unknown as HTMLCanvasElement['getContext']
  }
  return el
})

// ─── Mock pixi.js before importing GlyphAtlas ────────────────────────────

let textureIdCounter = 0

vi.mock('pixi.js', () => {
  class MockRectangle {
    x: number; y: number; width: number; height: number
    constructor(x = 0, y = 0, w = 0, h = 0) {
      this.x = x; this.y = y; this.width = w; this.height = h
    }
  }

  class MockTextureSource {
    _id: number
    constructor() { this._id = textureIdCounter++ }
  }

  class MockTexture {
    source: MockTextureSource
    frame: MockRectangle
    _destroyed = false
    constructor(opts?: { source?: MockTextureSource; frame?: MockRectangle }) {
      this.source = opts?.source ?? new MockTextureSource()
      this.frame = opts?.frame ?? new MockRectangle()
    }
    destroy() { this._destroyed = true }
    static from(_opts: unknown): MockTexture {
      return new MockTexture()
    }
  }

  return {
    Texture: MockTexture,
    Rectangle: MockRectangle,
  }
})

// ─── Import after mocks ──────────────────────────────────────────────────

import { GlyphAtlas } from './glyph-atlas'

// ─── Tests ───────────────────────────────────────────────────────────────

describe('GlyphAtlas', () => {
  beforeEach(() => {
    textureIdCounter = 0
  })

  it('same (text, color) returns the same texture reference', () => {
    const atlas = new GlyphAtlas()
    const a = atlas.getGlyph('hello', '#ff0000')
    const b = atlas.getGlyph('hello', '#ff0000')

    expect(a).toBe(b)
    expect(atlas.size).toBe(1)

    atlas.dispose()
  })

  it('different colors return different texture descriptors', () => {
    const atlas = new GlyphAtlas()
    const a = atlas.getGlyph('hello', '#ff0000')
    const b = atlas.getGlyph('hello', '#00ff00')

    expect(a).not.toBe(b)
    expect(a.texture).not.toBe(b.texture)
    expect(atlas.size).toBe(2)

    atlas.dispose()
  })

  it('different font sizes return different descriptors', () => {
    const atlas = new GlyphAtlas()
    const a = atlas.getGlyph('hello', '#ff0000', 10)
    const b = atlas.getGlyph('hello', '#ff0000', 14)

    expect(a).not.toBe(b)
    expect(atlas.size).toBe(2)

    atlas.dispose()
  })

  it('many entries do not crash', () => {
    const atlas = new GlyphAtlas()

    for (let i = 0; i < 200; i++) {
      const glyph = atlas.getGlyph(`text-${i}`, `#${(i * 1234).toString(16).padStart(6, '0').slice(0, 6)}`)
      expect(glyph).toBeDefined()
      expect(glyph.width).toBeGreaterThan(0)
      expect(glyph.height).toBeGreaterThan(0)
    }

    expect(atlas.size).toBe(200)

    atlas.dispose()
  })

  it('dispose frees all resources', () => {
    const atlas = new GlyphAtlas()
    atlas.getGlyph('a', '#ff0000')
    atlas.getGlyph('b', '#00ff00')
    atlas.getGlyph('c', '#0000ff')

    expect(atlas.size).toBe(3)
    expect(atlas.pageCount).toBeGreaterThan(0)

    atlas.dispose()

    expect(atlas.size).toBe(0)
    expect(atlas.pageCount).toBe(0)
  })

  it('returns descriptors with positive dimensions', () => {
    const atlas = new GlyphAtlas()
    const glyph = atlas.getGlyph('test string', '#ffffff', 12)

    expect(glyph.width).toBeGreaterThan(0)
    expect(glyph.height).toBeGreaterThan(0)
    expect(glyph.texture).toBeDefined()

    atlas.dispose()
  })
})
