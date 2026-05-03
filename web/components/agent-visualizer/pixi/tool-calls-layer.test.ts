/**
 * Unit tests for ToolCallsLayer -- validates entry creation, pooling,
 * selection tint, and disposal.
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
    // Per-instance call counters (added for IR-6 background-rebuild gating
    // assertions). Existing tests rely on `_cleared` only and are unaffected
    // by the additive counters.
    _clearCount = 0
    _roundRectCount = 0
    _fillCount = 0
    _strokeCount = 0
    clear() { this._cleared = true; this._clearCount++; return this }
    roundRect() { this._roundRectCount++; return this }
    rect() { return this }
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

import { ToolCallsLayer } from './tool-calls-layer'
import type { ToolCallNode } from '@/lib/agent-types'

// ─── Helpers ────────────────────────────────────────────────────────────

function makeToolCall(id: string, overrides: Partial<ToolCallNode> = {}): ToolCallNode {
  return {
    id,
    agentId: 'a1',
    toolName: 'Read',
    state: 'running',
    args: 'src/index.ts',
    x: 100,
    y: 200,
    startTime: 0,
    opacity: 1,
    ...overrides,
  } as ToolCallNode
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('ToolCallsLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('N tool calls creates N display containers', () => {
    const layer = new ToolCallsLayer()
    const toolCalls = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
      ['t2', makeToolCall('t2')],
      ['t3', makeToolCall('t3')],
    ])

    layer.update(toolCalls, 0)

    expect(layer.entryCount).toBe(3)
  })

  it('same set on consecutive frames does not realloc', () => {
    const layer = new ToolCallsLayer()
    const toolCalls = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
      ['t2', makeToolCall('t2')],
    ])

    layer.update(toolCalls, 0)
    const entry1 = layer.getEntry('t1')
    expect(entry1).toBeDefined()

    layer.update(toolCalls, 1)
    const entry2 = layer.getEntry('t1')

    expect(entry2).toBe(entry1)
    expect(layer.entryCount).toBe(2)
  })

  it('selection toggles selection glow visibility', () => {
    const layer = new ToolCallsLayer()
    const toolCalls = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
      ['t2', makeToolCall('t2')],
    ])

    // Select t1
    layer.update(toolCalls, 0, 't1')
    expect(layer.getEntry('t1')!.selectionGlow.visible).toBe(true)
    expect(layer.getEntry('t2')!.selectionGlow.visible).toBe(false)

    // Select t2
    layer.update(toolCalls, 1, 't2')
    expect(layer.getEntry('t1')!.selectionGlow.visible).toBe(false)
    expect(layer.getEntry('t2')!.selectionGlow.visible).toBe(true)

    // Deselect all
    layer.update(toolCalls, 2, null)
    expect(layer.getEntry('t1')!.selectionGlow.visible).toBe(false)
    expect(layer.getEntry('t2')!.selectionGlow.visible).toBe(false)
  })

  it('dispose cleans up all entries', () => {
    const layer = new ToolCallsLayer()
    const toolCalls = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
      ['t2', makeToolCall('t2')],
    ])

    layer.update(toolCalls, 0)
    expect(layer.entryCount).toBe(2)

    layer.dispose()
    expect(layer.entryCount).toBe(0)
  })

  it('destroys entries for tool calls that disappear between frames', () => {
    // Stale-id sweep (CR-3): tool-call entries are destroyed when their id
    // no longer appears in the input. Previously entries were merely hidden,
    // accumulating monotonically over long sessions.
    const layer = new ToolCallsLayer()

    const toolCalls1 = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
      ['t2', makeToolCall('t2')],
    ])
    layer.update(toolCalls1, 0)
    expect(layer.getEntry('t1')!.container.visible).toBe(true)
    expect(layer.getEntry('t2')!.container.visible).toBe(true)
    expect(layer.entryCount).toBe(2)

    const toolCalls2 = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
    ])
    layer.update(toolCalls2, 1)
    expect(layer.getEntry('t1')!.container.visible).toBe(true)
    expect(layer.getEntry('t2')).toBeUndefined()
    expect(layer.entryCount).toBe(1)
  })

  // ─── CR-3: leak prevention with destroy() spy across multi-frame window ──

  it('CR-3: 5 tool-calls stable for 3 frames then absent → entries destroyed and dropped', () => {
    // Strengthens the simple two-frame transition above by:
    //   (1) stabilising entries across 3 frames so the buggy "hide only"
    //       path would have produced a monotonically growing map,
    //   (2) feeding zero tool calls in the final frame (full sweep),
    //   (3) spying on container.destroy to verify GPU teardown actually
    //       runs, not just a Map.delete.
    const layer = new ToolCallsLayer()
    const toolCalls = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
      ['t2', makeToolCall('t2')],
      ['t3', makeToolCall('t3')],
      ['t4', makeToolCall('t4')],
      ['t5', makeToolCall('t5')],
    ])

    layer.update(toolCalls, 0)
    layer.update(toolCalls, 0.016)
    layer.update(toolCalls, 0.032)
    expect(layer.entryCount).toBe(5)

    const destroySpies = ['t1', 't2', 't3', 't4', 't5'].map(id => {
      const entry = layer.getEntry(id)!
      return vi.spyOn(entry.container, 'destroy')
    })

    layer.update(new Map(), 0.048)
    expect(layer.entryCount).toBe(0)
    for (const spy of destroySpies) {
      expect(spy).toHaveBeenCalled()
    }
  })

  // ─── IR-6: background rebuild gating ─────────────────────────────────────
  // The background Graphics is regenerated only when its inputs change.
  // The pulse value continuously varies but is quantized to 1/20 buckets,
  // so a 30-frame stable session produces only a handful of distinct keys.
  // Pre-fix (no key gating) every frame would clear+roundRect+fill+stroke
  // the background; this test pins the post-fix bound at "well below 30".

  it('IR-6: background Graphics rebuild count stays below frame count for stable tool call', () => {
    const layer = new ToolCallsLayer()
    const tool = makeToolCall('t1', { state: 'running' })
    const toolCalls = new Map<string, ToolCallNode>([['t1', tool]])

    // First update creates the entry; capture the per-instance counters.
    layer.update(toolCalls, 0)
    const entry = layer.getEntry('t1')!
    const bg = entry.background as unknown as {
      _clearCount: number
      _roundRectCount: number
      _fillCount: number
      _strokeCount: number
    }
    const FRAMES = 30
    const initialClears = bg._clearCount

    // Run 30 stable frames at 60fps. The pulse varies (sin(time*4)) but
    // pulseBucket = round(pulse*20) lives in a small set across this
    // window — empirically 5-9 distinct buckets — so the rebuild count
    // must stay well below 30.
    for (let frame = 1; frame <= FRAMES; frame++) {
      layer.update(toolCalls, frame * 0.016)
    }

    const clearsDuringWindow = bg._clearCount - initialClears
    // Post-fix: gated rebuilds. Pre-fix would have rebuilt every frame.
    // Allow up to half the frame count as the safety margin (in practice
    // it's 5-9). Anything close to 30 means the gate regressed.
    expect(clearsDuringWindow).toBeLessThan(FRAMES / 2)
    // The four chained calls move together.
    expect(bg._roundRectCount).toBeLessThanOrEqual(bg._clearCount)
    expect(bg._fillCount).toBeLessThanOrEqual(bg._clearCount)
    expect(bg._strokeCount).toBeLessThanOrEqual(bg._clearCount)
  })
})
