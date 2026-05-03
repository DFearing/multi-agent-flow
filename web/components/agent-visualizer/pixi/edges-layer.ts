/**
 * Edge rendering layer — one custom strip Mesh per edge, driven by precomputed
 * polyline samples from BezierCache.
 *
 * Each mesh is a triangle strip whose vertices are placed ±beamWidth/2 along
 * the curve normal at every sample point. This restores the per-edge-type
 * width that the previous MeshRope path silently overrode (MeshRope's `width`
 * option is geometry-only — Pixi v8's renderer ignores it once the mesh is
 * batched, so all edges rendered at the texture's native height).
 *
 * Active edges (those with particles) get brighter tint + higher alpha;
 * idle edges are dimmer. A time-based pulse modulates active-edge alpha
 * to match the Canvas2D path's animation. All edges share a single 1×1
 * white texture and tint per mesh — preserves Pixi's auto-batching.
 *
 * Follows the same pattern as ParticlesLayer: constructor creates a
 * Container, update() is called once per rAF tick, dispose() tears down.
 */

import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js'
import type { Agent, Edge, Particle, ToolCallNode } from '@/lib/agent-types'
import { BEAM, ANIM } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { MIN_VISIBLE_OPACITY } from '@/lib/canvas-constants'
import { getActiveEdgeIds } from '../canvas/draw-edges'
import { sharedBezierCache } from './bezier-cache'

/** Persistent state for a single edge mesh. */
interface EdgeEntry {
  /** Strip mesh — two vertices per polyline sample (top/bottom of strip). */
  mesh: Mesh<MeshGeometry>
  /** Reference to the geometry's positions array — mutated in-place each frame. */
  positions: Float32Array
  /** Beam width this entry was built for. If the edge type changes, the
   *  geometry is rebuilt to match. (In practice edge.type is immutable.) */
  beamWidth: number
  /** Number of samples (sample count along the polyline). */
  sampleCount: number
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

/** Lazily created 1×1 white texture shared by every edge mesh. The mesh's
 *  geometry encodes width directly; the texture is just a colourable surface
 *  for the strip. Sharing one texture across all meshes keeps batching viable. */
let ropeTexture: Texture | null = null

function getRopeTexture(): Texture {
  if (ropeTexture) return ropeTexture
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1, 1)
  }
  ropeTexture = Texture.from(canvas)
  return ropeTexture
}

/**
 * Build the strip geometry for a polyline of length `sampleCount`. Positions
 * are zero-initialised (the caller fills them on the same frame). Indices and
 * UVs are static — they depend only on `sampleCount`, not the actual sample
 * coordinates, so they're built once and never touched again.
 *
 * Layout: each sample contributes two vertices (top/bottom of the strip).
 * Vertex order: [s0_top, s0_bot, s1_top, s1_bot, …]. Two triangles per quad.
 */
function buildStripGeometry(sampleCount: number): MeshGeometry {
  const vertexCount = sampleCount * 2
  const positions = new Float32Array(vertexCount * 2) // x, y per vertex
  const uvs = new Float32Array(vertexCount * 2)
  const quadCount = sampleCount - 1
  const indices = new Uint32Array(quadCount * 6)

  // UVs: u alternates 0/1 across the strip width, v progresses along its length.
  // Texture is 1×1 so values are visually irrelevant, but Pixi requires the
  // attribute to exist and be sized correctly.
  for (let i = 0; i < sampleCount; i++) {
    const v = i / Math.max(1, sampleCount - 1)
    uvs[i * 4 + 0] = 0  // top u
    uvs[i * 4 + 1] = v  // top v
    uvs[i * 4 + 2] = 1  // bot u
    uvs[i * 4 + 3] = v  // bot v
  }

  // Indices: quad i is samples[i] and samples[i+1].
  // Vertex offsets: top[i] = 2i, bot[i] = 2i+1.
  for (let i = 0; i < quadCount; i++) {
    const t0 = i * 2
    const b0 = i * 2 + 1
    const t1 = i * 2 + 2
    const b1 = i * 2 + 3
    const o = i * 6
    indices[o + 0] = t0
    indices[o + 1] = b0
    indices[o + 2] = t1
    indices[o + 3] = b0
    indices[o + 4] = b1
    indices[o + 5] = t1
  }

  return new MeshGeometry({
    positions,
    uvs,
    indices,
    topology: 'triangle-list',
  })
}

/** Canonical disposal path for an edge mesh entry. Removes from the parent
 *  container BEFORE destroying — Pixi convention is remove-then-destroy so
 *  the parent's child list never holds a reference to a destroyed object.
 *  Geometry is per-edge so we own it and free its buffers; the texture is
 *  module-shared so we never free it. */
