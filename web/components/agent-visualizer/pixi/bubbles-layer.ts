/**
 * Message bubble rendering layer -- sprite-pooled via Pixi Containers.
 *
 * Bubbles attach to agents and stack vertically above each agent.
 * Lifecycle: spawn -> visible (BUBBLE_HOLD seconds) -> fade-out -> release.
 *
 * Uses a sprite pool to avoid per-bubble allocation: bubble spawn acquires
 * from the pool; expiry releases (sets visible=false, returns to pool).
 *
 * Each bubble entry is a Container holding:
 *   - A rounded-rect background (Graphics).
 *   - A role label sprite (from glyph atlas).
 *   - Content line sprites (from glyph atlas).
 *
 * Follows the same pattern as AgentsLayer / ToolCallsLayer.
 */

import { Container, Sprite, Graphics } from 'pixi.js'
import type { Agent, MessageBubble } from '@/lib/agent-types'
import { NODE } from '@/lib/agent-types'
import {
  BUBBLE_MAX_W,
  BUBBLE_GAP,
  BUBBLE_MAX_LINES,
  AGENT_DRAW,
  BUBBLE_DRAW,
} from '@/lib/canvas-constants'
import { COLORS } from '@/lib/colors'
import { bubbleAlpha } from '../canvas/bubble-utils'
import { GlyphAtlas } from './glyph-atlas'

/** Persistent display object set for one bubble slot. */
interface BubbleEntry {
  container: Container
  background: Graphics
  labelSprite: Sprite | null
  contentSprites: Sprite[]
  /** Cache key for current content to avoid re-rendering. */
  lastContentKey: string
  /** Cache key for role label. */
  lastLabelKey: string
}

/** Pool of reusable bubble entries. */
interface BubblePool {
  free: BubbleEntry[]
  active: Map<string, BubbleEntry>
}

/** Approximate character width for monospace at a given font size. */
function approxCharW(fontSize: number): number {
  return fontSize * 0.6
}

/**
 * Manages the message bubble rendering layer. Owns a Container that the
 * caller adds to the Pixi stage. Call `update()` each frame with the
 * current agents map to position, fade, and pool bubble sprites.
 */
export class BubblesLayer {
  readonly container: Container
  private readonly glyphAtlas: GlyphAtlas
  private readonly pool: BubblePool

  constructor() {
    this.container = new Container()
    this.container.label = 'bubbles'
    this.glyphAtlas = new GlyphAtlas()
    this.pool = { free: [], active: new Map() }
  }

