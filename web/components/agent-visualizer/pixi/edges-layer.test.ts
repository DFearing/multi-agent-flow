/**
 * Unit tests for EdgesLayer — validates rope creation, pooling, disposal,
 * and active/idle tint assignment.
 *
 * Run with: cd web && pnpm test
 *
 * Since EdgesLayer depends on pixi.js (browser-only), we mock the Pixi
 * primitives and BezierCache to test the logic in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pixi.js before importing EdgesLayer ──────────────────────────────
// vi.mock factories are hoisted — all definitions must be self-contained.

vi.mock('pixi.js', () => {
  class MockPoint {
    x: number
    y: number
    constructor(x = 0, y = 0) { this.x = x; this.y = y }
  }

  class MockContainer {
    label = ''
    children: unknown[] = []
    addChild(child: unknown) { this.children.push(child) }
    removeChild(child: unknown) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) this.children.splice(idx, 1)
    }
    destroy() { this.children.length = 0 }
  }

  class MockMeshRope {
    label = ''
    tint = 0xffffff
    alpha = 1
    visible = true
    texture: unknown
    points: InstanceType<typeof MockPoint>[]
    width: number
    constructor(opts: { texture: unknown; points: InstanceType<typeof MockPoint>[]; width?: number }) {
      this.texture = opts.texture
      this.points = opts.points
      this.width = opts.width ?? 1
    }
    destroy() { /* no-op */ }
  }

  return {
    Container: MockContainer,
    MeshRope: MockMeshRope,
    Point: MockPoint,
    Texture: { from: () => ({ destroy: () => {} }) },
  }
})

// ─── Mock BezierCache ──────────────────────────────────────────────────────

// vi.hoisted lets us define variables that vi.mock factories can reference.
const { mockBezierCacheGet, mockBezierCachePrune, mockBezierCacheClear } = vi.hoisted(() => ({
  mockBezierCacheGet: vi.fn(),
  mockBezierCachePrune: vi.fn(),
  mockBezierCacheClear: vi.fn(),
}))

vi.mock('./bezier-cache', () => {
  // Singleton instance shared by edges-layer and particles-layer in production.
  // The test exposes the same handle so assertions can verify shared usage.
  const sharedBezierCache = {
    get: mockBezierCacheGet,
    prune: mockBezierCachePrune,
    clear: mockBezierCacheClear,
  }
  return {
    BezierCache: class {
      get = mockBezierCacheGet
      prune = mockBezierCachePrune
      clear = mockBezierCacheClear
    },
    sharedBezierCache,
    resetSharedBezierCache: () => mockBezierCacheClear(),
    samplePolyline: (_polyline: unknown, _t: number, out: { x: number; y: number; nx: number; ny: number }) => out,
  }
})

// ─── Mock canvas/draw-edges ────────────────────────────────────────────────

vi.mock('../canvas/draw-edges', () => ({
  getActiveEdgeIds: (particles: Array<{ edgeId: string }>) => {
    const ids = new Set<string>()
    for (const p of particles) ids.add(p.edgeId)
    return ids
  },
}))

// ─── Mock canvas-constants ─────────────────────────────────────────────────

vi.mock('@/lib/canvas-constants', () => ({
  MIN_VISIBLE_OPACITY: 0,
}))

// ─── Import EdgesLayer after mocks ─────────────────────────────────────────

import { EdgesLayer } from './edges-layer'
import type { Edge, Agent, Particle, ToolCallNode } from '@/lib/agent-types'

// ─── Helpers ───────────────────────────────────────────────────────────────

const mockPolylineSamples = Array.from({ length: 33 }, (_, i) => ({
  x: i * 10, y: i * 5, nx: 0, ny: 1,
}))

function mockPolyline(edgeId: string) {
  return {
    edgeId,
    fromX: 0, fromY: 0, toX: 320, toY: 160,
    samples: mockPolylineSamples,
    cp1x: 100, cp1y: 50, cp2x: 200, cp2y: 100,
    dist: 357, dx: 320, dy: 160,
  }
}

function makeEdge(id: string, from: string, to: string, type: 'parent-child' | 'tool' = 'parent-child'): Edge {
  return { id, from, to, type, opacity: 1 }
}

function makeAgent(id: string, x = 0, y = 0): Agent {
  return {
    id, name: id, x, y, opacity: 1,
    state: 'thinking', color: '#66ccff',
    radius: 20, targetX: x, targetY: y, vx: 0, vy: 0,
    pinned: false, contextWindow: { used: 0, max: 100000 },
  } as unknown as Agent
}

function makeParticle(edgeId: string): Particle {
  return {
    id: `p-${edgeId}`,
    edgeId,
    progress: 0.5,
    type: 'dispatch',
    color: '#66ccff',
    size: 3,
    trailLength: 8,
  }
}

