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

  // Minimal Buffer.update() / getBuffer() surface so the layer's
  // `geometry.getBuffer('aPosition').update()` call works in jsdom.
  class MockBuffer {
    data: Float32Array
    _updates = 0
    constructor(data: Float32Array) { this.data = data }
    update() { this._updates++ }
  }

  class MockMeshGeometry {
    positions: Float32Array
    uvs: Float32Array
    indices: Uint32Array
    private _positionBuffer: MockBuffer
    constructor(opts: { positions: Float32Array; uvs: Float32Array; indices: Uint32Array }) {
      this.positions = opts.positions
      this.uvs = opts.uvs
      this.indices = opts.indices
      this._positionBuffer = new MockBuffer(opts.positions)
    }
    getBuffer(name: string) {
      if (name === 'aPosition') return this._positionBuffer
      throw new Error(`unknown buffer ${name}`)
    }
    destroy(_destroyBuffers?: boolean) { /* no-op */ }
  }

  class MockMesh {
    label = ''
    tint = 0xffffff
    alpha = 1
    visible = true
    geometry: MockMeshGeometry
    texture: unknown
    constructor(opts: { geometry: MockMeshGeometry; texture: unknown }) {
      this.geometry = opts.geometry
      this.texture = opts.texture
    }
    destroy(_opts?: unknown) { /* no-op */ }
  }

  return {
    Container: MockContainer,
    Mesh: MockMesh,
    MeshGeometry: MockMeshGeometry,
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
    expect(activeEntry!.mesh.alpha).toBeGreaterThan(idleEntry!.mesh.alpha)
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
    expect(parentChildEntry!.mesh.tint).toBe(0x66ccff)
    // COLORS.tool = '#ffbb44' -> 0xffbb44
    expect(toolEntry!.mesh.tint).toBe(0xffbb44)
  })

  it('destroys mesh entries for edges that disappear between frames', () => {
    // Stale-id sweep (CR-3): when an edge id no longer appears in the
    // current frame's input, its entry is destroyed and removed from the
    // map — preventing the previously unbounded growth of hidden meshes.
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
    expect(layer.getEntry('e1')!.mesh.visible).toBe(true)
    expect(layer.getEntry('e2')!.mesh.visible).toBe(true)
    expect(layer.entryCount).toBe(2)

    // Frame 2: only e1 remains — e2 entry should be destroyed and removed
    layer.update(
      [makeEdge('e1', 'a1', 'a2')],
      [], agents, new Map(), 1,
    )
    expect(layer.getEntry('e1')!.mesh.visible).toBe(true)
    expect(layer.getEntry('e2')).toBeUndefined()
    expect(layer.entryCount).toBe(1)
  })

  // ─── CR-1: vertex-offset width assertions ────────────────────────────────
  // The previous MeshRope path silently ignored the `width` constructor
  // option; every edge rendered at the rope texture's native height. The
  // current strip Mesh encodes width directly into the geometry by placing
  // top/bottom vertices at ±halfWidth along the precomputed sample normal.
  // These tests pin down that contract: they read the raw vertex buffer and
  // assert the exact offsets. A regression to MeshRope (or any geometry
  // that ignores the per-edge-type half-width) would fail here.

  it('CR-1: parent-child edges place top/bottom vertices ±1.5 along the sample normal', () => {
    // BEAM.parentChild.startW = 3 → halfWidth = 1.5
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 320, 160)],
    ])
    const edges = [makeEdge('e1', 'a1', 'a2', 'parent-child')]

    layer.update(edges, [], agents, new Map(), 0)

    const entry = layer.getEntry('e1')!
    const buffer = entry.mesh.geometry.getBuffer('aPosition') as unknown as { data: Float32Array }
    const positions = buffer.data
    expect(positions.length).toBe(mockPolylineSamples.length * 4)

    // Sample three indices spanning the polyline; assert offsets are
    // EXACTLY ±halfWidth * normal (mockPolylineSamples have nx=0, ny=1).
    const halfW = 1.5
    for (const i of [0, 10, mockPolylineSamples.length - 1]) {
      const s = mockPolylineSamples[i]
      const o = i * 4
      const topX = positions[o + 0]
      const topY = positions[o + 1]
      const botX = positions[o + 2]
      const botY = positions[o + 3]
      // top  = (s.x + nx*halfW, s.y + ny*halfW)
      // bot  = (s.x - nx*halfW, s.y - ny*halfW)
      expect(topX).toBeCloseTo(s.x + s.nx * halfW)
      expect(topY).toBeCloseTo(s.y + s.ny * halfW)
      expect(botX).toBeCloseTo(s.x - s.nx * halfW)
      expect(botY).toBeCloseTo(s.y - s.ny * halfW)
      // Euclidean distance between top and bot must equal beamWidth (3).
      const dx = topX - botX
      const dy = topY - botY
      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(3)
    }
  })

  it('CR-1: tool edges place top/bottom vertices ±0.75 along the sample normal', () => {
    // BEAM.tool.startW = 1.5 → halfWidth = 0.75. A regression that
    // re-introduces a single rope width across edge types would still pass
    // the parent-child test above; this asserts the per-type discrimination.
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
    ])
    const toolCalls = new Map<string, ToolCallNode>([
      ['t1', makeToolCall('t1', 200, 100)],
    ])
    const edges = [makeEdge('e1', 'a1', 't1', 'tool')]

    layer.update(edges, [], agents, toolCalls, 0)

    const entry = layer.getEntry('e1')!
    const buffer = entry.mesh.geometry.getBuffer('aPosition') as unknown as { data: Float32Array }
    const positions = buffer.data
    const halfW = 0.75
    for (const i of [0, 16, mockPolylineSamples.length - 1]) {
      const s = mockPolylineSamples[i]
      const o = i * 4
      // The Euclidean width for tool edges must be 1.5, not 3.
      const topX = positions[o + 0]
      const topY = positions[o + 1]
      const botX = positions[o + 2]
      const botY = positions[o + 3]
      expect(topX).toBeCloseTo(s.x + s.nx * halfW)
      expect(topY).toBeCloseTo(s.y + s.ny * halfW)
      expect(botX).toBeCloseTo(s.x - s.nx * halfW)
      expect(botY).toBeCloseTo(s.y - s.ny * halfW)
      const dx = topX - botX
      const dy = topY - botY
      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(1.5)
    }
  })

  it('CR-1: GPU position buffer is flagged dirty (update() called) on every frame', () => {
    // Without the explicit getBuffer('aPosition').update() call, the
    // mutated positions never reach the GPU and the mesh would freeze at
    // its initial (zero-filled) geometry. A refactor that drops that call
    // would silently break edge animation; this test catches it.
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 100, 100)],
    ])
    const edges = [makeEdge('e1', 'a1', 'a2')]

    layer.update(edges, [], agents, new Map(), 0)
    const entry = layer.getEntry('e1')!
    const buffer = entry.mesh.geometry.getBuffer('aPosition') as unknown as { _updates: number }
    expect(buffer._updates).toBeGreaterThanOrEqual(1)
    const updatesAfterFrame1 = buffer._updates

    // Frame 2: same edge, different time. Even if endpoints did not move,
    // the layer must re-flag the buffer because positions are recomputed
    // every frame from the polyline samples.
    layer.update(edges, [], agents, new Map(), 0.016)
    expect(buffer._updates).toBeGreaterThan(updatesAfterFrame1)
  })

  // ─── CR-3: leak prevention with destroy() spy ───────────────────────────

  it('CR-3: stale entries are destroyed (mesh.destroy spied) and dropped from the map', () => {
    // Strengthens the existing "destroys mesh entries" test by:
    //   (1) running 3 stable frames (so the buggy "hide only" code would
    //       have grown the entries Map across frames),
    //   (2) feeding zero edges in the final frame (full sweep),
    //   (3) spying on Mesh.destroy to confirm the GPU teardown runs, not
    //       just a Map.delete.
    const layer = new EdgesLayer()
    const agents = new Map<string, Agent>([
      ['a1', makeAgent('a1', 0, 0)],
      ['a2', makeAgent('a2', 100, 100)],
      ['a3', makeAgent('a3', 200, 200)],
      ['a4', makeAgent('a4', 300, 300)],
      ['a5', makeAgent('a5', 400, 400)],
      ['a6', makeAgent('a6', 500, 500)],
    ])
    const edges = [
      makeEdge('e1', 'a1', 'a2'),
      makeEdge('e2', 'a3', 'a4'),
      makeEdge('e3', 'a5', 'a6'),
      makeEdge('e4', 'a2', 'a4'),
      makeEdge('e5', 'a3', 'a5'),
    ]

    // Three stable frames — entries should stabilise at 5.
    layer.update(edges, [], agents, new Map(), 0)
    layer.update(edges, [], agents, new Map(), 0.016)
    layer.update(edges, [], agents, new Map(), 0.032)
    expect(layer.entryCount).toBe(5)

    // Spy on each entry's mesh.destroy to confirm cleanup runs.
    const destroySpies = ['e1', 'e2', 'e3', 'e4', 'e5'].map(id => {
      const entry = layer.getEntry(id)!
      return vi.spyOn(entry.mesh, 'destroy')
    })

    // Frame 4: zero edges → full sweep.
    layer.update([], [], agents, new Map(), 0.048)

    expect(layer.entryCount).toBe(0)
    for (const spy of destroySpies) {
      expect(spy).toHaveBeenCalled()
    }
  })
})
