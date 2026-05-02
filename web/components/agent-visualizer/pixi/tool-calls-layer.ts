/**
 * Tool-call rendering layer -- sprite-based via persistent Pixi Containers.
 *
 * Each tool call gets a Container holding:
 *   - A rounded-rect background (Graphics, tint-driven state color).
 *   - A label sprite from the glyph atlas.
 *   - An optional secondary line sprite (token cost or error message).
 *
 * State-driven color uses tint changes -- no texture re-allocation.
 * Persistent display objects across frames: same tool-call set on consecutive
 * frames does not allocate.
 *
 * Follows the same pattern as AgentsLayer / EdgesLayer: constructor creates
 * a Container, update() is called once per rAF tick, dispose() tears down.
 */

import { Container, Sprite, Graphics } from 'pixi.js'
import type { ToolCallNode } from '@/lib/agent-types'
import { TOOL_DRAW, TOOL_MAX_CARD_W } from '@/lib/canvas-constants'
import { COLORS } from '@/lib/colors'
import { GlyphAtlas } from './glyph-atlas'

/** Persistent state for one tool-call's display objects. */
interface ToolCallEntry {
  /** Root container for this tool call. */
  container: Container
  /** Rounded-rect background. */
  background: Graphics
  /** Primary label sprite (from glyph atlas). */
  labelSprite: Sprite | null
  /** Secondary line sprite (token cost or error detail). */
  secondarySprite: Sprite | null
  /** Selection highlight overlay. */
  selectionGlow: Graphics
  /** Last-rendered label text (to detect changes). */
  lastLabelText: string
  /** Last-rendered label color. */
  lastLabelColor: string
  /** Last-rendered secondary text. */
  lastSecondaryText: string
  /** Last-rendered secondary color. */
  lastSecondaryColor: string
  /** Tool call id. */
  toolCallId: string
}

/** Parse a CSS hex color string to a numeric tint value. */
function parseColor(hex: string): number {
  if (hex.startsWith('#')) {
    return parseInt(hex.slice(1, 7), 16)
  }
  return 0xffffff
}

// Pre-parsed tint constants
const TINT_TOOL = parseColor(COLORS.tool)
const TINT_RETURN = parseColor(COLORS.return)
const TINT_ERROR = parseColor(COLORS.error)
const TINT_HOLO = parseColor(COLORS.holoBase)

/**
 * Manages the tool-call rendering layer. Owns a Container that the caller
 * adds to the Pixi stage. Call `update()` each frame with the current
 * simulation state to position and style tool-call sprites.
 */
export class ToolCallsLayer {
  readonly container: Container
  private entries = new Map<string, ToolCallEntry>()
  private readonly glyphAtlas: GlyphAtlas

  constructor() {
    this.container = new Container()
    this.container.label = 'tool-calls'
    this.glyphAtlas = new GlyphAtlas()
  }

