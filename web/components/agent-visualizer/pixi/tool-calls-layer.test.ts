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
    clear() { this._cleared = true; return this }
    roundRect() { return this }
    rect() { return this }
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

  it('tool calls that disappear between frames are hidden', () => {
    const layer = new ToolCallsLayer()

    const toolCalls1 = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
      ['t2', makeToolCall('t2')],
    ])
    layer.update(toolCalls1, 0)
    expect(layer.getEntry('t1')!.container.visible).toBe(true)
    expect(layer.getEntry('t2')!.container.visible).toBe(true)

    const toolCalls2 = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1')],
    ])
    layer.update(toolCalls2, 1)
    expect(layer.getEntry('t1')!.container.visible).toBe(true)
    expect(layer.getEntry('t2')!.container.visible).toBe(false)
  })
})
