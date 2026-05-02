/**
 * Agent rendering layer — sprite-based via persistent Pixi Containers.
 *
 * Each agent gets a Container holding:
 *   - A circle sprite for the body (color via tint, sized by agent state).
 *   - A label sprite from the glyph atlas.
 *   - A selection ring sprite (visible when selected).
 *   - A hover halo sprite (visible when hovered).
 *   - An optional stats overlay sprite (visible when showStats is true).
 *
 * State-driven color uses tint changes — no texture re-allocation.
 * Persistent display objects across frames: same agent set on consecutive
 * frames does not allocate.
 *
 * Follows the same pattern as ParticlesLayer / EdgesLayer: constructor
 * creates a Container, update() is called once per rAF tick, dispose()
 * tears down.
 */

import { Container, Sprite, Graphics } from 'pixi.js'
import type { Agent } from '@/lib/agent-types'
import { NODE, ANIM } from '@/lib/agent-types'
import { AGENT_DRAW, STATS_OVERLAY } from '@/lib/canvas-constants'
import { getStateColor } from '@/lib/colors'
import { getHexagonTexture, hexagonPoints, getBrandTexture, BRAND_BAKE_RADIUS, getGlowTexture } from './pixi-app'
import { GlyphAtlas } from './glyph-atlas'

/** Persistent state for one agent's display objects. */
interface AgentEntry {
  /** Root container for this agent. */
  container: Container
  /** Glow halo sprite — radial-gradient texture sized to r+glowPadding. */
  glow: Sprite
  /** Last-applied glow cache key (color|radius) so we only swap when needed. */
  lastGlowKey: string
  /** Hexagon body sprite — dark `nodeInterior` fill (state color appears in stateRing). */
  body: Sprite
  /** Brand overlay sprite (Claude spark / OpenAI logomark), tinted by state. */
  brand: Sprite
  /** Last-applied brand cache key (runtime|color). */
  lastBrandKey: string
  /** Subtle outer hex ring (color+'25', stroked) at r+outerRingOffset. */
  outerRing: Graphics
  /** State ring (hex outline at r in state color, dashed for complete/waiting). */
  stateRing: Graphics
  /** Selection ring graphics. */
  selectionRing: Graphics
  /** Hover halo graphics. */
  hoverHalo: Graphics
  /** Name label sprite (from glyph atlas). */
  labelSprite: Sprite | null
  /** Stats overlay sprite (from glyph atlas). */
  statsSprite: Sprite | null
  /** Active pulse ring (for thinking state animation). */
  pulseRing: Graphics
  /** Last-rendered label text (to detect changes). */
  lastLabelText: string
  /** Last-rendered label color. */
  lastLabelColor: string
  /** Last-rendered stats text. */
  lastStatsText: string
  /** Agent id. */
  agentId: string
}

/** Hex color of `COLORS.nodeInterior = rgba(10, 15, 40, 0.5)` — applied as
 *  body sprite tint with alpha 0.5. */
const NODE_INTERIOR_TINT = 0x0A0F28
const NODE_INTERIOR_ALPHA = 0.5

/** Parse a CSS hex color string to a numeric tint value. */
function parseColor(hex: string): number {
  if (hex.startsWith('#')) {
    return parseInt(hex.slice(1, 7), 16)
  }
  return 0xffffff
}

/**
 * Manages the agent rendering layer. Owns a Container that the caller adds
 * to the Pixi stage. Call `update()` each frame with the current simulation
 * state to position and style agent sprites.
 */
export class AgentsLayer {
  readonly container: Container
  private entries = new Map<string, AgentEntry>()
  private readonly glyphAtlas: GlyphAtlas
  /** Body texture is a 16-radius hexagon (matches Canvas2D drawHexagon).
   *  Per-agent radius is applied via sprite scale. */
  private readonly bodyTexture = getHexagonTexture(16)

  constructor() {
    this.container = new Container()
    this.container.label = 'agents'
    this.glyphAtlas = new GlyphAtlas()
  }