  /**
   * Update all bubble display objects for the current frame.
   * Called once per rAF tick from pixi-canvas.tsx.
   */
  update(agents: Map<string, Agent>, time: number): void {
    // Track which bubble keys are alive this frame
    const aliveKeys = new Set<string>()

    for (const agent of agents.values()) {
      if (agent.messageBubbles.length === 0) continue

      const radius = agent.isMain ? NODE.radiusMain : NODE.radiusSub
      const anchorX = agent.x + radius + AGENT_DRAW.bubbleAnchorOffset
      let cursorY = agent.y + AGENT_DRAW.bubbleCursorY

      for (let bi = 0; bi < agent.messageBubbles.length; bi++) {
        const bubble = agent.messageBubbles[bi]
        const age = time - bubble.time
        const alpha = bubbleAlpha(age, agent.opacity)
        if (alpha < 0.01) continue

        const key = `${agent.id}|${bi}|${bubble.time}`
        aliveKeys.add(key)

        const { role, text } = bubble
        const isThinking = role === 'thinking'
        const style = isThinking ? BUBBLE_DRAW.thinking : BUBBLE_DRAW.normal

        // ── Compute bubble dimensions ───────────────────────────────
        const charW = approxCharW(style.fontSize)
        const maxCharsPerLine = Math.floor((BUBBLE_MAX_W - style.padding * 2 - 4) / charW)

        // Simple line wrapping (approximation of Canvas2D wrapText)
        const rawLines = text.split('\n')
        const allLines: string[] = []
        for (const para of rawLines) {
          if (para.trim() === '') { allLines.push(''); continue }
          const words = para.split(/\s+/)
          let line = ''
          for (const word of words) {
            const test = line ? `${line} ${word}` : word
            if (test.length > maxCharsPerLine && line) {
              allLines.push(line)
              line = word
            } else {
              line = test
            }
          }
          if (line) allLines.push(line)
        }

        const truncated = allLines.length > BUBBLE_MAX_LINES
        const lines = truncated ? allLines.slice(0, BUBBLE_MAX_LINES) : allLines

        const maxLineLen = Math.max(...lines.map(l => l.length), 1)
        const bubbleW = Math.min(
          BUBBLE_MAX_W,
          maxLineLen * charW + style.padding * 2 + 4,
        )
        const bubbleH = style.headerH + lines.length * style.lineH + style.padding
          + (truncated ? style.lineH * 0.8 : 0)

        // ── Acquire or reuse entry ──────────────────────────────────
        let entry = this.pool.active.get(key)
        if (!entry) {
          entry = this.pool.free.pop() || this.createEntry()
          this.pool.active.set(key, entry)
          entry.container.visible = true
          entry.container.label = `bubble-${agent.id}`
          entry.container.eventMode = 'static'
        }

        // ── Position + alpha ────────────────────────────────────────
        entry.container.x = anchorX
        entry.container.y = cursorY
        entry.container.alpha = isThinking ? alpha * 0.7 : alpha
        entry.container.visible = true

        // ── Background ──────────────────────────────────────────────
        const bgColor = this.getBubbleBgTint(role)
        const bgAlpha = isThinking ? 0.08 : 0.12
        entry.background.clear()
        entry.background.roundRect(0, 0, bubbleW, bubbleH, BUBBLE_DRAW.borderRadius)
        entry.background.fill({ color: bgColor, alpha: bgAlpha })
        entry.background.stroke({ width: 0.5, color: bgColor, alpha: isThinking ? 0.15 : 0.25 })

        // ── Role label ──────────────────────────────────────────────
        const labelStr = isThinking ? 'THINKING' : role === 'user' ? 'USER' : 'CLAUDE'
        const labelColor = this.getLabelColor(role)
        const labelKey = `${labelStr}|${labelColor}|${style.labelSize}`

        if (labelKey !== entry.lastLabelKey) {
          if (entry.labelSprite) {
            entry.container.removeChild(entry.labelSprite)
            entry.labelSprite.destroy()
          }
          const glyph = this.glyphAtlas.getGlyph(labelStr, labelColor, style.labelSize)
          const sprite = new Sprite(glyph.texture)
          sprite.anchor.set(0, 0)
          sprite.label = 'bubble-label'
          sprite.x = style.padding
          sprite.y = 3
          entry.container.addChild(sprite)
          entry.labelSprite = sprite
          entry.lastLabelKey = labelKey
        }

        // ── Content lines ───────────────────────────────────────────
        const contentKey = `${text}|${bubbleW}|${style.fontSize}`
        if (contentKey !== entry.lastContentKey) {
          for (const s of entry.contentSprites) {
            entry.container.removeChild(s)
            s.destroy()
          }
          entry.contentSprites = []

          const textColor = this.getTextColor(role)
          for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i]
            if (!lineText && lines.length > 1) continue
            const glyph = this.glyphAtlas.getGlyph(lineText || ' ', textColor, style.fontSize)
            const sprite = new Sprite(glyph.texture)
            sprite.anchor.set(0, 0)
            sprite.label = `bubble-line-${i}`
            sprite.x = style.padding
            sprite.y = style.headerH + i * style.lineH
            entry.container.addChild(sprite)
            entry.contentSprites.push(sprite)
          }

          if (truncated) {
            const glyph = this.glyphAtlas.getGlyph('...', textColor + '80', style.fontSize)
            const sprite = new Sprite(glyph.texture)
            sprite.anchor.set(0, 0)
            sprite.label = 'bubble-ellipsis'
            sprite.x = style.padding
            sprite.y = style.headerH + lines.length * style.lineH
            entry.container.addChild(sprite)
            entry.contentSprites.push(sprite)
          }

          entry.lastContentKey = contentKey
        }

        cursorY += bubbleH + BUBBLE_GAP
      }
    }

    // Release entries for bubbles no longer visible
    for (const [key, entry] of this.pool.active) {
      if (!aliveKeys.has(key)) {
        entry.container.visible = false
        this.pool.active.delete(key)
        this.pool.free.push(entry)
      }
    }
  }

  /** Release GPU resources and remove all display objects. */
  dispose(): void {
    for (const entry of this.pool.active.values()) {
      entry.container.destroy({ children: true })
    }
    for (const entry of this.pool.free) {
      entry.container.destroy({ children: true })
    }
    this.pool.active.clear()
    this.pool.free.length = 0
    this.glyphAtlas.dispose()
    this.container.destroy({ children: true })
  }

  /** Number of currently active bubble entries -- useful for tests. */
  get activeCount(): number {
    return this.pool.active.size
  }

  /** Number of free (pooled) entries -- useful for tests. */
  get freeCount(): number {
    return this.pool.free.length
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private createEntry(): BubbleEntry {
    const container = new Container()
    container.label = 'bubble'

    const background = new Graphics()
    background.label = 'bubble-bg'
    container.addChild(background)

    this.container.addChild(container)

    return {
      container,
      background,
      labelSprite: null,
      contentSprites: [],
      lastContentKey: '',
      lastLabelKey: '',
    }
  }

  /** Get a numeric tint for the bubble background by role. */
  private getBubbleBgTint(role: string): number {
    switch (role) {
      case 'thinking': return 0x8c64c8  // rgba(140, 100, 200)
      case 'user': return 0xc8a050      // rgba(200, 160, 80)
      default: return 0x50a0dc          // rgba(80, 160, 220)
    }
  }

  /** Get the label color string by role. */
  private getLabelColor(role: string): string {
    switch (role) {
      case 'thinking': return COLORS.roleThinkingText + '60'
      case 'user': return COLORS.roleUserText + '80'
      default: return COLORS.roleAssistantText + '80'
    }
  }

  /** Get the text color string by role. */
  private getTextColor(role: string): string {
    switch (role) {
      case 'thinking': return COLORS.roleThinkingText + 'b0'
      case 'user': return COLORS.roleUserText
      default: return COLORS.roleAssistantText
    }
  }
}
