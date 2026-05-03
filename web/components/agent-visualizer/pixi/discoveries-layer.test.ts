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
    // Per-instance counters added for IR-5 (stroke count == bucket count)
    // and IR-6 (background rebuild gating). Existing tests are unaffected
    // because they only inspect _cleared / _moveToCount / _lineToCount.
    _clearCount = 0
    _roundRectCount = 0
    _fillCount = 0
    _strokeCount = 0
    clear() { this._cleared = true; this._moveToCount = 0; this._lineToCount = 0; this._clearCount++; return this }
    roundRect() { this._roundRectCount++; return this }
    rect() { return this }
    moveTo() { this._moveToCount++; return this }
    lineTo() { this._lineToCount++; return this }
    fill(_opts: unknown) { this._fillCount++; return this }
    stroke(_opts: unknown) { this._strokeCount++; return this }
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

  it('destroys entries for discoveries that disappear between frames', () => {
    // Stale-id sweep (CR-3): discovery entries are destroyed when their id
    // no longer appears in the input. Previously entries were merely hidden,
    // leaking GPU buffers over long sessions.
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1')]])

    layer.update([makeDiscovery('d1'), makeDiscovery('d2')], agents)
    expect(layer.getEntry('d1')!.container.visible).toBe(true)
    expect(layer.getEntry('d2')!.container.visible).toBe(true)
    expect(layer.entryCount).toBe(2)

    layer.update([makeDiscovery('d1')], agents)
    expect(layer.getEntry('d1')!.container.visible).toBe(true)
    expect(layer.getEntry('d2')).toBeUndefined()
    expect(layer.entryCount).toBe(1)
  })

  // ─── CR-3: leak prevention with destroy() spy across multi-frame window ──

  it('CR-3: 5 discoveries stable for 3 frames then absent → entries destroyed and dropped', () => {
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1')]])
    const discoveries = [
      makeDiscovery('d1'),
      makeDiscovery('d2'),
      makeDiscovery('d3'),
      makeDiscovery('d4'),
      makeDiscovery('d5'),
    ]

    layer.update(discoveries, agents)
    layer.update(discoveries, agents)
    layer.update(discoveries, agents)
    expect(layer.entryCount).toBe(5)

    const destroySpies = ['d1', 'd2', 'd3', 'd4', 'd5'].map(id => {
      const entry = layer.getEntry(id)!
      return vi.spyOn(entry.container, 'destroy')
    })

    layer.update([], agents)
    expect(layer.entryCount).toBe(0)
    for (const spy of destroySpies) {
      expect(spy).toHaveBeenCalled()
    }
  })

  // ─── IR-5: alpha-bucketed connection-line strokes ────────────────────────
  // Pre-fix the connection-line draw path issued one stroke() per discovery,
  // producing O(n) draw calls. Post-fix discoveries are bucketed by quantized
  // alpha (round(opacity*0.09*20)/20, range {0, 0.05, 0.10}) and stroke()
  // runs once per non-empty bucket — independent of n.
  //
  // The 10 opacities below land in 3 distinct buckets:
  //   { 0.15, 0.20 } → bucket 0
  //   { 0.40, 0.50, 0.60, 0.70 } → bucket 0.05
  //   { 0.85, 0.90, 0.95, 1.00 } → bucket 0.10
  // → exactly 3 stroke() calls regardless of the 10 input discoveries.

  it('IR-5: stroke() called once per alpha bucket on connectionLines, not once per discovery', () => {
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1', 0, 0)]])
    const opacities = [0.15, 0.20, 0.40, 0.50, 0.60, 0.70, 0.85, 0.90, 0.95, 1.00]
    const discoveries = opacities.map((opacity, i) =>
      makeDiscovery(`d${i}`, { opacity, x: 100 + i * 10, y: 100 }),
    )

    // Reach into the layer for the connectionLines Graphics (private but
    // an implementation detail of the perf invariant we're testing).
    const connectionLines = (layer as unknown as {
      connectionLines: { _strokeCount: number }
    }).connectionLines
    const strokesBefore = connectionLines._strokeCount

    layer.update(discoveries, agents)

    const strokesDuringFrame = connectionLines._strokeCount - strokesBefore
    // Exactly 3 distinct alpha buckets → 3 stroke() calls. A regression to
    // per-discovery stroking would jump to 10.
    expect(strokesDuringFrame).toBe(3)
  })

  // ─── IR-6: background-rebuild gating ─────────────────────────────────────
  // Discoveries don't pulse, so a stable discovery should rebuild its
  // background and accent-bar Graphics exactly once across many frames.
  // Pre-fix every frame ran clear+roundRect+fill+stroke; post-fix gates on
  // bgKey = `${cardW}|${cardH}|${typeColor}|${isSelected}` which is
  // immutable for a stable input.

  it('IR-6: stable discovery rebuilds background Graphics exactly once across 30 frames', () => {
    const layer = new DiscoveriesLayer()
    const agents = new Map<string, Agent>([['a1', makeAgent('a1')]])
    const discoveries = [makeDiscovery('d1')]

    // First update creates the entry; capture initial counters AFTER that.
    layer.update(discoveries, agents)
    const entry = layer.getEntry('d1')!
    const bg = entry.background as unknown as {
      _clearCount: number
      _roundRectCount: number
      _fillCount: number
      _strokeCount: number
    }
    const initialClears = bg._clearCount
    const initialRoundRects = bg._roundRectCount
    const initialFills = bg._fillCount

    // 30 stable frames — bgKey unchanged, so no rebuilds.
    for (let frame = 1; frame <= 30; frame++) {
      layer.update(discoveries, agents)
    }

    expect(bg._clearCount - initialClears).toBe(0)
    expect(bg._roundRectCount - initialRoundRects).toBe(0)
    expect(bg._fillCount - initialFills).toBe(0)
  })
})
