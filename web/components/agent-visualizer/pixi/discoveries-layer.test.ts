/**
 * Unit tests for DiscoveriesLayer -- validates entry creation, pooling,
 * selection glow, connection lines, and disposal.
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
    eventMode = 'auto'
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
    texture: unknown
    _anchorX = 0
    _anchorY = 0
    anchor = {
      set: (x: number, y?: number) => {
        this._anchorX = x
        this._anchorY = y ?? x
      },
    }
    constructor(texture?: unknown) { this.texture = texture }
    destroy() { /* no-op */ }
  }

  class MockGraphics {
    label = ''
    visible = true
    _cleared = false
    _moveToCount = 0
    _lineToCount = 0
    clear() { this._cleared = true; this._moveToCount = 0; this._lineToCount = 0; return this }
    roundRect() { return this }
    rect() { return this }
    moveTo() { this._moveToCount++; return this }
    lineTo() { this._lineToCount++; return this }
    fill(_opts: unknown) { return this }
    stroke(_opts: unknown) { return this }
    destroy() { /* no-op */ }
  }

  return {
    Container: MockContainer,
    Sprite: MockSprite,
    Graphics: MockGraphics,
    Texture: { from: () => ({ destroy: () => {} }) },
    Rectangle: class { constructor(public x = 0, public y = 0, public width = 0, public height = 0) {} },
  }
})

// ─── Mock GlyphAtlas ────────────────────────────────────────────────────

vi.mock('./glyph-atlas', () => ({
  GlyphAtlas: class {
    getGlyph(text: string, color: string, fontSize?: number) {
      return {
        texture: { destroy: () => {}, source: {} },
        width: text.length * 6,
        height: (fontSize ?? 10) * 1.4,
      }
    }
    dispose() { /* no-op */ }
  },
}))

// ─── Import after mocks ─────────────────────────────────────────────────

import { DiscoveriesLayer } from './discoveries-layer'
import type { Agent, Discovery } from '@/lib/agent-types'

// ─── Helpers ────────────────────────────────────────────────────────────

function makeDiscovery(id: string, overrides: Partial<Discovery> = {}): Discovery {
  return {
    id,
    agentId: 'a1',
    type: 'file',
    label: 'auth.ts',
    content: 'Authentication module',
    x: 200,
    y: 300,
    targetX: 200,
    targetY: 300,
    opacity: 1,
    timestamp: 0,
    ...overrides,
  }
}

function makeAgent(id: string, x = 0, y = 0): Agent {
  return {
    id, name: id, x, y, opacity: 1,
    state: 'thinking',
  } as unknown as Agent
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('DiscoveriesLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('N discoveries creates N display containers', () => {
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1')]])
    const discoveries = [
      makeDiscovery('d1'),
      makeDiscovery('d2'),
      makeDiscovery('d3'),
    ]

    layer.update(discoveries, agents)

    expect(layer.entryCount).toBe(3)
  })

  it('same set on consecutive frames does not realloc', () => {
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1')]])
    const discoveries = [makeDiscovery('d1'), makeDiscovery('d2')]

    layer.update(discoveries, agents)
    const entry1 = layer.getEntry('d1')
    expect(entry1).toBeDefined()

    layer.update(discoveries, agents)
    const entry2 = layer.getEntry('d1')

    expect(entry2).toBe(entry1)
    expect(layer.entryCount).toBe(2)
  })

  it('selection toggles selection glow visibility', () => {
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1')]])
    const discoveries = [makeDiscovery('d1'), makeDiscovery('d2')]

    layer.update(discoveries, agents, 'd1')
    expect(layer.getEntry('d1')!.selectionGlow.visible).toBe(true)
    expect(layer.getEntry('d2')!.selectionGlow.visible).toBe(false)

    layer.update(discoveries, agents, null)
    expect(layer.getEntry('d1')!.selectionGlow.visible).toBe(false)
  })

  it('dispose cleans up all entries', () => {
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1')]])
    const discoveries = [makeDiscovery('d1'), makeDiscovery('d2')]

    layer.update(discoveries, agents)
    expect(layer.entryCount).toBe(2)

    layer.dispose()
    expect(layer.entryCount).toBe(0)
  })

  it('discoveries that disappear between frames are hidden', () => {
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1')]])

    layer.update([makeDiscovery('d1'), makeDiscovery('d2')], agents)
    expect(layer.getEntry('d1')!.container.visible).toBe(true)
    expect(layer.getEntry('d2')!.container.visible).toBe(true)

    layer.update([makeDiscovery('d1')], agents)
    expect(layer.getEntry('d1')!.container.visible).toBe(true)
    expect(layer.getEntry('d2')!.container.visible).toBe(false)
  })
})
