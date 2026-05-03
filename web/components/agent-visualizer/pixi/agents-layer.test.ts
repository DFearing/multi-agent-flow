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
//
// vi.hoisted lets `getGlyphSpy` be referenced inside the vi.mock factory
// (which is hoisted above all imports). The spy lets CR-2 tests count
// exactly how many glyph requests the layer made for stats overlay text.

const { getGlyphSpy } = vi.hoisted(() => ({
  getGlyphSpy: vi.fn((text: string, _color: string, fontSize?: number) => ({
    texture: { destroy: () => {}, source: {} },
    width: text.length * 6,
    height: (fontSize ?? 10) * 1.4,
  })),
}))

vi.mock('./glyph-atlas', () => ({
  GlyphAtlas: class {
    getGlyph(text: string, color: string, fontSize?: number) {
      return getGlyphSpy(text, color, fontSize)
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

  // ─── CR-3: leak prevention focused on sub-agents ─────────────────────────
  // The earlier "destroys entries" test covers a single-frame transition.
  // This pins down behaviour over a multi-frame window using sub-agents
  // (isMain=false, the population the simulation actually evicts) so a
  // future "grace period" or "isMain only" condition added to the sweep
  // would surface here.

  it('CR-3: sub-agents stable for 5 frames then absent → entries map empties', () => {
    const layer = new AgentsLayer()

    const subAgents = new Map<string, Agent>([
      ['s1', makeAgent('s1', { isMain: false })],
      ['s2', makeAgent('s2', { isMain: false })],
      ['s3', makeAgent('s3', { isMain: false })],
    ])

    for (let frame = 0; frame < 5; frame++) {
      layer.update(subAgents, null, null, false, frame * 0.016)
    }
    expect(layer.entryCount).toBe(3)

    // Frame 6: zero sub-agents — full sweep.
    layer.update(new Map(), null, null, false, 5 * 0.016)
    expect(layer.entryCount).toBe(0)
    expect(layer.getEntry('s1')).toBeUndefined()
    expect(layer.getEntry('s2')).toBeUndefined()
    expect(layer.getEntry('s3')).toBeUndefined()
  })

  // ─── CR-2: glyph-request cap on stats overlay ────────────────────────────
  // Pre-fix the stats overlay was a single sprite carrying
  // `${toolCalls} tools · ${timeAlive.toFixed(1)}s`. Because timeAlive
  // ticks every frame (~60Hz), a unique glyph was uploaded to the atlas
  // every frame — pumping the LRU and pinning the perf regression.
  //
  // Post-fix the overlay is split into a stable label sprite and a value
  // sprite quantized to integer seconds. Over 100 frames covering 10
  // simulated seconds, the label requires 1 glyph (toolCalls constant)
  // and the value requires at most 11 (one per integer-second crossing,
  // plus the initial render).
  //
  // A regression that drops the integer quantization or recombines the
  // sprite would push the value sprite back into the 100s — this test
  // catches that.

  it('CR-2: stats overlay value sprite re-renders ≤11 times across 100 frames at 10Hz', () => {
    const layer = new AgentsLayer()
    const agent = makeAgent('a1', { toolCalls: 3, timeAlive: 0 })
    const agents = new Map<string, Agent>([['a1', agent]])

    // Warm-up: spawn the entry and capture initial glyph requests so
    // subsequent calls are attributable to the stats overlay updates only.
    layer.update(agents, null, null, true, 0)
    getGlyphSpy.mockClear()

    // 100 frames, +0.1s per frame → timeAlive sweeps 0.1 .. 10.0
    // Floor(timeAlive) crosses 10 distinct integer seconds (0..9).
    for (let frame = 1; frame <= 100; frame++) {
      agent.timeAlive = frame * 0.1
      layer.update(agents, null, null, true, frame * 0.016)
    }

    // Filter the spy calls by sprite kind. The value text matches /^\d+s$/
    // (e.g. "0s", "1s"); the label text is "3 tools · " (toolCalls=3).
    const allCalls = getGlyphSpy.mock.calls
    const valueCalls = allCalls.filter(([text]) => /^\d+s$/.test(text))
    const labelCalls = allCalls.filter(([text]) => text === '3 tools · ')

    // Value sprite: one per integer-second crossing (0..9) — ≤ 11 leaves
    // a bucket for the initial render.
    expect(valueCalls.length).toBeGreaterThan(0) // at least re-rendered
    expect(valueCalls.length).toBeLessThanOrEqual(11)

    // Label sprite: toolCalls is constant, so label stays at 0 calls
    // after warm-up (or 1 if the first warm-up call was missed). Allow
    // for either; the contract is "no per-frame churn".
    expect(labelCalls.length).toBeLessThanOrEqual(1)
  })
})
