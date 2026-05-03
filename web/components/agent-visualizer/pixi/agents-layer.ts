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
  /** Stable label portion of the stats overlay (e.g. "3 tools · ").
   *  Re-rendered only when `agent.toolCalls` changes — once per tool call,
   *  not once per frame. */
  statsLabelSprite: Sprite | null
  /** Volatile value portion of the stats overlay (e.g. "12s").
   *  Re-rendered only when `Math.floor(agent.timeAlive)` changes — at most
   *  1Hz, instead of the previous toFixed(1) churn at frame rate. */
  statsValueSprite: Sprite | null
  /** Cached width of the label sprite's glyph (used to position the value
   *  sprite to its right). Updated whenever the label re-renders. */
  statsLabelW: number
  /** Cached width of the value sprite's glyph. */
  statsValueW: number
  /** Active pulse ring (for thinking state animation). */
  pulseRing: Graphics
  /** Last-rendered label text (to detect changes). */
  lastLabelText: string
  /** Last-rendered label color. */
  lastLabelColor: string
  /** Last-rendered tool-call count for the stats label sprite. -1 sentinel
   *  forces re-render on first sight (since 0 is a valid agent.toolCalls). */
  lastStatsLabelCount: number
  /** Last-rendered integer second for the stats value sprite. -1 sentinel
   *  forces re-render on first sight. */
  lastStatsValueSec: number
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
      // CR-2: split the previous "${toolCalls} tools · ${timeAlive.toFixed(1)}s"
      // glyph into a stable label part and a 1Hz-quantized value part. The
      // old string changed every frame (toFixed(1) ticks ~60Hz), pumping a
      // unique entry into the glyph atlas each frame and churning the LRU.
      if (showStats && agent.state !== 'complete') {
        // Label re-renders only on tool-call count change.
        if (agent.toolCalls !== entry.lastStatsLabelCount) {
          if (entry.statsLabelSprite) {
            entry.container.removeChild(entry.statsLabelSprite)
            entry.statsLabelSprite.destroy()
          }
          const labelText = `${agent.toolCalls} tools · `
          const labelGlyph = this.glyphAtlas.getGlyph(labelText, '#66ccff90', STATS_OVERLAY.fontSize)
          const sprite = new Sprite(labelGlyph.texture)
          sprite.anchor.set(0, 1)
          sprite.label = 'stats-label'
          entry.container.addChild(sprite)
          entry.statsLabelSprite = sprite
          entry.statsLabelW = labelGlyph.width
          entry.lastStatsLabelCount = agent.toolCalls
        }

        // Value re-renders only when the integer second changes.
        const seconds = Math.floor(agent.timeAlive)
        if (seconds !== entry.lastStatsValueSec) {
          if (entry.statsValueSprite) {
            entry.container.removeChild(entry.statsValueSprite)
            entry.statsValueSprite.destroy()
          }
          const valueText = `${seconds}s`
          const valueGlyph = this.glyphAtlas.getGlyph(valueText, '#66ccff90', STATS_OVERLAY.fontSize)
          const sprite = new Sprite(valueGlyph.texture)
          sprite.anchor.set(0, 1)
          sprite.label = 'stats-value'
          entry.container.addChild(sprite)
          entry.statsValueSprite = sprite
          entry.statsValueW = valueGlyph.width
          entry.lastStatsValueSec = seconds
        }

        // Position both sprites so the combined glyph row is centered
        // horizontally above the agent. Recomputed every frame because
        // either width may have changed; both are O(1) numeric writes.
        const totalW = entry.statsLabelW + entry.statsValueW
        const baseY = -(radius + STATS_OVERLAY.yOffset)
        if (entry.statsLabelSprite) {
          entry.statsLabelSprite.x = -totalW / 2
          entry.statsLabelSprite.y = baseY
          entry.statsLabelSprite.visible = true
        }
        if (entry.statsValueSprite) {
          entry.statsValueSprite.x = -totalW / 2 + entry.statsLabelW
          entry.statsValueSprite.y = baseY
          entry.statsValueSprite.visible = true
        }
      } else {
        if (entry.statsLabelSprite) entry.statsLabelSprite.visible = false
        if (entry.statsValueSprite) entry.statsValueSprite.visible = false
      }
    }

    // Drop entries for agents that no longer exist this frame. The
    // simulation already enforces fade timing (animate.ts evicts faded
    // sub-agents only after opacity reaches 0), so layers can mirror its
    // decisions without a grace period. Previously entries were merely
    // hidden, accumulating monotonically over long sessions.
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
      statsLabelSprite: null,
      statsValueSprite: null,
      statsLabelW: 0,
      statsValueW: 0,
      pulseRing,
      lastLabelText: '',
      lastLabelColor: '',
      lastStatsLabelCount: -1,
      lastStatsValueSec: -1,
      agentId,
    }
  }
}
