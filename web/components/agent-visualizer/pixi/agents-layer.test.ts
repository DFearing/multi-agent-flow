/**
 * Unit tests for AgentsLayer — validates entry creation, pooling, selection
 * ring visibility, tint changes, and disposal.
 *
 * Run with: cd web && pnpm test
 *
 * Mocks pixi.js and GlyphAtlas to test logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pixi.js before importing AgentsLayer ──────────────────────────

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
    _lastCircleR = 0
    clear() { this._cleared = true; return this }
    circle(_x: number, _y: number, r: number) { this._lastCircleR = r; return this }
    stroke(_opts: unknown) { return this }
    fill(_opts: unknown) { return this }
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

// ─── Mock pixi-app (getCircleTexture) ────────────────────────────────────

vi.mock('./pixi-app', () => ({
  getCircleTexture: () => ({ destroy: () => {} }),
}))

// ─── Mock GlyphAtlas ─────────────────────────────────────────────────────

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

// ─── Import after mocks ──────────────────────────────────────────────────

import { AgentsLayer } from './agents-layer'
import type { Agent } from '@/lib/agent-types'

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id,
    state: 'thinking',
    parentId: null,
    tokensUsed: 5000,
    tokensMax: 200000,
    contextBreakdown: { systemPrompt: 1000, userMessages: 2000, toolResults: 1000, reasoning: 500, subagentResults: 500 },
    toolCalls: 3,
    timeAlive: 12.5,
    x: 100,
    y: 200,
    vx: 0,
    vy: 0,
    pinned: false,
    isMain: true,
    spawnTime: 0,
    opacity: 1,
    scale: 1,
    messageBubbles: [],
    ...overrides,
  } as Agent
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('AgentsLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('N agents creates N display containers', () => {
    const layer = new AgentsLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1')],
      ['a2', makeAgent('a2')],
      ['a3', makeAgent('a3')],
    ])

    layer.update(agents, null, null, false, 0)

    expect(layer.entryCount).toBe(3)
    expect(layer.container.children.length).toBe(3)
  })

  it('same agent set on consecutive frames does not allocate new entries', () => {
    const layer = new AgentsLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1')],
      ['a2', makeAgent('a2')],
    ])

    layer.update(agents, null, null, false, 0)
    const entry1 = layer.getEntry('a1')
    expect(entry1).toBeDefined()

    // Second update — same agents
    layer.update(agents, null, null, false, 1)
    const entry2 = layer.getEntry('a1')

    expect(entry2).toBe(entry1)
    expect(layer.entryCount).toBe(2)
  })

  it('selection ring visibility tracks selectedAgentId', () => {
    const layer = new AgentsLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1')],
      ['a2', makeAgent('a2')],
    ])

    // Select a1
    layer.update(agents, 'a1', null, false, 0)

    expect(layer.getEntry('a1')!.selectionRing.visible).toBe(true)
    expect(layer.getEntry('a2')!.selectionRing.visible).toBe(false)

    // Select a2
    layer.update(agents, 'a2', null, false, 1)

    expect(layer.getEntry('a1')!.selectionRing.visible).toBe(false)
    expect(layer.getEntry('a2')!.selectionRing.visible).toBe(true)

    // Deselect all
    layer.update(agents, null, null, false, 2)

    expect(layer.getEntry('a1')!.selectionRing.visible).toBe(false)
    expect(layer.getEntry('a2')!.selectionRing.visible).toBe(false)
  })

  it('state change toggles tint without recreating sprites', () => {
    const layer = new AgentsLayer()
    const agent = makeAgent('a1', { state: 'thinking' })
    const agents = new Map<string, Agent>([['a1', agent]])

    layer.update(agents, null, null, false, 0)
    const entry = layer.getEntry('a1')!
    const bodyRef = entry.body

    // Thinking state tint: #66ccff = 0x66ccff
    expect(entry.body.tint).toBe(0x66ccff)

    // Change state to tool_calling
    agent.state = 'tool_calling'
    layer.update(agents, null, null, false, 1)

    // Body should be the same object (no reallocation)
    expect(entry.body).toBe(bodyRef)
    // tool_calling: #ffbb44 = 0xffbb44
    expect(entry.body.tint).toBe(0xffbb44)
  })

  it('hover halo visibility tracks hoveredAgentId', () => {
    const layer = new AgentsLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1')],
      ['a2', makeAgent('a2')],
    ])

    layer.update(agents, null, 'a1', false, 0)

    expect(layer.getEntry('a1')!.hoverHalo.visible).toBe(true)
    expect(layer.getEntry('a2')!.hoverHalo.visible).toBe(false)

    layer.update(agents, null, null, false, 1)

    expect(layer.getEntry('a1')!.hoverHalo.visible).toBe(false)
  })

  it('dispose cleans up all entries', () => {
    const layer = new AgentsLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1')],
      ['a2', makeAgent('a2')],
    ])

    layer.update(agents, null, null, false, 0)
    expect(layer.entryCount).toBe(2)

    layer.dispose()

    expect(layer.entryCount).toBe(0)
  })

  it('destroys entries for agents that disappear between frames', () => {
    // Stale-id sweep (CR-3): when an agent id no longer appears in the
    // current frame's input, its entry is destroyed and removed from the
    // map. Previously entries were merely hidden, so the entry map grew
    // monotonically over long sessions.
    const layer = new AgentsLayer()

    // Frame 1: two agents
    const agents1 = new Map<string, Agent>([
      ['a1', makeAgent('a1')],
      ['a2', makeAgent('a2')],
    ])
    layer.update(agents1, null, null, false, 0)
    expect(layer.getEntry('a1')!.container.visible).toBe(true)
    expect(layer.getEntry('a2')!.container.visible).toBe(true)
    expect(layer.entryCount).toBe(2)

    // Frame 2: only a1 remains — a2 entry is destroyed and removed
    const agents2 = new Map<string, Agent>([
      ['a1', makeAgent('a1')],
    ])
    layer.update(agents2, null, null, false, 1)
    expect(layer.getEntry('a1')!.container.visible).toBe(true)
    expect(layer.getEntry('a2')).toBeUndefined()
    expect(layer.entryCount).toBe(1)
  })

  it('created entries have eventMode set to static', () => {
    const layer = new AgentsLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1')],
    ])

    layer.update(agents, null, null, false, 0)

    const entry = layer.getEntry('a1')!
    expect((entry.container as unknown as { eventMode: string }).eventMode).toBe('static')
  })

  it('pulse ring is visible only for thinking agents', () => {
    const layer = new AgentsLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', { state: 'thinking' })],
      ['a2', makeAgent('a2', { state: 'idle' })],
    ])

    layer.update(agents, null, null, false, 0)

    expect(layer.getEntry('a1')!.pulseRing.visible).toBe(true)
    expect(layer.getEntry('a2')!.pulseRing.visible).toBe(false)
  })
})
