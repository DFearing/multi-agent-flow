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
import { getCircleTexture } from './pixi-app'
import { GlyphAtlas } from './glyph-atlas'

/** Persistent state for one agent's display objects. */
interface AgentEntry {
  /** Root container for this agent. */
  container: Container
  /** Circle body sprite. */
  body: Sprite
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
  private readonly bodyTexture = getCircleTexture(16)

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

      // ── Body ────────────────────────────────────────────────────────
      const bodyScale = radius / 16 // texture radius is 16
      entry.body.scale.set(bodyScale)
      entry.body.tint = tint

      // ── Selection ring ──────────────────────────────────────────────
      entry.selectionRing.visible = isSelected
      if (isSelected) {
        entry.selectionRing.clear()
        entry.selectionRing.circle(0, 0, radius + 4)
        entry.selectionRing.stroke({ width: 2.5, color: tint, alpha: 0.8 })
      }

      // ── Hover halo ─────────────────────────────────────────────────
      entry.hoverHalo.visible = isHovered
      if (isHovered) {
        entry.hoverHalo.clear()
        entry.hoverHalo.circle(0, 0, radius + AGENT_DRAW.glowPadding)
        entry.hoverHalo.fill({ color: tint, alpha: 0.15 })
      }

      // ── Pulse ring (thinking state) ────────────────────────────────
      entry.pulseRing.visible = agent.state === 'thinking'
      if (agent.state === 'thinking') {
        const pulseAlpha = 0.15 + Math.sin(time * ANIM.pulseSpeed) * 0.1
        const pulseRadius = radius + AGENT_DRAW.orbitParticleOffset
        entry.pulseRing.clear()
        entry.pulseRing.circle(0, 0, pulseRadius)
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

    // Body circle
    const body = new Sprite(this.bodyTexture)
    body.anchor.set(0.5)
    body.label = 'body'
    container.addChild(body)

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
      body,
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
