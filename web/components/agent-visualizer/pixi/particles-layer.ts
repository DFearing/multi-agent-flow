/**
 * Particle rendering layer — sprite-batched via a single Pixi Container.
 *
 * Each particle's trail segments, glow, core, and highlight are represented as
 * Sprites sharing a small set of textures (circle + glow). The container is
 * rendered in one draw call thanks to Pixi v8's automatic sprite batching.
 *
 * Trail segments use additive blending (BLEND_MODES.ADD) for the glow effect.
 */

import { Container, Sprite, Texture, Color } from 'pixi.js'
import type { Particle, Agent, ToolCallNode, Edge } from '@/lib/agent-types'
import { BEAM, FX } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { PARTICLE_DRAW } from '@/lib/canvas-constants'
import { getGlowTexture, getCircleTexture } from './pixi-app'
import type { BezierSample } from './bezier-cache'
import { sharedBezierCache, samplePolyline } from './bezier-cache'

/** Pre-parsed tint for the highlight (center bright spot) — same value
 *  for every particle, parsed once at module load instead of per-particle
 *  per-frame. */
const HOLO_HOT_TINT = parseHexColorAtModuleScope(COLORS.holoHot)

/** Module-scope hex parser used only for HOLO_HOT_TINT. The class instance
 *  has its own (identical) implementation that doubles as the cache writer. */
function parseHexColorAtModuleScope(hex: string): number {
  if (hex.startsWith('#')) {
    return parseInt(hex.slice(1, 7), 16)
  }
  return 0xffffff
}

/** Pool of sprites to avoid allocation churn. Each frame we show/hide as needed. */
interface SpriteEntry {
  sprite: Sprite
  active: boolean
}

/**
 * Manages the particle rendering layer. Owns a Container that the caller adds
 * to the Pixi stage. Call `update()` each frame with the current simulation
 * state to position and tint sprites.
 */
export class ParticlesLayer {
  readonly container: Container
  private pool: SpriteEntry[] = []
  private poolIndex = 0
  private readonly circleTexture: Texture
  private readonly glowRadius = PARTICLE_DRAW.glowRadius

  /** Color object reused every frame to avoid allocation. */
  private readonly tmpColor = new Color()

  /** Scratch BezierSample reused across all samplePolyline() calls each
   *  frame. Each call's result is read before the next call overwrites it. */
  private readonly tmpSample: BezierSample = { x: 0, y: 0, nx: 0, ny: 0 }

  constructor() {
    this.container = new Container()
    this.container.label = 'particles'
    // Pre-create a circle texture at a reasonable base size.
    // Sprites scale from this.
    this.circleTexture = getCircleTexture(8)
  }

