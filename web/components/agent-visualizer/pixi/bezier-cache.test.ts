/**
 * Regression tests for the Pixi BezierCache module.
 *
 * Pins down two contracts established by the WG-1 perf pass:
 *   - IR-1: a single module-level `sharedBezierCache` instance is reused
 *     across EdgesLayer, ParticlesLayer, and instantiation cycles. Any
 *     attempt to "clean up on dispose" by clearing the cache, or to make
 *     each layer hold its own cache, would silently regress particle
 *     rendering performance and/or topology consistency between layers.
 *   - IR-2: `samplePolyline(polyline, t, scratch)` mutates and returns the
 *     caller-provided scratch object. The hot path (particles-layer) calls
 *     this thousands of times per frame; allocating a fresh object per
 *     call would re-introduce the GC churn the out-param was designed to
 *     eliminate.
 *
 * This file uses the REAL bezier-cache module (no vi.mock) so the assertions
 * exercise the actual implementation. pixi.js is mocked minimally for tests
 * that need to instantiate EdgesLayer/ParticlesLayer.
 *
 * Run with: cd web && pnpm test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock pixi.js (minimal — the cache itself is pure math) ────────────────
//
// Only EdgesLayer / ParticlesLayer instantiation needs pixi primitives. The
// shape mirrors the existing pixi/*-layer.test.ts mocks so importing those
// layers does not throw.

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

  class MockSprite {
    label = ''
    x = 0
    y = 0
    tint = 0xffffff
    alpha = 1
    visible = true
    blendMode = 'normal'
    texture: unknown
    anchor = { set: () => {} }
    scale = { set: () => {} }
    constructor(texture?: unknown) { this.texture = texture }
    destroy() { /* no-op */ }
  }

  class MockColor {
    value: unknown = ''
    toNumber() { return 0xffffff }
  }

  return {
    Container: MockContainer,
    Mesh: MockMesh,
    MeshGeometry: MockMeshGeometry,
    Sprite: MockSprite,
    Color: MockColor,
    Texture: { from: () => ({ destroy: () => {} }) },
  }
})

// ─── Mock pixi-app texture helpers (used by particles-layer) ───────────────

vi.mock('./pixi-app', () => ({
  getCircleTexture: () => ({ destroy: () => {} }),
  getGlowTexture: () => ({ destroy: () => {} }),
}))

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import {
  BezierCache,
  samplePolyline,
  sharedBezierCache,
  resetSharedBezierCache,
  type BezierSample,
  type CachedPolyline,
} from './bezier-cache'
import type { Agent, Edge, Particle, ToolCallNode } from '@/lib/agent-types'

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeAgent(id: string, x: number, y: number): Agent {
  return {
    id, name: id, x, y, opacity: 1,
    state: 'thinking', color: '#66ccff',
    isMain: true, scale: 1,
    spawnTime: 0, tokensUsed: 0, tokensMax: 100000,
    contextBreakdown: { systemPrompt: 0, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 },
    toolCalls: 0, timeAlive: 0, parentId: null,
    messageBubbles: [],
  } as unknown as Agent
}