  /**
   * Update all tool-call display objects for the current frame.
   * Called once per rAF tick from pixi-canvas.tsx.
   */
  update(
    toolCalls: Map<string, ToolCallNode>,
    time: number,
    selectedToolCallId?: string | null,
  ): void {
    const aliveIds = new Set<string>()

    for (const [id, tool] of toolCalls) {
      aliveIds.add(id)

      let entry = this.entries.get(id)
      if (!entry) {
        entry = this.createEntry(id)
        this.entries.set(id, entry)
      }

      const isRunning = tool.state === 'running'
      const isError = tool.state === 'error'
      const isSelected = id === selectedToolCallId
      const pulse = isRunning
        ? Math.sin(time * 4) * 0.2 + 0.8
        : isError
          ? Math.sin(time * 6) * 0.15 + 0.85
          : 0.5

      // ── Card dimensions (mirrors Canvas2D draw-tool-calls.ts) ────────
      const toolLabel = `${tool.toolName}: ${tool.args}`
      // Approximate text width: fontSize * 0.6 per char (monospace)
      const approxCharW = TOOL_DRAW.fontSize * 0.6
      const textWidth = Math.min(toolLabel.length * approxCharW + 12, TOOL_MAX_CARD_W)
      const cardW = Math.max(60, textWidth)
      const cardH = (!isRunning && (tool.tokenCost || isError))
        ? TOOL_DRAW.expandedHeight
        : TOOL_DRAW.collapsedHeight

      // ── Position ────────────────────────────────────────────────────
      entry.container.x = tool.x
      entry.container.y = tool.y
      entry.container.alpha = tool.opacity
      entry.container.visible = tool.opacity > 0.01

      // ── Background ─────────────────────────────────────────────────
      entry.background.clear()
      entry.background.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, TOOL_DRAW.borderRadius)

      if (isError) {
        entry.background.fill({ color: 0x280a0f, alpha: 0.8 * pulse })
        entry.background.stroke({ width: 2, color: TINT_ERROR, alpha: 0.56 })
      } else if (isSelected) {
        entry.background.fill({ color: TINT_HOLO, alpha: 0.15 * pulse })
        entry.background.stroke({ width: 1.5, color: TINT_HOLO, alpha: 0.67 })
      } else {
        entry.background.fill({ color: 0x0a0f1e, alpha: 0.7 * pulse })
        entry.background.stroke({
          width: 1,
          color: isRunning ? TINT_TOOL : TINT_RETURN,
          alpha: isRunning ? 0.375 : 0.25,
        })
      }

      // ── Selection tint ─────────────────────────────────────────────
      entry.selectionGlow.visible = isSelected
      if (isSelected) {
        entry.selectionGlow.clear()
        entry.selectionGlow.roundRect(-cardW / 2 - 2, -cardH / 2 - 2, cardW + 4, cardH + 4, TOOL_DRAW.borderRadius + 1)
        entry.selectionGlow.stroke({ width: 1.5, color: TINT_HOLO, alpha: 0.4 })
      }

      // ── Primary label ──────────────────────────────────────────────
      // Truncate to fit card width
      const maxChars = Math.floor((cardW - 12) / approxCharW)
      const truncatedLabel = toolLabel.length > maxChars
        ? toolLabel.slice(0, maxChars - 1) + '…'
        : toolLabel
      const labelColor = isRunning ? COLORS.tool : isError ? COLORS.error : COLORS.return
      const labelY = (!isRunning && (tool.tokenCost || isError)) ? -TOOL_DRAW.twoLineOffset : 0

      if (truncatedLabel !== entry.lastLabelText || labelColor !== entry.lastLabelColor) {
        if (entry.labelSprite) {
          entry.container.removeChild(entry.labelSprite)
          entry.labelSprite.destroy()
        }
        const glyph = this.glyphAtlas.getGlyph(truncatedLabel, labelColor, TOOL_DRAW.fontSize)
        const sprite = new Sprite(glyph.texture)
        sprite.anchor.set(0.5)
        sprite.label = 'tool-label'
        entry.container.addChild(sprite)
        entry.labelSprite = sprite
        entry.lastLabelText = truncatedLabel
        entry.lastLabelColor = labelColor
      }
      if (entry.labelSprite) {
        entry.labelSprite.y = labelY
      }

      // ── Secondary line (token cost or error) ───────────────────────
      let secondaryText = ''
      let secondaryColor = ''
      if (isError) {
        const errLabel = tool.errorMessage || tool.result || ''
        const maxErrChars = Math.floor((cardW - 8) / (TOOL_DRAW.errorFontSize * 0.6))
        secondaryText = errLabel.length > maxErrChars
          ? errLabel.slice(0, maxErrChars - 1) + '…'
          : errLabel
        secondaryColor = COLORS.error + 'aa'
      } else if (!isRunning && tool.tokenCost) {
        secondaryText = `${tool.tokenCost} tok`
        secondaryColor = COLORS.tool + '90'
      }

      if (secondaryText) {
        const fontSize = isError ? TOOL_DRAW.errorFontSize : TOOL_DRAW.tokenFontSize
        if (secondaryText !== entry.lastSecondaryText || secondaryColor !== entry.lastSecondaryColor) {
          if (entry.secondarySprite) {
            entry.container.removeChild(entry.secondarySprite)
            entry.secondarySprite.destroy()
          }
          const glyph = this.glyphAtlas.getGlyph(secondaryText, secondaryColor, fontSize)
          const sprite = new Sprite(glyph.texture)
          sprite.anchor.set(0.5)
          sprite.label = 'tool-secondary'
          entry.container.addChild(sprite)
          entry.secondarySprite = sprite
          entry.lastSecondaryText = secondaryText
          entry.lastSecondaryColor = secondaryColor
        }
        if (entry.secondarySprite) {
          entry.secondarySprite.y = TOOL_DRAW.twoLineOffset + 2
          entry.secondarySprite.visible = true
        }
      } else if (entry.secondarySprite) {
        entry.secondarySprite.visible = false
      }
    }

    // Hide entries for tool calls that no longer exist
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

  /** Number of tool-call entries -- useful for tests. */
  get entryCount(): number {
    return this.entries.size
  }

  /** Retrieve an entry by tool-call id -- useful for tests. */
  getEntry(toolCallId: string): ToolCallEntry | undefined {
    return this.entries.get(toolCallId)
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private createEntry(toolCallId: string): ToolCallEntry {
    const container = new Container()
    container.label = `tool-${toolCallId}`
    // Enable event mode for future hit-detection (#27)
    container.eventMode = 'static'

    // Background
    const background = new Graphics()
    background.label = 'tool-bg'
    container.addChild(background)

    // Selection glow
    const selectionGlow = new Graphics()
    selectionGlow.label = 'tool-selection'
    selectionGlow.visible = false
    container.addChild(selectionGlow)

    this.container.addChild(container)

    return {
      container,
      background,
      labelSprite: null,
      secondarySprite: null,
      selectionGlow,
      lastLabelText: '',
      lastLabelColor: '',
      lastSecondaryText: '',
      lastSecondaryColor: '',
      toolCallId,
    }
  }
}