  /**
   * Update all particle sprites for the current frame.
   * This is the hot path — called every rAF tick.
   */
  update(
    particles: Particle[],
    edges: Edge[],
    agents: Map<string, Agent>,
    toolCalls: Map<string, ToolCallNode>,
    time: number,
  ): void {
    // Reset pool cursor — we'll reuse sprites from index 0
    this.poolIndex = 0

    // Build edge map for lookup
    const edgeMap = new Map<string, Edge>()
    for (const e of edges) edgeMap.set(e.id, e)

    // Bezier-cache pruning is owned exclusively by EdgesLayer, which sees the
    // full set of alive edges every frame. Pruning here would evict polylines
    // for idle edges (those without active particles) that EdgesLayer just
    // populated, undoing the IR-1 caching win. ParticlesLayer is a pure
    // consumer — it only `get()`s.

    for (const particle of particles) {
      const edge = edgeMap.get(particle.edgeId)
      if (!edge) continue

      const polyline = sharedBezierCache.get(edge, agents, toolCalls)
      if (!polyline) continue

      // IR-4: cache the parsed numeric tint on the particle itself. The hex
      // string is immutable for the particle's lifetime, so this is a one-time
      // parse per particle (instead of 4+ parses per particle per frame).
      if (particle._tint === undefined) {
        particle._tint = this.parseColor(particle.color)
      }
      const particleTint = particle._tint

      const t = particle.progress
      const isReturn = particle.type === 'return' || particle.type === 'tool_return'

      // Phase offset for wobble — deterministic per particle
      const phase = (particle.id.charCodeAt(5) || 0) * 0.7

      // Current position (with wobble)
      const wobbleAmt = Math.sin(t * BEAM.wobble.freq + time * BEAM.wobble.timeFreq + phase) *
        BEAM.wobble.amp * Math.sin(t * Math.PI)
      const baseSample = samplePolyline(polyline, t, this.tmpSample)
      const px = baseSample.x + baseSample.nx * wobbleAmt
      const py = baseSample.y + baseSample.ny * wobbleAmt

      // ─── Trail segments (drawn back-to-front for correct blending) ───
      for (let i = FX.trailSegments; i >= 0; i--) {
        const offset = (i / FX.trailSegments) * BEAM.wobble.trailOffset
        const tt = isReturn
          ? Math.min(1, t + offset)
          : Math.max(0, t - offset)
        const wob = Math.sin(tt * BEAM.wobble.freq + time * BEAM.wobble.timeFreq + phase) *
          BEAM.wobble.amp * Math.sin(tt * Math.PI)
        const sample = samplePolyline(polyline, tt, this.tmpSample)
        const tx = sample.x + sample.nx * wob
        const ty = sample.y + sample.ny * wob

        const alpha = ((FX.trailSegments - i) / FX.trailSegments) * 0.6
        const scale = particle.size * ((FX.trailSegments - i) / FX.trailSegments)

        const sprite = this.acquireSprite(this.circleTexture)
        sprite.x = tx
        sprite.y = ty
        sprite.anchor.set(0.5)
        // Scale relative to the 8px radius circle texture
        const s = scale / 8
        sprite.scale.set(s)
        sprite.tint = particleTint
        sprite.alpha = alpha
        sprite.blendMode = 'normal'
      }

      // ─── Glow sprite (additive blend) ────────────────────────────────
      const glowTexture = getGlowTexture(particle.color, this.glowRadius, 0x60, 0x00)
      const glowSprite = this.acquireSprite(glowTexture)
      glowSprite.x = px
      glowSprite.y = py
      glowSprite.anchor.set(0.5)
      glowSprite.scale.set(1)
      glowSprite.alpha = 1
      glowSprite.blendMode = 'add'

      // ─── Core ────────────────────────────────────────────────────────
      const core = this.acquireSprite(this.circleTexture)
      core.x = px
      core.y = py
      core.anchor.set(0.5)
      core.scale.set(particle.size / 8)
      core.tint = particleTint
      core.alpha = 1
      core.blendMode = 'normal'

      // ─── Highlight (center bright spot) ──────────────────────────────
      const highlight = this.acquireSprite(this.circleTexture)
      highlight.x = px
      highlight.y = py
      highlight.anchor.set(0.5)
      highlight.scale.set((particle.size * PARTICLE_DRAW.coreHighlightScale) / 8)
      highlight.tint = HOLO_HOT_TINT
      highlight.alpha = 0.5 // matches the '80' hex alpha from Canvas2D path
      highlight.blendMode = 'normal'
    }

    // Hide any leftover sprites from previous frame
    this.hideUnused()
  }

  /** Release GPU resources.
   *  The shared bezier cache is intentionally NOT cleared here — edges-layer
   *  may still depend on it, and the singleton survives mount/remount cycles. */
  destroy(): void {
    for (const entry of this.pool) {
      entry.sprite.destroy()
    }
    this.pool.length = 0
    this.container.destroy({ children: true })
  }

  // ─── Sprite pool management ─────────────────────────────────────────────

  private acquireSprite(texture: Texture): Sprite {
    if (this.poolIndex < this.pool.length) {
      const entry = this.pool[this.poolIndex]
      entry.sprite.texture = texture
      entry.sprite.visible = true
      entry.active = true
      this.poolIndex++
      return entry.sprite
    }

    // Grow pool
    const sprite = new Sprite(texture)
    this.container.addChild(sprite)
    this.pool.push({ sprite, active: true })
    this.poolIndex++
    return sprite
  }

  private hideUnused(): void {
    for (let i = this.poolIndex; i < this.pool.length; i++) {
      if (this.pool[i].sprite.visible) {
        this.pool[i].sprite.visible = false
        this.pool[i].active = false
      }
    }
  }

  // ─── Color parsing ──────────────────────────────────────────────────────

  /** Parse a CSS hex color string to a numeric tint value.
   *  Pixi v8 tint accepts number | string | Color, but using a number
   *  avoids per-frame string parsing in the batch renderer. */
  private parseColor(hex: string): number {
    // Strip '#' and parse as integer
    if (hex.startsWith('#')) {
      return parseInt(hex.slice(1, 7), 16)
    }
    // Fallback: let Pixi parse it (slower path)
    this.tmpColor.value = hex
    return this.tmpColor.toNumber()
  }
}