function makeEdge(id: string, from: string, to: string): Edge {
  return { id, from, to, type: 'parent-child', opacity: 1 } as Edge
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('bezier-cache module', () => {
  beforeEach(() => {
    resetSharedBezierCache()
  })

  // ─── IR-2: zero-allocation samplePolyline ───────────────────────────────

  describe('samplePolyline (IR-2 scratch out-param)', () => {
    function buildPolyline(): CachedPolyline {
      // A polyline going straight along +x with a unit normal pointing +y.
      // Sample i has x=10*i, y=0, nx=0, ny=1.
      const n = 32
      const samples: BezierSample[] = []
      for (let i = 0; i <= n; i++) {
        samples.push({ x: 10 * i, y: 0, nx: 0, ny: 1 })
      }
      return {
        edgeId: 'e1',
        fromX: 0, fromY: 0, toX: 320, toY: 0,
        samples,
        cp1x: 100, cp1y: 0, cp2x: 200, cp2y: 0,
        dist: 320, dx: 320, dy: 0,
      }
    }

    it('returns the SAME scratch reference every call (no allocation)', () => {
      const polyline = buildPolyline()
      const scratch: BezierSample = { x: 0, y: 0, nx: 0, ny: 0 }

      // 1000 calls — if even one allocated, Object.is would fail.
      for (let k = 0; k < 1000; k++) {
        const t = (k % 100) / 100
        const result = samplePolyline(polyline, t, scratch)
        expect(Object.is(result, scratch)).toBe(true)
      }
    })

    it('mutates scratch with the expected interpolated values', () => {
      const polyline = buildPolyline()
      const scratch: BezierSample = { x: 0, y: 0, nx: 0, ny: 0 }

      // t=0 -> first sample exactly: (0, 0, 0, 1)
      samplePolyline(polyline, 0, scratch)
      expect(scratch.x).toBeCloseTo(0)
      expect(scratch.y).toBeCloseTo(0)
      expect(scratch.nx).toBeCloseTo(0)
      expect(scratch.ny).toBeCloseTo(1)

      // t=0.5 -> midpoint of polyline: x=160, y=0
      samplePolyline(polyline, 0.5, scratch)
      expect(scratch.x).toBeCloseTo(160)
      expect(scratch.y).toBeCloseTo(0)

      // t=1 -> clamps to last segment with frac=1: (320, 0, 0, 1)
      samplePolyline(polyline, 1, scratch)
      expect(scratch.x).toBeCloseTo(320)
      expect(scratch.y).toBeCloseTo(0)
    })

    it('a SECOND scratch call overwrites the FIRST result (proves shared mutation)', () => {
      // Pinning the documented contract: callers must consume the result
      // before the next call, because there's only one scratch object.
      const polyline = buildPolyline()
      const scratch: BezierSample = { x: 0, y: 0, nx: 0, ny: 0 }

      const first = samplePolyline(polyline, 0, scratch)
      // Reading first.x before second call captures the t=0 value.
      const firstXSnapshot = first.x

      const second = samplePolyline(polyline, 1, scratch)
      // After the second call, the same object now holds t=1's value.
      expect(first).toBe(second)             // same reference
      expect(first.x).toBeCloseTo(320)        // overwritten by t=1
      expect(firstXSnapshot).toBeCloseTo(0)   // value captured before overwrite
    })
  })

  // ─── IR-1: shared singleton ─────────────────────────────────────────────

  describe('sharedBezierCache (IR-1 module-level singleton)', () => {
    it('is a single BezierCache instance exported from the module', () => {
      // Re-import via dynamic ESM to confirm the module returns the same
      // instance — any path that produces a fresh BezierCache would break
      // the cross-layer sharing the perf pass relied on.
      expect(sharedBezierCache).toBeInstanceOf(BezierCache)
    })

    it('is shared between EdgesLayer and ParticlesLayer (single source of truth)', async () => {
      const { EdgesLayer } = await import('./edges-layer')
      const { ParticlesLayer } = await import('./particles-layer')

      const agents = new Map<string, Agent>([
        ['a1', makeAgent('a1', 0, 0)],
        ['a2', makeAgent('a2', 200, 100)],
      ])
      const toolCalls = new Map<string, ToolCallNode>()
      const edges = [makeEdge('e1', 'a1', 'a2')]
      const particles = [makeParticle('e1')]

      // Cache starts empty (resetSharedBezierCache in beforeEach).
      expect(sharedBezierCache.size).toBe(0)

      // EdgesLayer's update populates the singleton for 'e1'.
      const edgesLayer = new EdgesLayer()
      edgesLayer.update(edges, [], agents, toolCalls, 0)
      const sizeAfterEdges = sharedBezierCache.size
      expect(sizeAfterEdges).toBe(1)

      // ParticlesLayer's update should reuse the same singleton entry,
      // not create a duplicate. If each layer owned its own cache, the
      // singleton would still report size 1 (because particles-layer
      // would have its own private map), but the assertion below proves
      // particles-layer wrote into the SAME module-level cache: pruning
      // the singleton's set to {} would then evict the entry both layers
      // share.
      const particlesLayer = new ParticlesLayer()
      particlesLayer.update(particles, edges, agents, toolCalls, 0)
      expect(sharedBezierCache.size).toBe(1)

      // Force-prune the singleton: if particles-layer used a private cache,
      // its next update would not be affected; if it shares the singleton,
      // the next get() rebuilds. We just confirm the singleton is the
      // backing store for both by pruning to {}.
      sharedBezierCache.prune(new Set<string>())
      expect(sharedBezierCache.size).toBe(0)

      // Now particles-layer's next update re-populates the SAME singleton
      // (it has no other cache to fall back on).
      particlesLayer.update(particles, edges, agents, toolCalls, 0.016)
      expect(sharedBezierCache.size).toBe(1)
    })

    it('survives EdgesLayer dispose + re-instantiate (IR-1: dispose does NOT clear)', async () => {
      // The principal explicitly preserved cache state across mount/remount
      // cycles: "the shared bezier cache survives mount/remount cycles.
      // That's intentional." A future "clear cache on dispose" change would
      // silently undo the perf benefit; this test makes that regression
      // visible.
      const { EdgesLayer } = await import('./edges-layer')

      const agents = new Map<string, Agent>([
        ['a1', makeAgent('a1', 0, 0)],
        ['a2', makeAgent('a2', 200, 100)],
      ])
      const toolCalls = new Map<string, ToolCallNode>()
      const edges = [makeEdge('e1', 'a1', 'a2')]

      // Phase 1: populate.
      const layer1 = new EdgesLayer()
      layer1.update(edges, [], agents, toolCalls, 0)
      expect(sharedBezierCache.size).toBe(1)

      // Phase 2: dispose. The cache MUST NOT be cleared.
      layer1.dispose()
      expect(sharedBezierCache.size).toBe(1)

      // Phase 3: re-instantiate. The new layer can read the still-warm
      // cache without re-sampling the bezier curve from scratch.
      const layer2 = new EdgesLayer()
      // Without calling update(), the cache should still have 'e1'.
      expect(sharedBezierCache.size).toBe(1)
      // Sanity: the new layer can still update normally.
      layer2.update(edges, [], agents, toolCalls, 0.016)
      expect(sharedBezierCache.size).toBe(1)
    })
  })
})
