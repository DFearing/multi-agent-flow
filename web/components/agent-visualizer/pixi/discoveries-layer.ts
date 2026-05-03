/**
 * Discovery rendering layer -- sprite-based via persistent Pixi Containers.
 *
 * Each discovery gets a Container holding:
 *   - A rounded-rect background card (Graphics).
 *   - A type-colored left accent bar (Graphics).
 *   - A label sprite from the glyph atlas.
 *   - Content line sprites from the glyph atlas.
 *   - A selection glow (Graphics).
 *
 * Connection lines between agents and discoveries are drawn as dashed
 * Graphics lines in a separate child container.
 *
 * Follows the same pattern as AgentsLayer / ToolCallsLayer.
 */

import { Container, Sprite, Graphics } from 'pixi.js'
import type { Agent, Discovery } from '@/lib/agent-types'
import { COLORS, getDiscoveryTypeColor } from '@/lib/colors'
import { getDiscoveryCardDimensions } from '@/lib/canvas-constants'
import { GlyphAtlas } from './glyph-atlas'

/** Persistent state for one discovery's display objects. */
interface DiscoveryEntry {
  container: Container
  background: Graphics
  accentBar: Graphics
  selectionGlow: Graphics
  labelSprite: Sprite | null
  contentSprites: Sprite[]
  lastLabelText: string
  lastLabelColor: string
  lastContentKey: string
  /** Cache key for background + accent-bar Graphics commands. Both share
   *  the same dependency set (cardW, cardH, typeColor, isSelected) so they
   *  rebuild together. (IR-6) */
  lastBgKey: string
  discoveryId: string
}

/** Parse a CSS hex color string to a numeric tint value. */
function parseColor(hex: string): number {
  if (hex.startsWith('#')) {
    return parseInt(hex.slice(1, 7), 16)
  }
  return 0xffffff
}

/** Pre-parsed tint for connection lines — the same color string is used
 *  for every discovery, so parsing once at module load is strictly cheaper
 *  than parsing per-frame. */
const HOLO_BASE_TINT = parseColor(COLORS.holoBase)

/**
 * Module-scope reusable bucket map for IR-5 alpha-bucketed connection-line
 * drawing. Keyed by quantized alpha (Math.round(alpha * 20) / 20). Each value
 * is a flat array of [ax, ay, dx, dy, …] coordinates. Reused across frames:
 * we clear each value's length to 0 instead of allocating a fresh Map.
 */
const CONNECTION_BUCKETS = new Map<number, number[]>()

/**
 * Manages the discovery rendering layer. Owns a Container that the caller
 * adds to the Pixi stage. Call `update()` each frame with the current
 * simulation state to position and style discovery sprites.
 */
export class DiscoveriesLayer {
  readonly container: Container
  private entries = new Map<string, DiscoveryEntry>()
  private readonly glyphAtlas: GlyphAtlas
  /** Graphics object for connection lines (dashed lines agent -> discovery). */
  private readonly connectionLines: Graphics

  constructor() {
    this.container = new Container()
    this.container.label = 'discoveries'
    this.glyphAtlas = new GlyphAtlas()
    this.connectionLines = new Graphics()
    this.connectionLines.label = 'discovery-connections'
    this.container.addChild(this.connectionLines)
  }

