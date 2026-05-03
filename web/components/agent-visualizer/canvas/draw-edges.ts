import { Agent, ToolCallNode, Particle, Edge, BEAM, ANIM } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { alphaHex } from '@/lib/utils'
import { MIN_VISIBLE_OPACITY } from '@/lib/canvas-constants'
import { type ViewBounds, isBezierVisible } from './viewport'

export function bezierPoint(t: number, p0: number, p1: number, p2: number, p3: number) {
  const mt = 1 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

/** Resolve edge endpoint to {x, y} from either agents or toolCalls map */
export function resolveEdgeTarget(
  edge: Edge, agents: Map<string, Agent>, toolCalls: Map<string, ToolCallNode>,
  minOpacity = 0,
): { x: number; y: number } | null {
  const toAgent = agents.get(edge.to)
  if (toAgent && toAgent.opacity >= minOpacity) return toAgent
  const toTool = toolCalls.get(edge.to)
  if (toTool && toTool.opacity >= minOpacity) return toTool
  return null
}

/** Compute bezier control points for an edge between two positions */
export function computeControlPoints(fromX: number, fromY: number, toX: number, toY: number) {
  const dx = toX - fromX, dy = toY - fromY
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 1) return null
  const curvature = dist * BEAM.curvature
  const perpX = -dy / dist * curvature, perpY = dx / dist * curvature
  return {
    cp1x: fromX + dx * BEAM.cp1 + perpX, cp1y: fromY + dy * BEAM.cp1 + perpY,
    cp2x: fromX + dx * BEAM.cp2 + perpX, cp2y: fromY + dy * BEAM.cp2 + perpY,
    dist, dx, dy,
  }
}

// Scratch buffers reused across every drawTaperedBezier call to avoid
// allocating BEAM.segments+1 sample objects per edge per frame.
// Sized once and never reallocated; the same Float32Array is overwritten
// on each invocation. Single-threaded rendering makes this safe.
const SAMPLE_CAP = BEAM.segments + 1
const sampleX = new Float32Array(SAMPLE_CAP)
const sampleY = new Float32Array(SAMPLE_CAP)
const sampleNx = new Float32Array(SAMPLE_CAP)
const sampleNy = new Float32Array(SAMPLE_CAP)

export function drawTaperedBezier(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  toX: number, toY: number,
  startWidth: number, endWidth: number,
  color: string, alpha: number,
) {
  const steps = BEAM.segments
  const dt = 0.001

  // Sample the curve once into reusable scratch buffers, then walk the
  // buffers twice (forward = left edge, reverse = right edge) to build
  // the tapered outline polygon.
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const halfW = (startWidth + (endWidth - startWidth) * t) / 2
    const t0 = t - dt < 0 ? 0 : t - dt
    const t1 = t + dt > 1 ? 1 : t + dt
    const tx = bezierPoint(t1, fromX, cp1x, cp2x, toX) - bezierPoint(t0, fromX, cp1x, cp2x, toX)
    const ty = bezierPoint(t1, fromY, cp1y, cp2y, toY) - bezierPoint(t0, fromY, cp1y, cp2y, toY)
    const len = Math.sqrt(tx * tx + ty * ty) || 1
    sampleX[i] = bezierPoint(t, fromX, cp1x, cp2x, toX)
    sampleY[i] = bezierPoint(t, fromY, cp1y, cp2y, toY)
    sampleNx[i] = (-ty / len) * halfW
    sampleNy[i] = (tx / len) * halfW
  }

  ctx.beginPath()
  ctx.moveTo(sampleX[0] + sampleNx[0], sampleY[0] + sampleNy[0])
  for (let i = 1; i <= steps; i++) {
    ctx.lineTo(sampleX[i] + sampleNx[i], sampleY[i] + sampleNy[i])
  }
  for (let i = steps; i >= 0; i--) {
    ctx.lineTo(sampleX[i] - sampleNx[i], sampleY[i] - sampleNy[i])
  }
  ctx.closePath()
  ctx.fillStyle = color + alphaHex(alpha)
  ctx.fill()
}

/** Pre-compute active edge IDs from particles. Call once per frame, pass to drawEdges. */
export function getActiveEdgeIds(particles: Particle[]): Set<string> {
  const ids = new Set<string>()
  for (const p of particles) ids.add(p.edgeId)
  return ids
}

export function drawEdges(
  ctx: CanvasRenderingContext2D,
  edges: Edge[],
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
  activeEdgeIds: Set<string>,
  time: number,
  bounds?: ViewBounds,
) {
  for (const edge of edges) {
    const fromAgent = agents.get(edge.from)
    if (!fromAgent || fromAgent.opacity < MIN_VISIBLE_OPACITY) continue

    const target = resolveEdgeTarget(edge, agents, toolCalls, MIN_VISIBLE_OPACITY)
    if (!target) continue
    const toX = target.x, toY = target.y

    const fromX = fromAgent.x, fromY = fromAgent.y
    const hasActiveParticles = activeEdgeIds.has(edge.id)
    const baseAlpha = hasActiveParticles ? BEAM.activeAlpha : BEAM.idleAlpha
    const pulsing = hasActiveParticles ? Math.sin(time * ANIM.pulseSpeed) * 0.1 + 0.9 : 1

    const cp = computeControlPoints(fromX, fromY, toX, toY)
    if (!cp) continue
    const { cp1x, cp1y, cp2x, cp2y } = cp

    // Cull edges whose bezier control polygon is entirely off-screen.
    // Margin covers the widest beam plus glow so partial overlaps still draw.
    if (bounds && !isBezierVisible(fromX, fromY, cp1x, cp1y, cp2x, cp2y, toX, toY, bounds, 16)) continue

    const beamColor = edge.type === 'tool' ? COLORS.tool : COLORS.holoBase
    const bw = edge.type === 'tool' ? BEAM.tool : BEAM.parentChild

    ctx.save()

    // Tapered beam: wider at source, thin at destination
    drawTaperedBezier(ctx, fromX, fromY, cp1x, cp1y, cp2x, cp2y, toX, toY,
      bw.startW, bw.endW, beamColor, baseAlpha * pulsing)

    // Active glow beam (wider, dimmer)
    if (hasActiveParticles) {
      drawTaperedBezier(ctx, fromX, fromY, cp1x, cp1y, cp2x, cp2y, toX, toY,
        bw.startW + BEAM.glowExtra.startW, bw.endW + BEAM.glowExtra.endW, beamColor, BEAM.glowExtra.alpha)
    }

    ctx.restore()
  }
}
