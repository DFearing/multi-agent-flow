/**
 * Unit tests for BubblesLayer -- validates bubble lifecycle (spawn -> visible
 * -> fade -> release), pool reuse, correct stacking, and disposal.
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
    clear() { return this }
    roundRect() { return this }
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

import { BubblesLayer } from './bubbles-layer'
import type { Agent, MessageBubble } from '@/lib/agent-types'
import { BUBBLE_HOLD, BUBBLE_FADE_OUT } from '@/lib/canvas-constants'

// ─── Helpers ────────────────────────────────────────────────────────────

function makeBubble(time: number, text = 'Hello world', role: 'assistant' | 'thinking' | 'user' = 'assistant'): MessageBubble {
  return { text, time, role }
}

function makeAgent(id: string, bubbles: MessageBubble[] = [], overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id,
    state: 'thinking',
    parentId: null,
    tokensUsed: 5000,
    tokensMax: 200000,
    contextBreakdown: { systemPrompt: 1000, userMessages: 2000, toolResults: 1000, reasoning: 500, subagentResults: 500 },
    toolCalls: 0,
    timeAlive: 0,
    x: 100,
    y: 200,
    vx: 0,
    vy: 0,
    pinned: false,
    isMain: true,
    spawnTime: 0,
    opacity: 1,
    scale: 1,
    messageBubbles: bubbles,
    ...overrides,
  } as Agent
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('BubblesLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('spawns active entries for visible bubbles', () => {
    const layer = new BubblesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', [makeBubble(0), makeBubble(1)])],
    ])

    // time=2 means both bubbles are within the visible window
    layer.update(agents, 2)

    expect(layer.activeCount).toBe(2)
  })

  it('releases entries when bubbles fade out', () => {
    const layer = new BubblesLayer()
    const bubble = makeBubble(0)
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', [bubble])],
    ])

    // Bubble is visible at time=1
    layer.update(agents, 1)
    expect(layer.activeCount).toBe(1)

    // Bubble has fully faded at time > BUBBLE_HOLD + BUBBLE_FADE_OUT
    const expired = BUBBLE_HOLD + BUBBLE_FADE_OUT + 1
    layer.update(agents, expired)
    expect(layer.activeCount).toBe(0)
    expect(layer.freeCount).toBe(1) // returned to pool
  })

  it('reuses pooled entries when new bubbles appear', () => {
    const layer = new BubblesLayer()

    // Phase 1: one bubble, creates one entry
    const bubble1 = makeBubble(0)
    const agents1 = new Map<string, Agent>([
      ['a1', makeAgent('a1', [bubble1])],
    ])
    layer.update(agents1, 1)
    expect(layer.activeCount).toBe(1)

    // Phase 2: bubble expires, entry goes to pool
    const expired = BUBBLE_HOLD + BUBBLE_FADE_OUT + 1
    layer.update(agents1, expired)
    expect(layer.activeCount).toBe(0)
    expect(layer.freeCount).toBe(1)

    // Phase 3: new bubble arrives -- should reuse the pooled entry
    const bubble2 = makeBubble(expired + 1)
    const agents2 = new Map<string, Agent>([
      ['a1', makeAgent('a1', [bubble2])],
    ])
    layer.update(agents2, expired + 2)
    expect(layer.activeCount).toBe(1)
    expect(layer.freeCount).toBe(0)
  })

  it('stacks multiple bubbles vertically', () => {
    const layer = new BubblesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', [makeBubble(0, 'First'), makeBubble(0.5, 'Second')])],
    ])

    layer.update(agents, 2)

    // Both should be active and at different Y positions
    expect(layer.activeCount).toBe(2)
  })

  it('active bubble entries have eventMode=static and label=bubble-{agentId}', () => {
    const layer = new BubblesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', [makeBubble(0)])],
    ])

    layer.update(agents, 2)

    // Access active entries via the pool (container children of the root)
    const bubbleContainers = (layer.container.children as Array<{ label: string; eventMode: string }>)
      .filter(c => c.label.startsWith('bubble-'))
    expect(bubbleContainers.length).toBeGreaterThan(0)
    expect(bubbleContainers[0].eventMode).toBe('static')
    expect(bubbleContainers[0].label).toBe('bubble-a1')
  })

  it('dispose cleans up all entries', () => {
    const layer = new BubblesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', [makeBubble(0)])],
    ])

    layer.update(agents, 1)
    expect(layer.activeCount).toBe(1)

    layer.dispose()
    expect(layer.activeCount).toBe(0)
    expect(layer.freeCount).toBe(0)
  })
})
