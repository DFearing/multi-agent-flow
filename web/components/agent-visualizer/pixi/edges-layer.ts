/**
 * Edge rendering layer — one MeshRope per edge, driven by precomputed
 * polyline samples from BezierCache.
 *
 * Active edges (those with particles) get brighter tint + higher alpha;
 * idle edges are dimmer. A time-based pulse modulates active-edge alpha
 * to match the Canvas2D path's animation.
 *
 * Follows the same pattern as ParticlesLayer: constructor creates a
 * Container, update() is called once per rAF tick, dispose() tears down.
 */

import { Container, MeshRope, Point, Texture } from 'pixi.js'
import type { Agent, Edge, Particle, ToolCallNode } from '@/lib/agent-types'
import { BEAM, ANIM } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { MIN_VISIBLE_OPACITY } from '@/lib/canvas-constants'
import { getActiveEdgeIds } from '../canvas/draw-edges'
import { BezierCache } from './bezier-cache'

/** Persistent state for a single edge rope. */
interface EdgeEntry {
  rope: MeshRope
  /** The point objects fed to MeshRope — mutated in-place each frame. */
  points: Point[]
  /** Edge id this entry is keyed to. */
  edgeId: string
}

/** Parse a CSS hex color to a numeric tint (e.g. '#66ccff' -> 0x66ccff). */
function parseHexColor(hex: string): number {
  if (hex.startsWith('#')) {
    return parseInt(hex.slice(1, 7), 16)
  }
  return 0xffffff
}

/** Width of the rope texture in pixels. The texture is a 1-pixel-tall white
 *  strip — the rope's visual width is controlled by the texture height and
 *  the `width` option on MeshRope. */
const ROPE_TEXTURE_SIZE = 4

/** Lazily created 1×N white texture for MeshRope. */
let ropeTexture: Texture | null = null

function getRopeTexture(): Texture {
  if (ropeTexture) return ropeTexture
  const canvas = document.createElement('canvas')
  canvas.width = ROPE_TEXTURE_SIZE
  canvas.height = ROPE_TEXTURE_SIZE
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, ROPE_TEXTURE_SIZE, ROPE_TEXTURE_SIZE)
  }
  ropeTexture = Texture.from(canvas)
  return ropeTexture
}

/**
 * Manages the edge rendering layer. Owns a Container that the caller adds
 * to the Pixi stage. Call `update()` each frame with the current simulation
 * state to position and style ropes.
 */
export class EdgesLayer {
  readonly container: Container

  /** Persistent rope entries keyed by edge id. */
  private entries = new Map<string, EdgeEntry>()

  /** Shared bezier cache (same instance the particles layer would use,
   *  but edges-layer owns its own to avoid coupling). */
  private readonly bezierCache: BezierCache

  /** Tint values for tool vs parent-child edges, precomputed once. */
  private readonly toolTint: number
  private readonly parentChildTint: number

  constructor() {
    this.container = new Container()
    this.container.label = 'edges'
    this.bezierCache = new BezierCache()
    this.toolTint = parseHexColor(COLORS.tool)
    this.parentChildTint = parseHexColor(COLORS.holoBase)
  }

  /**
   * Update all edge ropes for the current frame.
   * Called once per rAF tick from pixi-canvas.tsx.
   */
  update(
    edges: Edge[],
    particles: Particle[],
    agents: Map<string, Agent>,
    toolCalls: Map<string, ToolCallNode>,
    time: number,
  ): void {
    const activeEdgeIds = getActiveEdgeIds(particles)

    // Track which edge ids are still alive this frame
    const aliveIds = new Set<string>()

    for (const edge of edges) {
      const fromAgent = agents.get(edge.from)
      if (!fromAgent || fromAgent.opacity < MIN_VISIBLE_OPACITY) continue

      // Resolve edge target
      const toAgent = agents.get(edge.to)
      const toTool = toolCalls.get(edge.to)
      const target = (toAgent && toAgent.opacity >= MIN_VISIBLE_OPACITY)
        ? toAgent
        : (toTool && toTool.opacity >= MIN_VISIBLE_OPACITY)
          ? toTool
          : null
      if (!target) continue

      const polyline = this.bezierCache.get(edge, agents, toolCalls)
      if (!polyline) continue

      aliveIds.add(edge.id)

      const hasActive = activeEdgeIds.has(edge.id)
      const baseAlpha = hasActive ? BEAM.activeAlpha : BEAM.idleAlpha
      const pulsing = hasActive
        ? Math.sin(time * ANIM.pulseSpeed) * 0.1 + 0.9
        : 1
      const tint = edge.type === 'tool' ? this.toolTint : this.parentChildTint
      const beamWidth = edge.type === 'tool' ? BEAM.tool.startW : BEAM.parentChild.startW

      let entry = this.entries.get(edge.id)

      if (!entry) {
        // Create new rope for this edge
        const points = polyline.samples.map(s => new Point(s.x, s.y))
        const rope = new MeshRope({
          texture: getRopeTexture(),
          points,
          width: beamWidth,
        })
        rope.label = `edge-${edge.id}`
        this.container.addChild(rope)
        entry = { rope, points, edgeId: edge.id }
        this.entries.set(edge.id, entry)
      } else {
        // Update existing rope's point positions from the cache
        const samples = polyline.samples
        const pts = entry.points

        // If sample count changed (shouldn't normally), rebuild points array
        if (pts.length !== samples.length) {
          const newPoints = samples.map(s => new Point(s.x, s.y))
          // MeshRope in v8 uses RopeGeometry constructed from the points array.
          // We must replace the rope since the geometry's vertex count is fixed.
          entry.rope.destroy()
          this.container.removeChild(entry.rope)
          const rope = new MeshRope({
            texture: getRopeTexture(),
            points: newPoints,
            width: beamWidth,
          })
          rope.label = `edge-${edge.id}`
          this.container.addChild(rope)
          entry.rope = rope
          entry.points = newPoints
        } else {
          // Mutate point positions in-place — MeshRope auto-updates geometry
          for (let i = 0; i < samples.length; i++) {
            pts[i].x = samples[i].x
            pts[i].y = samples[i].y
          }
        }
      }

      // Style the rope
      entry.rope.tint = tint
      entry.rope.alpha = baseAlpha * pulsing
      entry.rope.visible = true
    }

    // Hide ropes for edges no longer present
    for (const [id, entry] of this.entries) {
      if (!aliveIds.has(id)) {
        entry.rope.visible = false
      }
    }

    // Prune bezier cache entries for edges that no longer exist in the
    // simulation. Use aliveIds (edges that resolved to valid endpoints
    // this frame) rather than all edge ids, mirroring particles-layer.
    this.bezierCache.prune(aliveIds)
  }

  /** Release GPU resources and remove all display objects. */
  dispose(): void {
    this.bezierCache.clear()
    for (const entry of this.entries.values()) {
      entry.rope.destroy()
    }
    this.entries.clear()
    this.container.destroy({ children: true })
  }

  /** Number of active edge entries — useful for tests. */
  get entryCount(): number {
    return this.entries.size
  }

  /** Retrieve a rope entry by edge id — useful for tests. */
  getEntry(edgeId: string): EdgeEntry | undefined {
    return this.entries.get(edgeId)
  }
}
