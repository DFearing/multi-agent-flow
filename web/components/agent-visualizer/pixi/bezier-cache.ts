/**
 * Bezier polyline cache — precomputes sampled points along each edge's cubic
 * bezier curve once per topology change (when edge endpoints move). Particles
 * share the precomputed samples instead of evaluating bezierPoint per particle
 * per trail segment per frame.
 *
 * Cache key: edge id. Invalidation: when the from/to positions change by more
 * than a threshold, or when the edge id disappears from the active set.
 */

import { bezierPoint, computeControlPoints } from '../canvas/draw-edges'
import type { Agent, Edge, ToolCallNode } from '@/lib/agent-types'
import { resolveEdgeTarget } from '../canvas/draw-edges'

/** A sampled point on the bezier, including the perpendicular normal for wobble. */
export interface BezierSample {
  x: number
  y: number
  /** Unit normal X (perpendicular to tangent) */
  nx: number
  /** Unit normal Y (perpendicular to tangent) */
  ny: number
}

export interface CachedPolyline {
  edgeId: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  /** Evenly-spaced samples from t=0 to t=1. Length = sampleCount + 1. */
  samples: BezierSample[]
  /** Control points for reference */
  cp1x: number
  cp1y: number
  cp2x: number
  cp2y: number
  /** Distance between endpoints */
  dist: number
  dx: number
  dy: number
}

/** Distance threshold (squared) for position change before re-sampling */
const POSITION_THRESHOLD_SQ = 4 // 2px

/** Default number of samples along the bezier (t=0 to t=1, inclusive) */
const DEFAULT_SAMPLE_COUNT = 32

export class BezierCache {
  private cache = new Map<string, CachedPolyline>()
  private sampleCount: number

  constructor(sampleCount = DEFAULT_SAMPLE_COUNT) {
    this.sampleCount = sampleCount
  }

  /** Look up a cached polyline for an edge, or return null if the edge
   *  has no valid endpoints. Recomputes if endpoints moved. */
  get(
    edge: Edge,
    agents: Map<string, Agent>,
    toolCalls: Map<string, ToolCallNode>,
  ): CachedPolyline | null {
    const fromAgent = agents.get(edge.from)
    if (!fromAgent) return null

    const target = resolveEdgeTarget(edge, agents, toolCalls)
    if (!target) return null

    const fromX = fromAgent.x
    const fromY = fromAgent.y
    const toX = target.x
    const toY = target.y

    const existing = this.cache.get(edge.id)
    if (existing && !this.needsUpdate(existing, fromX, fromY, toX, toY)) {
      return existing
    }

    const cp = computeControlPoints(fromX, fromY, toX, toY)
    if (!cp) return null

    const polyline = this.buildPolyline(
      edge.id, fromX, fromY, toX, toY,
      cp.cp1x, cp.cp1y, cp.cp2x, cp.cp2y,
      cp.dist, cp.dx, cp.dy,
    )
    this.cache.set(edge.id, polyline)
    return polyline
  }

  /** Remove entries for edges no longer in the active set. */
  prune(activeEdgeIds: Set<string>): void {
    for (const id of this.cache.keys()) {
      if (!activeEdgeIds.has(id)) {
        this.cache.delete(id)
      }
    }
  }

  /** Clear all cached data. */
  clear(): void {
    this.cache.clear()
  }

  /** Number of cached polylines — useful for tests. */
  get size(): number {
    return this.cache.size
  }

  private needsUpdate(
    cached: CachedPolyline,
    fromX: number, fromY: number,
    toX: number, toY: number,
  ): boolean {
    const dFromSq = (cached.fromX - fromX) ** 2 + (cached.fromY - fromY) ** 2
    if (dFromSq > POSITION_THRESHOLD_SQ) return true
    const dToSq = (cached.toX - toX) ** 2 + (cached.toY - toY) ** 2
    return dToSq > POSITION_THRESHOLD_SQ
  }

  private buildPolyline(
    edgeId: string,
    fromX: number, fromY: number,
    toX: number, toY: number,
    cp1x: number, cp1y: number,
    cp2x: number, cp2y: number,
    dist: number, dx: number, dy: number,
  ): CachedPolyline {
    const n = this.sampleCount
    const samples: BezierSample[] = new Array(n + 1)
    const dt = 0.001

    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = bezierPoint(t, fromX, cp1x, cp2x, toX)
      const y = bezierPoint(t, fromY, cp1y, cp2y, toY)

      // Compute tangent via finite difference for the normal
      const t0 = Math.max(0, t - dt)
      const t1 = Math.min(1, t + dt)
      const tx = bezierPoint(t1, fromX, cp1x, cp2x, toX) - bezierPoint(t0, fromX, cp1x, cp2x, toX)
      const ty = bezierPoint(t1, fromY, cp1y, cp2y, toY) - bezierPoint(t0, fromY, cp1y, cp2y, toY)
      const len = Math.sqrt(tx * tx + ty * ty) || 1
      // Normal is perpendicular to tangent (rotated 90 degrees CCW)
      const nx = -ty / len
      const ny = tx / len

      samples[i] = { x, y, nx, ny }
    }

    return {
      edgeId, fromX, fromY, toX, toY,
      samples, cp1x, cp1y, cp2x, cp2y,
      dist, dx, dy,
    }
  }
}

/** Interpolate a position along the precomputed polyline at parameter t (0..1).
 *  Mutates and returns `out` with the interpolated {x, y, nx, ny} by lerping
 *  between the two nearest samples. Cheaper than evaluating the cubic
 *  polynomial. The out-parameter form lets the hot path (particles-layer)
 *  reuse a single scratch object across thousands of calls per frame. */
export function samplePolyline(
  polyline: CachedPolyline, t: number, out: BezierSample,
): BezierSample {
  const n = polyline.samples.length - 1
  const idx = t * n
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(idx)))
  const i1 = i0 + 1
  const frac = idx - i0
  const a = polyline.samples[i0]
  const b = polyline.samples[i1]
  out.x = a.x + (b.x - a.x) * frac
  out.y = a.y + (b.y - a.y) * frac
  out.nx = a.nx + (b.nx - a.nx) * frac
  out.ny = a.ny + (b.ny - a.ny) * frac
  return out
}

/**
 * Module-level singleton shared by EdgesLayer and ParticlesLayer. Both layers
 * compute polyline samples for the same edges; sharing the cache avoids
 * redundant bezier evaluation each frame and keeps a single source of truth
 * for invalidation timing.
 */
export const sharedBezierCache = new BezierCache()

/** Test helper — clears the shared cache between test runs. */
export function resetSharedBezierCache(): void {
  sharedBezierCache.clear()
}