function makeToolCall(id: string, x = 0, y = 0): ToolCallNode {
  return {
    id, name: id, x, y, opacity: 1,
    state: 'running', agentId: 'a1',
  } as unknown as ToolCallNode
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('EdgesLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set up default mock: return a polyline for any edge
    mockBezierCacheGet.mockImplementation(
      (edge: { id: string }) => mockPolyline(edge.id),
    )
  })

  it('spawns one display object per edge', () => {
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 100, 100)],
      ['a3', makeAgent('a3', 200, 200)],
    ])
    const edges = [
      makeEdge('e1', 'a1', 'a2'),
      makeEdge('e2', 'a1', 'a3'),
      makeEdge('e3', 'a2', 'a3'),
    ]

    layer.update(edges, [], agents, new Map(), 0)

    expect(layer.entryCount).toBe(3)
    expect(layer.container.children.length).toBe(3)
  })

  it('does not allocate new ropes when the same edge set is passed again', () => {
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 100, 100)],
    ])
    const edges = [makeEdge('e1', 'a1', 'a2')]

    layer.update(edges, [], agents, new Map(), 0)
    const firstEntry = layer.getEntry('e1')
    expect(firstEntry).toBeDefined()

    // Second update with same edges — should reuse the existing rope
    layer.update(edges, [], agents, new Map(), 1)
    const secondEntry = layer.getEntry('e1')

    expect(secondEntry).toBe(firstEntry)
    expect(layer.entryCount).toBe(1)
  })

  it('dispose removes all display objects from the container', () => {
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 100, 100)],
    ])
    const edges = [makeEdge('e1', 'a1', 'a2')]

    layer.update(edges, [], agents, new Map(), 0)
    expect(layer.entryCount).toBe(1)

    layer.dispose()

    expect(layer.entryCount).toBe(0)
  })

  it('active edges get the active alpha; idle edges get the idle alpha', () => {
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 100, 100)],
      ['a3', makeAgent('a3', 200, 200)],
    ])
    const edges = [
      makeEdge('e1', 'a1', 'a2'),
      makeEdge('e2', 'a1', 'a3'),
    ]
    // Only e1 has a particle — so e1 is active, e2 is idle
    const particles = [makeParticle('e1')]

    layer.update(edges, particles, agents, new Map(), 0)

    const activeEntry = layer.getEntry('e1')
    const idleEntry = layer.getEntry('e2')

    expect(activeEntry).toBeDefined()
    expect(idleEntry).toBeDefined()

    // Active edge alpha should be higher than idle edge alpha.
    // BEAM.activeAlpha = 0.3, BEAM.idleAlpha = 0.08
    // Active alpha is modulated by pulsing: sin(0 * 4) * 0.1 + 0.9 = 0.9
    // So active alpha = 0.3 * 0.9 = 0.27, idle = 0.08 * 1 = 0.08
    expect(activeEntry!.rope.alpha).toBeGreaterThan(idleEntry!.rope.alpha)
  })

  it('active edges get the correct tint for their type', () => {
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 100, 100)],
    ])
    const toolCalls = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1', 200, 200)],
    ])
    const edges = [
      makeEdge('e1', 'a1', 'a2', 'parent-child'),
      makeEdge('e2', 'a1', 't1', 'tool'),
    ]

    layer.update(edges, [], agents, toolCalls, 0)

    const parentChildEntry = layer.getEntry('e1')
    const toolEntry = layer.getEntry('e2')

    // COLORS.holoBase = '#66ccff' -> 0x66ccff
    expect(parentChildEntry!.rope.tint).toBe(0x66ccff)
    // COLORS.tool = '#ffbb44' -> 0xffbb44
    expect(toolEntry!.rope.tint).toBe(0xffbb44)
  })

  it('hides ropes for edges that disappear between frames', () => {
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 100, 100)],
      ['a3', makeAgent('a3', 200, 200)],
    ])

    // Frame 1: two edges
    layer.update(
      [makeEdge('e1', 'a1', 'a2'), makeEdge('e2', 'a1', 'a3')],
      [], agents, new Map(), 0,
    )
    expect(layer.getEntry('e1')!.rope.visible).toBe(true)
    expect(layer.getEntry('e2')!.rope.visible).toBe(true)

    // Frame 2: only e1 remains
    layer.update(
      [makeEdge('e1', 'a1', 'a2')],
      [], agents, new Map(), 1,
    )
    expect(layer.getEntry('e1')!.rope.visible).toBe(true)
    expect(layer.getEntry('e2')!.rope.visible).toBe(false)
  })
})