  /**
   * Update all agent display objects for the current frame.
   * Called once per rAF tick from pixi-canvas.tsx.
   */
  update(
    agents: Map<string, Agent>,
    selectedAgentId: string | null,
    hoveredAgentId: string | null,
    showStats: boolean,
    time: number,
  ): void {
    const aliveIds = new Set<string>()

    for (const [id, agent] of agents) {
      aliveIds.add(id)

      let entry = this.entries.get(id)
      if (!entry) {
        entry = this.createEntry(id)
        this.entries.set(id, entry)
      }

      const isSelected = id === selectedAgentId
      const isHovered = id === hoveredAgentId
      const isWaiting = agent.state === 'waiting_permission'
      const color = getStateColor(agent.state)
      const tint = parseColor(color)

      // ── Breathe modulation (matches Canvas2D path) ──────────────────
      const breathe = isWaiting
        ? Math.sin(time * AGENT_DRAW.waitingBreatheSpeed) * AGENT_DRAW.waitingBreatheAmp + 1
        : agent.state === 'thinking'
          ? Math.sin(time * ANIM.breathe.thinkingSpeed) * ANIM.breathe.thinkingAmp + 1
          : agent.state === 'idle'
            ? Math.sin(time * ANIM.breathe.idleSpeed) * ANIM.breathe.idleAmp + 1
            : 1

      const radius = (agent.isMain ? NODE.radiusMain : NODE.radiusSub) * breathe * agent.scale

      // ── Position ────────────────────────────────────────────────────
      entry.container.x = agent.x
      entry.container.y = agent.y
      entry.container.alpha = agent.opacity
      entry.container.visible = agent.opacity > 0.01

      // ── Glow halo ───────────────────────────────────────────────────
      // Canvas2D drawAgentGlow draws a radial gradient sprite at r+glowPadding,
      // alpha varying by state. We mirror with getGlowTexture cached by
      // (color|radius); per-state alpha applied as sprite.alpha.
      const glowR = radius + AGENT_DRAW.glowPadding
      const glowRq = Math.ceil(glowR)
      const glowKey = `${color}|${glowRq}`
      if (glowKey !== entry.lastGlowKey) {
        entry.glow.texture = getGlowTexture(color, glowRq)
        entry.lastGlowKey = glowKey
      }
      entry.glow.visible = true
      entry.glow.alpha = isHovered || isSelected
        ? 0.35
        : isWaiting
          ? 0.3
          : agent.state === 'thinking'
            ? 0.2
            : 0.1

      // ── Body ────────────────────────────────────────────────────────
      // Canvas2D draws the inner hex fill at r with COLORS.nodeInterior — a
      // dark translucent fill (state color appears in stateRing, not body).
      // Body tint/alpha set once in createEntry; only scale changes per frame.
      entry.body.scale.set(radius / 16)

      // ── Outer hex ring ──────────────────────────────────────────────
      // drawAgentGlow at draw-agents.ts:197 — stroke at r+outerRingOffset
      // in the state color with alpha 0x25 (~0.145).
      entry.outerRing.clear()
      entry.outerRing.poly(hexagonPoints(radius + AGENT_DRAW.outerRingOffset))
      entry.outerRing.stroke({ width: 1, color: tint, alpha: 0x25 / 0xff })

      // ── State ring (solid for now; dashed-for-waiting/complete pending) ─
      // drawStateRing at draw-agents.ts:222 — hex stroke at r in the state
      // color, lineWidth 2 (or 2.5 when selected/hovered).
      entry.stateRing.clear()
      entry.stateRing.poly(hexagonPoints(radius))
      entry.stateRing.stroke({
        width: (isSelected || isHovered) ? 2.5 : 2,
        color: tint,
        alpha: 1,
      })

      // ── Brand overlay (Claude spark / OpenAI logomark) ──────────────
      // Tinted by state color and shadow-blurred at bake time, so the
      // texture cache key is `${runtime}|${color}`. Sprite scale converts
      // BRAND_BAKE_RADIUS to per-agent radius; matches Canvas2D's
      // r*sparkScale on-screen size.
      const runtime = agent.runtime ?? 'claude'
      const brandColor = color + '90' // alpha-90 to match drawAgentBrand call site
      const brandKey = `${runtime}|${brandColor}`
      if (brandKey !== entry.lastBrandKey) {
        entry.brand.texture = getBrandTexture(runtime, brandColor)
        entry.lastBrandKey = brandKey
      }
      entry.brand.scale.set(radius / BRAND_BAKE_RADIUS)
      entry.brand.visible = true

      // ── Selection ring (hexagonal) ──────────────────────────────────
      entry.selectionRing.visible = isSelected
      if (isSelected) {
        entry.selectionRing.clear()
        entry.selectionRing.poly(hexagonPoints(radius + 4))
        entry.selectionRing.stroke({ width: 2.5, color: tint, alpha: 0.8 })
      }

      // ── Hover halo (hexagonal) ──────────────────────────────────────
      entry.hoverHalo.visible = isHovered
      if (isHovered) {
        entry.hoverHalo.clear()
        entry.hoverHalo.poly(hexagonPoints(radius + AGENT_DRAW.glowPadding))
        entry.hoverHalo.fill({ color: tint, alpha: 0.15 })
      }

      // ── Pulse ring (thinking state, hexagonal) ──────────────────────
      entry.pulseRing.visible = agent.state === 'thinking'
      if (agent.state === 'thinking') {
        const pulseAlpha = 0.15 + Math.sin(time * ANIM.pulseSpeed) * 0.1
        const pulseRadius = radius + AGENT_DRAW.orbitParticleOffset
        entry.pulseRing.clear()
        entry.pulseRing.poly(hexagonPoints(pulseRadius))
        entry.pulseRing.stroke({ width: 1.5, color: tint, alpha: pulseAlpha })
      }

      // ── Label ──────────────────────────────────────────────────────
      const labelColor = isHovered ? '#aaeeff' : '#66ccffcc'
      const labelText = agent.name
      if (labelText !== entry.lastLabelText || labelColor !== entry.lastLabelColor) {
        if (entry.labelSprite) {
          entry.container.removeChild(entry.labelSprite)
          entry.labelSprite.destroy()
        }
        const glyph = this.glyphAtlas.getGlyph(labelText, labelColor, 10)
        const sprite = new Sprite(glyph.texture)
        sprite.anchor.set(0.5, 0)
        sprite.label = 'label'
        entry.container.addChild(sprite)
        entry.labelSprite = sprite
        entry.lastLabelText = labelText
        entry.lastLabelColor = labelColor
      }
      if (entry.labelSprite) {
        entry.labelSprite.y = radius + AGENT_DRAW.labelYOffset
      }

      // ── Stats overlay ──────────────────────────────────────────────
      if (showStats && agent.state !== 'complete') {
        const statsText = `${agent.toolCalls} tools · ${agent.timeAlive.toFixed(1)}s`
        if (statsText !== entry.lastStatsText) {
          if (entry.statsSprite) {
            entry.container.removeChild(entry.statsSprite)
            entry.statsSprite.destroy()
          }
          const glyph = this.glyphAtlas.getGlyph(statsText, '#66ccff90', STATS_OVERLAY.fontSize)
          const sprite = new Sprite(glyph.texture)
          sprite.anchor.set(0.5, 1)
          sprite.label = 'stats'
          entry.container.addChild(sprite)
          entry.statsSprite = sprite
          entry.lastStatsText = statsText
        }
        if (entry.statsSprite) {
          entry.statsSprite.y = -(radius + STATS_OVERLAY.yOffset)
          entry.statsSprite.visible = true
        }
      } else if (entry.statsSprite) {
        entry.statsSprite.visible = false
      }
    }

    // Hide entries for agents that no longer exist
    for (const [id, entry] of this.entries) {
      if (!aliveIds.has(id)) {
        entry.container.visible = false
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
    this.container.destroy({ children: true })
  }

  /** Number of agent entries — useful for tests. */
  get entryCount(): number {
    return this.entries.size
  }

  /** Retrieve an entry by agent id — useful for tests. */
  getEntry(agentId: string): AgentEntry | undefined {
    return this.entries.get(agentId)
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private createEntry(agentId: string): AgentEntry {
    const container = new Container()
    container.label = `agent-${agentId}`
    container.eventMode = 'static'

    // ── Children added in z-order; later additions render on top. ──

    // Glow halo (background, behind body)
    const glow = new Sprite()
    glow.anchor.set(0.5)
    glow.label = 'glow'
    glow.visible = false
    container.addChild(glow)

    // Body hexagon (dark nodeInterior; state color shows in stateRing instead)
    const body = new Sprite(this.bodyTexture)
    body.anchor.set(0.5)
    body.tint = NODE_INTERIOR_TINT
    body.alpha = NODE_INTERIOR_ALPHA
    body.label = 'body'
    container.addChild(body)

    // Outer hex ring at r+outerRingOffset (subtle frame around the body)
    const outerRing = new Graphics()
    outerRing.label = 'outer-ring'
    container.addChild(outerRing)

    // State ring at r (state color, becomes dashed for complete/waiting later)
    const stateRing = new Graphics()
    stateRing.label = 'state-ring'
    container.addChild(stateRing)

    // Brand overlay (Claude spark / OpenAI logomark)
    const brand = new Sprite()
    brand.anchor.set(0.5)
    brand.label = 'brand'
    brand.visible = false
    container.addChild(brand)

    // Selection ring
    const selectionRing = new Graphics()
    selectionRing.label = 'selection-ring'
    selectionRing.visible = false
    container.addChild(selectionRing)

    // Hover halo
    const hoverHalo = new Graphics()
    hoverHalo.label = 'hover-halo'
    hoverHalo.visible = false
    container.addChild(hoverHalo)

    // Pulse ring (thinking animation)
    const pulseRing = new Graphics()
    pulseRing.label = 'pulse-ring'
    pulseRing.visible = false
    container.addChild(pulseRing)

    this.container.addChild(container)

    return {
      container,
      glow,
      lastGlowKey: '',
      body,
      brand,
      lastBrandKey: '',
      outerRing,
      stateRing,
      selectionRing,
      hoverHalo,
      labelSprite: null,
      statsSprite: null,
      pulseRing,
      lastLabelText: '',
      lastLabelColor: '',
      lastStatsText: '',
      agentId,
    }
  }
}
