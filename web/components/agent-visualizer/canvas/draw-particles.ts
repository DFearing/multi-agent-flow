import { Agent, ToolCallNode, Particle, Edge, BEAM, FX } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { PARTICLE_DRAW } from '@/lib/canvas-constants'
import { alphaHex } from '@/lib/utils'
import { bezierPoint, resolveEdgeTarget, computeControlPoints } from './draw-edges'
import { getGlowSprite } from './render-cache'

/** Pre-build edge lookup map. Call once per frame, pass to drawParticles. */
export function buildEdgeMap(edges: Edge[]): Map<string, Edge> {
  const map = new Map<string, Edge>()
  for (const e of edges) map.set(e.id, e)
  return map
}

/** Per-color cached trail-segment color strings. The trail draws a fixed
 *  number of segments (FX.trailSegments) at deterministic alphas, so we can
 *  precompute the full color+alpha string once per color and skip the
 *  per-segment alphaHex() call and string concat that used to run for every
 *  particle, every frame. */
const TRAIL_COLORS_CACHE = new Map<string, readonly string[]>()
function getTrailColors(color: string): readonly string[] {
  const cached = TRAIL_COLORS_CACHE.get(color)
  if (cached) return cached
  const arr: string[] = new Array(FX.trailSegments + 1)
  for (let i = 0; i <= FX.trailSegments; i++) {
    const alpha = ((FX.trailSegments - i) / FX.trailSegments) * 0.6
    arr[i] = color + alphaHex(alpha)
  }
  TRAIL_COLORS_CACHE.set(color, arr)
  return arr
}

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  edgeMap: Map<string, Edge>,
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
  time: number,
) {
  for (const particle of particles) {
    const edge = edgeMap.get(particle.edgeId)
    if (!edge) continue

    const fromAgent = agents.get(edge.from)
    if (!fromAgent) continue

    const target = resolveEdgeTarget(edge, agents, toolCalls)
    if (!target) continue
    const toX = target.x, toY = target.y

    const fromX = fromAgent.x, fromY = fromAgent.y
    const cp = computeControlPoints(fromX, fromY, toX, toY)
    if (!cp) continue
    const { cp1x, cp1y, cp2x, cp2y, dx, dy, dist } = cp

    const t = particle.progress

    // Wobble: perpendicular displacement
    const tangentX = dx / dist
    const tangentY = dy / dist
    const normalX = -tangentY
    const normalY = tangentX
    // Use particle id hash for phase offset
    const phase = (particle.id.charCodeAt(5) || 0) * 0.7
    const wobbleAmt = Math.sin(t * BEAM.wobble.freq + time * BEAM.wobble.timeFreq + phase) * BEAM.wobble.amp * Math.sin(t * Math.PI)

    const baseX = bezierPoint(t, fromX, cp1x, cp2x, toX)
    const baseY = bezierPoint(t, fromY, cp1y, cp2y, toY)
    const px = baseX + normalX * wobbleAmt
    const py = baseY + normalY * wobbleAmt

    // Comet trail — flip direction for return particles (progress goes 1→0).
    // No save/restore needed: the outer canvas.tsx wraps the entire draw pass
    // in save/restore, and every fillStyle/font/textAlign below is set
    // explicitly before its first use in each iteration.
    const isReturn = particle.type === 'return' || particle.type === 'tool_return'
    const trailColors = getTrailColors(particle.color)
    for (let i = FX.trailSegments; i >= 0; i--) {
      const offset = (i / FX.trailSegments) * BEAM.wobble.trailOffset
      const tt = isReturn
        ? Math.min(1, t + offset)
        : Math.max(0, t - offset)
      const wob = Math.sin(tt * BEAM.wobble.freq + time * BEAM.wobble.timeFreq + phase) * BEAM.wobble.amp * Math.sin(tt * Math.PI)
      const tx = bezierPoint(tt, fromX, cp1x, cp2x, toX) + normalX * wob
      const ty = bezierPoint(tt, fromY, cp1y, cp2y, toY) + normalY * wob
      ctx.beginPath()
      ctx.fillStyle = trailColors[i]
      ctx.arc(tx, ty, particle.size * ((FX.trailSegments - i) / FX.trailSegments), 0, Math.PI * 2)
      ctx.fill()
    }

    // Glow (pre-rendered sprite instead of per-frame gradient)
    const glowR = PARTICLE_DRAW.glowRadius
    const glowSprite = getGlowSprite(particle.color, glowR, '60', '00')
    ctx.drawImage(glowSprite, px - glowR, py - glowR)

    // Particle core
    ctx.beginPath()
    ctx.fillStyle = particle.color
    ctx.arc(px, py, particle.size, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.fillStyle = COLORS.holoHot + '80'
    ctx.arc(px, py, particle.size * PARTICLE_DRAW.coreHighlightScale, 0, Math.PI * 2)
    ctx.fill()

    // Label near particle
    if (particle.label && t > PARTICLE_DRAW.labelMinT && t < PARTICLE_DRAW.labelMaxT) {
      ctx.fillStyle = particle.color + 'aa'
      ctx.font = `${PARTICLE_DRAW.labelFontSize}px monospace`
      ctx.textAlign = 'center'
      ctx.fillText(particle.label, px, py + PARTICLE_DRAW.labelYOffset)
    }
  }
}
