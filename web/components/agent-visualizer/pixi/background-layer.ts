/**
 * Background rendering layer -- depth particles + hex grid.
 *
 * Depth particles: a Container of small circle sprites whose positions
 * are updated in a typed-array batch per frame. Parallax drift gives
 * a sense of depth.
 *
 * Hex grid: drawn via a single Graphics object with batched path calls
 * (alpha-bucketed, same strategy as the Canvas2D version) to minimise
 * draw calls. A procedural GLSL shader would be ideal but is overkill
 * for v1 -- the Graphics approach is already one draw call per alpha
 * bucket (~4 total).
 *
 * The activeAgentPos highlight is rendered as an additive glow sprite
 * positioned under the most-active agent.
 *
 * Follows the same layer pattern: constructor, update(), dispose().
 */

import { Container, Sprite, Graphics } from 'pixi.js'
import type { DepthParticle } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { getCircleTexture, getGlowTexture } from './pixi-app'

// ── Constants (mirrored from background-layer.ts) ───────────────────────

const NUM_PARTICLES = 80
const HEX_GRID_SIZE = 60

/** Parse a CSS hex color to a numeric tint. */
function parseColor(hex: string): number {
  if (hex.startsWith('#')) return parseInt(hex.slice(1, 7), 16)
  return 0xffffff
}

// Pre-computed hex vertex offsets (avoids trig per vertex per frame)
const HEX_OFFSETS = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 3) * i - Math.PI / 2
  return { cos: Math.cos(angle), sin: Math.sin(angle) }
})

const HOLO_TINT = parseColor(COLORS.holoBase)
const HEX_GRID_TINT = parseColor(COLORS.hexGrid)

/**
 * Manages the background rendering layer. Contains depth particles,
 * an optional hex grid, and an active-agent highlight glow.
 */
export class BackgroundLayer {
  readonly container: Container

  /** Depth particle sprites. */
  private particleContainer: Container
  private particleSprites: Sprite[] = []
  private depthParticles: DepthParticle[] = []
  private readonly particleTexture = getCircleTexture(2)

  /** Hex grid graphics (one object, alpha-bucketed paths). */
  private hexGrid: Graphics

  /** Active-agent glow sprite. */
  private glowSprite: Sprite

  /** Frame counter for lower-cadence ticks. */
  private frameCount = 0

  /** Whether particles have been initialised. */
  private initialised = false

  constructor() {
    this.container = new Container()
    this.container.label = 'background'

    // Hex grid (drawn behind particles)
    this.hexGrid = new Graphics()
    this.hexGrid.label = 'hex-grid'
    this.container.addChild(this.hexGrid)

    // Particle container
    this.particleContainer = new Container()
    this.particleContainer.label = 'depth-particles'
    this.container.addChild(this.particleContainer)

    // Active-agent glow
    const glowTex = getGlowTexture(COLORS.holoBase, 150, 0x10, 0x00)
    this.glowSprite = new Sprite(glowTex)
    this.glowSprite.anchor.set(0.5)
    this.glowSprite.label = 'active-glow'
    this.glowSprite.visible = false
    this.glowSprite.blendMode = 'add'
    this.container.addChild(this.glowSprite)
  }

  /**
   * Update the background for the current frame.
   *
   * @param width   Canvas width in CSS pixels.
   * @param height  Canvas height in CSS pixels.
   * @param transform  Camera transform { x, y, scale }.
   * @param dt      Delta time in seconds.
   * @param time    Elapsed time in seconds.
   * @param showHexGrid  Whether to render the hex grid.
   * @param activeAgentPos  Position + color of the most-active agent (optional).
   */
  update(
    width: number,
    height: number,
    transform: { x: number; y: number; scale: number },
    dt: number,
    time: number,
    showHexGrid: boolean,
    activeAgentPos?: { x: number; y: number; color: string },
    showDepthParticles: boolean = true,
  ): void {
    this.frameCount++

    // ── Initialise particles on first call ────────────────────────────
    if (!this.initialised) {
      this.initParticles(width, height)
      this.initialised = true
    }

    // ── Update depth particles (every other frame for perf) ──────────
    this.particleContainer.visible = showDepthParticles
    if (showDepthParticles && this.frameCount % 2 === 0) {
      this.updateParticles(dt * 2, width, height, transform)
    }

    // ── Hex grid ─────────────────────────────────────────────────────
    this.hexGrid.visible = showHexGrid
    if (showHexGrid && this.frameCount % 2 === 0) {
      this.drawHexGrid(width, height, transform, time)
    }

    // ── Active-agent glow ────────────────────────────────────────────
    if (activeAgentPos) {
      this.glowSprite.visible = true
      this.glowSprite.x = activeAgentPos.x
      this.glowSprite.y = activeAgentPos.y
      this.glowSprite.tint = parseColor(activeAgentPos.color)
    } else {
      this.glowSprite.visible = false
    }
  }