function destroyEntryMesh(parent: Container, entry: EdgeEntry): void {
  parent.removeChild(entry.mesh)
  // Geometry first — destroyBuffers=true releases the underlying GPU buffers.
  // Mesh.destroy() does not cascade into geometry, so this must be explicit.
  entry.mesh.geometry.destroy(true)
  entry.mesh.destroy({ children: true, texture: false })
}

/**
 * Manages the edge rendering layer. Owns a Container that the caller adds
 * to the Pixi stage. Call `update()` each frame with the current simulation
 * state to position and style meshes.
 */
export class EdgesLayer {
  readonly container: Container

  /** Persistent mesh entries keyed by edge id. */
  private entries = new Map<string, EdgeEntry>()

  /** Tint values for tool vs parent-child edges, precomputed once. */
  private readonly toolTint: number
  private readonly parentChildTint: number

  constructor() {
    this.container = new Container()
    this.container.label = 'edges'
    this.toolTint = parseHexColor(COLORS.tool)
    this.parentChildTint = parseHexColor(COLORS.holoBase)
  }

  /**
   * Update all edge meshes for the current frame.
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

      const polyline = sharedBezierCache.get(edge, agents, toolCalls)
      if (!polyline) continue

      aliveIds.add(edge.id)

      const hasActive = activeEdgeIds.has(edge.id)
      const baseAlpha = hasActive ? BEAM.activeAlpha : BEAM.idleAlpha
      const pulsing = hasActive
        ? Math.sin(time * ANIM.pulseSpeed) * 0.1 + 0.9
        : 1
      const tint = edge.type === 'tool' ? this.toolTint : this.parentChildTint
      const beamWidth = edge.type === 'tool' ? BEAM.tool.startW : BEAM.parentChild.startW

      const samples = polyline.samples
      const sampleCount = samples.length

      let entry = this.entries.get(edge.id)

      // Rebuild from scratch if missing OR if sample count / width changed
      // (edge.type doesn't change in practice, but guard anyway).
      if (!entry || entry.sampleCount !== sampleCount || entry.beamWidth !== beamWidth) {
        if (entry) {
          destroyEntryMesh(this.container, entry)
        }
        const geometry = buildStripGeometry(sampleCount)
        const mesh = new Mesh<MeshGeometry>({
          geometry,
          texture: getRopeTexture(),
        })
        mesh.label = `edge-${edge.id}`
        this.container.addChild(mesh)
        entry = {
          mesh,
          positions: geometry.positions,
          beamWidth,
          sampleCount,
          edgeId: edge.id,
        }
        this.entries.set(edge.id, entry)
      }

      // Mutate vertex positions in place: ±halfWidth along the sample normal.
      const positions = entry.positions
      const halfW = beamWidth / 2
      for (let i = 0; i < sampleCount; i++) {
        const s = samples[i]
        const ox = s.nx * halfW
        const oy = s.ny * halfW
        const o = i * 4 // 2 vertices per sample, 2 floats per vertex
        positions[o + 0] = s.x + ox  // top.x
        positions[o + 1] = s.y + oy  // top.y
        positions[o + 2] = s.x - ox  // bottom.x
        positions[o + 3] = s.y - oy  // bottom.y
      }
      // Flag the GPU buffer as dirty so the upload happens this frame.
      entry.mesh.geometry.getBuffer('aPosition').update()

      // Style the mesh
      entry.mesh.tint = tint
      entry.mesh.alpha = baseAlpha * pulsing
      entry.mesh.visible = true
    }

    // Drop entries for edges no longer present. Keeping them around forever
    // (the previous "hide" behaviour) leaked GPU buffers across long sessions.
    for (const [id, entry] of this.entries) {
      if (!aliveIds.has(id)) {
        destroyEntryMesh(this.container, entry)
        this.entries.delete(id)
      }
    }

    // Prune bezier cache entries for edges that no longer exist in the
    // simulation. Use aliveIds (edges that resolved to valid endpoints
    // this frame) rather than all edge ids, mirroring particles-layer.
    sharedBezierCache.prune(aliveIds)
  }

  /** Release GPU resources and remove all display objects.
   *  The shared bezier cache is intentionally NOT cleared here — particles-layer
   *  may still depend on it, and the singleton survives mount/remount cycles. */
  dispose(): void {
    for (const entry of this.entries.values()) {
      // Each entry is removed from the container and destroyed (geometry +
      // mesh). After this loop the container is empty, so destroying it does
      // not need to cascade into children — `destroy({children:true})` would
      // otherwise re-destroy the same meshes (currently safe only because
      // Pixi v8 destroy() is idempotent — fragile to rely on).
      destroyEntryMesh(this.container, entry)
    }
    this.entries.clear()
    this.container.destroy()
  }

  /** Number of active edge entries — useful for tests. */
  get entryCount(): number {
    return this.entries.size
  }

  /** Retrieve a mesh entry by edge id — useful for tests. */
  getEntry(edgeId: string): EdgeEntry | undefined {
    return this.entries.get(edgeId)
  }
}
