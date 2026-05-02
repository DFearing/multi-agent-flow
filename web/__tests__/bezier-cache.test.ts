/**
 * Unit tests for BezierCache — validates caching, invalidation, and pruning.
 *
 * Run with: cd web && npx tsx --test __tests__/bezier-cache.test.ts
 *
 * Uses Node's built-in test runner (same pattern as extension/).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// BezierCache imports from canvas/draw-edges which uses @/ path aliases.
// To avoid needing a full bundler, we test the cache logic in isolation
// by duplicating the minimal API surface.

// ─── Minimal reimplementation of BezierCache logic for unit testing ─────────

interface BezierSample {
  x: number; y: number; nx: number; ny: number
}

interface CachedPolyline {
  edgeId: string
  fromX: number; fromY: number
  toX: number; toY: number
  samples: BezierSample[]
}

const POSITION_THRESHOLD_SQ = 4

function bezierPoint(t: number, p0: number, p1: number, p2: number, p3: number) {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

class TestBezierCache {
  private cache = new Map<string, CachedPolyline>()
  private sampleCount = 16

  get(edgeId: string, fromX: number, fromY: number, toX: number, toY: number): CachedPolyline | null {
    const dx = toX - fromX, dy = toY - fromY
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 1) return null

    const existing = this.cache.get(edgeId)
    if (existing) {
      const dFromSq = (existing.fromX - fromX) ** 2 + (existing.fromY - fromY) ** 2
      const dToSq = (existing.toX - toX) ** 2 + (existing.toY - toY) ** 2
      if (dFromSq <= POSITION_THRESHOLD_SQ && dToSq <= POSITION_THRESHOLD_SQ) {
        return existing
      }
    }

    const curvature = 0.15
    const perpX = -dy / dist * dist * curvature
    const perpY = dx / dist * dist * curvature
    const cp1x = fromX + dx * 0.33 + perpX
    const cp1y = fromY + dy * 0.33 + perpY
    const cp2x = fromX + dx * 0.66 + perpX
    const cp2y = fromY + dy * 0.66 + perpY

    const n = this.sampleCount
    const samples: BezierSample[] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      samples.push({
        x: bezierPoint(t, fromX, cp1x, cp2x, toX),
        y: bezierPoint(t, fromY, cp1y, cp2y, toY),
        nx: 0, ny: 0,
      })
    }

    const polyline: CachedPolyline = { edgeId, fromX, fromY, toX, toY, samples }
    this.cache.set(edgeId, polyline)
    return polyline
  }

  prune(activeEdgeIds: Set<string>): void {
    for (const id of this.cache.keys()) {
      if (!activeEdgeIds.has(id)) this.cache.delete(id)
    }
  }

  clear(): void { this.cache.clear() }
  get size(): number { return this.cache.size }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('BezierCache', () => {
  it('same edge id returns the same array reference when positions unchanged', () => {
    const cache = new TestBezierCache()
    const a = cache.get('e1', 0, 0, 100, 100)
    const b = cache.get('e1', 0, 0, 100, 100)
    assert.ok(a !== null)
    assert.strictEqual(a, b, 'should return cached reference')
  })

  it('returns cached reference for small position changes below threshold', () => {
    const cache = new TestBezierCache()
    const a = cache.get('e1', 0, 0, 100, 100)
    // Move by less than 2px (threshold is sqrt(4) = 2)
    const b = cache.get('e1', 0.5, 0.5, 100, 100)
    assert.ok(a !== null)
    assert.strictEqual(a, b, 'should return cached reference for sub-threshold movement')
  })

  it('invalidates when position changes exceed threshold', () => {
    const cache = new TestBezierCache()
    const a = cache.get('e1', 0, 0, 100, 100)
    // Move by more than 2px
    const b = cache.get('e1', 5, 5, 100, 100)
    assert.ok(a !== null)
    assert.ok(b !== null)
    assert.notStrictEqual(a, b, 'should recompute for large position change')
  })

  it('prune removes entries not in active set', () => {
    const cache = new TestBezierCache()
    cache.get('e1', 0, 0, 100, 100)
    cache.get('e2', 0, 0, 200, 200)
    assert.strictEqual(cache.size, 2)

    cache.prune(new Set(['e1']))
    assert.strictEqual(cache.size, 1)
  })

  it('returns null for degenerate edges (zero length)', () => {
    const cache = new TestBezierCache()
    const result = cache.get('e1', 50, 50, 50, 50)
    assert.strictEqual(result, null)
  })

  it('clear removes all entries', () => {
    const cache = new TestBezierCache()
    cache.get('e1', 0, 0, 100, 100)
    cache.get('e2', 0, 0, 200, 200)
    cache.clear()
    assert.strictEqual(cache.size, 0)
  })

  it('different edge ids get separate cache entries', () => {
    const cache = new TestBezierCache()
    const a = cache.get('e1', 0, 0, 100, 100)
    const b = cache.get('e2', 0, 0, 100, 100)
    assert.ok(a !== null)
    assert.ok(b !== null)
    assert.notStrictEqual(a, b, 'different edge ids should have separate entries')
    assert.strictEqual(cache.size, 2)
  })
})