  /** Release GPU resources and remove all display objects. */
  dispose(): void {
    this.depthParticles.length = 0
    this.particleSprites.length = 0
    this.hexGrid.destroy()
    this.glowSprite.destroy()
    this.particleContainer.destroy({ children: true })
    this.container.destroy({ children: true })
  }

  /** Number of depth particles -- useful for tests. */
  get particleCount(): number {
    return this.depthParticles.length
  }

  /** Whether hex grid is currently visible -- useful for tests. */
  get hexGridVisible(): boolean {
    return this.hexGrid.visible
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private initParticles(width: number, height: number): void {
    for (let i = 0; i < NUM_PARTICLES; i++) {
      const dp: DepthParticle = {
        x: Math.random() * width * 2 - width * 0.5,
        y: Math.random() * height * 2 - height * 0.5,
        size: Math.random() * 1.5 + 0.5,
        brightness: Math.random() * 0.3 + 0.05,
        speed: Math.random() * 0.15 + 0.05,
        depth: Math.random(),
      }
      this.depthParticles.push(dp)

      const sprite = new Sprite(this.particleTexture)
      sprite.anchor.set(0.5)
      sprite.tint = HOLO_TINT
      this.particleContainer.addChild(sprite)
      this.particleSprites.push(sprite)
    }
  }

  private updateParticles(
    dt: number,
    width: number,
    height: number,
    transform: { x: number; y: number },
  ): void {
    for (let i = 0; i < this.depthParticles.length; i++) {
      const p = this.depthParticles[i]

      // Drift (matches Canvas2D updateDepthParticles)
      p.x += p.speed * dt * 10 * (1 - p.depth * 0.5)
      p.y -= p.speed * dt * 5 * (1 - p.depth * 0.3)

      // Wrap around
      if (p.x > width * 1.5) p.x = -width * 0.5
      if (p.y < -height * 0.5) p.y = height * 1.5

      // Parallax (matches Canvas2D drawBackground)
      const parallaxFactor = 0.3 + p.depth * 0.7
      const sprite = this.particleSprites[i]
      sprite.x = p.x + transform.x * parallaxFactor * 0.1
      sprite.y = p.y + transform.y * parallaxFactor * 0.1

      const size = p.size * (0.5 + p.depth * 0.5)
      const scale = size / 2 // texture radius is 2
      sprite.scale.set(scale)
      sprite.alpha = p.brightness * (0.5 + p.depth * 0.5)
    }
  }

  private drawHexGrid(
    width: number,
    height: number,
    transform: { x: number; y: number; scale: number },
    time: number,
  ): void {
    this.hexGrid.clear()

    // The hex grid is drawn in world space, so we need to account for the
    // camera transform. We draw it as a child of the world container, so
    // the camera transform is already applied. We just need to compute
    // which hexagons are visible.
    const size = HEX_GRID_SIZE
    const hexHeight = size * Math.sqrt(3)
    const r = size * 0.4

    const startX = Math.floor(-transform.x / transform.scale / (size * 1.5)) * (size * 1.5) - size * 3
    const startY = Math.floor(-transform.y / transform.scale / hexHeight) * hexHeight - hexHeight * 2
    const endX = startX + width / transform.scale + size * 6
    const endY = startY + height / transform.scale + hexHeight * 4

    // Alpha-bucketed drawing (same strategy as Canvas2D)
    const timeSin = time * 0.5
    const buckets = new Map<number, number[]>()

    for (let x = startX; x < endX; x += size * 1.5) {
      for (let y = startY; y < endY; y += hexHeight) {
        const offsetY = ((x - startX) / (size * 1.5)) % 2 === 0 ? 0 : hexHeight / 2
        const cx = x
        const cy = y + offsetY
        const dist = Math.sqrt(cx * cx + cy * cy)
        const pulse = Math.sin(timeSin + dist * 0.005) * 0.3 + 0.7
        const alpha = Math.round(0.15 * pulse * 40) / 40

        let bucket = buckets.get(alpha)
        if (!bucket) { bucket = []; buckets.set(alpha, bucket) }
        bucket.push(cx, cy)
      }
    }

    for (const [alpha, coords] of buckets) {
      if (coords.length === 0) continue

      for (let i = 0; i < coords.length; i += 2) {
        const cx = coords[i]
        const cy = coords[i + 1]

        this.hexGrid.moveTo(
          cx + r * HEX_OFFSETS[0].cos,
          cy + r * HEX_OFFSETS[0].sin,
        )
        for (let v = 1; v < 6; v++) {
          this.hexGrid.lineTo(
            cx + r * HEX_OFFSETS[v].cos,
            cy + r * HEX_OFFSETS[v].sin,
          )
        }
        this.hexGrid.closePath()
      }

      this.hexGrid.stroke({
        width: 0.5,
        color: HEX_GRID_TINT,
        alpha,
      })
    }
  }
}