  /**
   * Update all discovery display objects for the current frame.
   * Called once per rAF tick from pixi-canvas.tsx.
   */
  update(
    discoveries: Discovery[],
    agents: Map<string, Agent>,
    selectedDiscoveryId?: string | null,
  ): void {
    const aliveIds = new Set<string>()

    // ── Connection lines ────────────────────────────────────────────────
    // IR-5: bucket by quantized alpha so each unique alpha emits one
    // moveTo+lineTo+stroke draw call instead of N. Discoveries' opacity is
    // continuous, but quantizing the resulting alpha to 1/20 increments
    // collapses ~all per-frame variation into a handful of buckets.
    this.connectionLines.clear()

    // Reset existing bucket arrays in place (no Map allocation per frame).
    for (const arr of CONNECTION_BUCKETS.values()) arr.length = 0

    for (const disc of discoveries) {
      const agent = agents.get(disc.agentId)
      if (!agent || disc.opacity < 0.1) continue

      const alphaBucket = Math.round(disc.opacity * 0.09 * 20) / 20
      let arr = CONNECTION_BUCKETS.get(alphaBucket)
      if (!arr) {
        arr = []
        CONNECTION_BUCKETS.set(alphaBucket, arr)
      }
      arr.push(agent.x, agent.y, disc.x, disc.y)
    }

    for (const [alpha, coords] of CONNECTION_BUCKETS) {
      if (coords.length === 0) continue
      for (let i = 0; i < coords.length; i += 4) {
        this.connectionLines.moveTo(coords[i], coords[i + 1])
        this.connectionLines.lineTo(coords[i + 2], coords[i + 3])
      }
      this.connectionLines.stroke({
        width: 0.5,
        color: HOLO_BASE_TINT,
        alpha,
      })
    }

    // ── Discovery cards ─────────────────────────────────────────────────
    for (const disc of discoveries) {
      if (disc.opacity < 0.05) continue

      aliveIds.add(disc.id)

      let entry = this.entries.get(disc.id)
      if (!entry) {
        entry = this.createEntry(disc.id)
        this.entries.set(disc.id, entry)
      }

      const isSelected = disc.id === selectedDiscoveryId
      const lines = disc.content.split('\n')
      const { cardW, cardH } = getDiscoveryCardDimensions(disc.label, lines)
      const typeColor = getDiscoveryTypeColor(disc.type)
      const typeTint = parseColor(typeColor)

      // ── Position ──────────────────────────────────────────────────
      entry.container.x = disc.x
      entry.container.y = disc.y
      entry.container.alpha = disc.opacity
      entry.container.visible = disc.opacity > 0.01

      // ── Background + accent bar ──────────────────────────────────
      // IR-6: gate the Graphics rebuild on a key over every input that
      // affects the rendered shape. Discoveries don't pulse, so the key
      // is just the geometry + state inputs.
      const bgKey = `${cardW}|${cardH}|${typeColor}|${isSelected}`
      if (bgKey !== entry.lastBgKey) {
        entry.background.clear()
        entry.background.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 3)
        entry.background.fill({
          color: parseColor('#0a0f1e'),
          alpha: isSelected ? 0.8 : 0.6,
        })
        if (!isSelected) {
          entry.background.stroke({ width: 0.5, color: typeTint, alpha: 0.19 })
        }

        entry.accentBar.clear()
        entry.accentBar.rect(-cardW / 2, -cardH / 2, 2, cardH)
        entry.accentBar.fill({ color: typeTint, alpha: 0.375 })

        entry.lastBgKey = bgKey
      }

      // ── Selection glow ────────────────────────────────────────────
      entry.selectionGlow.visible = isSelected
      if (isSelected) {
        entry.selectionGlow.clear()
        entry.selectionGlow.roundRect(-cardW / 2 - 2, -cardH / 2 - 2, cardW + 4, cardH + 4, 4)
        entry.selectionGlow.stroke({ width: 1.5, color: typeTint, alpha: 0.5 })
      }

      // ── Label ─────────────────────────────────────────────────────
      const maxLabelChars = Math.floor((cardW - 10) / (8 * 0.6))
      const labelText = disc.label.length > maxLabelChars
        ? disc.label.slice(0, maxLabelChars - 1) + '…'
        : disc.label

      if (labelText !== entry.lastLabelText || typeColor !== entry.lastLabelColor) {
        if (entry.labelSprite) {
          entry.container.removeChild(entry.labelSprite)
          entry.labelSprite.destroy()
        }
        const glyph = this.glyphAtlas.getGlyph(labelText, typeColor, 8)
        const sprite = new Sprite(glyph.texture)
        sprite.anchor.set(0, 0)
        sprite.label = 'disc-label'
        entry.container.addChild(sprite)
        entry.labelSprite = sprite
        entry.lastLabelText = labelText
        entry.lastLabelColor = typeColor
      }
      if (entry.labelSprite) {
        entry.labelSprite.x = -cardW / 2 + 6
        entry.labelSprite.y = -cardH / 2 + 3
      }

      // ── Content lines ─────────────────────────────────────────────
      const contentKey = `${disc.content}|${cardW}`
      if (contentKey !== entry.lastContentKey) {
        // Remove old content sprites
        for (const s of entry.contentSprites) {
          entry.container.removeChild(s)
          s.destroy()
        }
        entry.contentSprites = []

        const maxContentChars = Math.floor((cardW - 10) / (7 * 0.6))
        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i].length > maxContentChars
            ? lines[i].slice(0, maxContentChars - 1) + '…'
            : lines[i]
          if (!lineText) continue
          const glyph = this.glyphAtlas.getGlyph(lineText, COLORS.textMuted, 7)
          const sprite = new Sprite(glyph.texture)
          sprite.anchor.set(0, 0)
          sprite.label = `disc-line-${i}`
          sprite.x = -cardW / 2 + 6
          sprite.y = -cardH / 2 + 14 + i * 11
          entry.container.addChild(sprite)
          entry.contentSprites.push(sprite)
        }
        entry.lastContentKey = contentKey
      }
    }

    // Drop entries for discoveries that no longer exist this frame.
    // Discoveries with opacity < 0.05 are skipped earlier in the loop, so
    // they fall out of aliveIds and get destroyed here. Previously entries
    // were merely hidden, leaking GPU buffers across long sessions.
    for (const [id, entry] of this.entries) {
      if (!aliveIds.has(id)) {
        entry.container.destroy({ children: true })
        this.entries.delete(id)
      }
    }
  }

  /** Release GPU resources and remove all display objects. */
  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.container.destroy({ children: true })
    }
    this.entries.clear()
    this.glyphAtlas.dispose()
    this.connectionLines.destroy()
    this.container.destroy({ children: true })
  }

  /** Number of discovery entries -- useful for tests. */
  get entryCount(): number {
    return this.entries.size
  }

  /** Retrieve an entry by discovery id -- useful for tests. */
  getEntry(discoveryId: string): DiscoveryEntry | undefined {
    return this.entries.get(discoveryId)
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private createEntry(discoveryId: string): DiscoveryEntry {
    const container = new Container()
    container.label = `discovery-${discoveryId}`
    container.eventMode = 'static'

    const background = new Graphics()
    background.label = 'disc-bg'
    container.addChild(background)

    const accentBar = new Graphics()
    accentBar.label = 'disc-accent'
    container.addChild(accentBar)

    const selectionGlow = new Graphics()
    selectionGlow.label = 'disc-selection'
    selectionGlow.visible = false
    container.addChild(selectionGlow)

    this.container.addChild(container)

    return {
      container,
      background,
      accentBar,
      selectionGlow,
      labelSprite: null,
      contentSprites: [],
      lastLabelText: '',
      lastLabelColor: '',
      lastContentKey: '',
      lastBgKey: '',
      discoveryId,
    }
  }
}
