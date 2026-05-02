/**
 * GlyphAtlas — bakes monospace text strings into a texture atlas for GPU blitting.
 *
 * Design:
 *   - Cache key: `${text}|${color}|${fontSize}`.
 *   - Allocation: row-packed backing canvases. When a row can't fit the next
 *     glyph, a new row starts. When the canvas is full, a new backing canvas
 *     is allocated (no bin-packing for v1).
 *   - Returns Pixi `Texture` sub-regions referencing the backing BaseTexture.
 *
 * Font: `'SF Mono', 'Fira Code', monospace` to match the Canvas2D path.
 */

import { Texture, Rectangle } from 'pixi.js'

/** Descriptor returned by `getGlyph`. */
export interface GlyphDescriptor {
  texture: Texture
  width: number
  height: number
}

/** Internal: one backing canvas and its current allocation cursor. */
interface AtlasPage {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** Pixi base texture wrapping this canvas. */
  baseTexture: Texture
  /** Current X cursor within the active row. */
  cursorX: number
  /** Current Y cursor (top of the active row). */
  cursorY: number
  /** Tallest glyph in the current row. */
  rowHeight: number
}

const ATLAS_SIZE = 1024
const ATLAS_PADDING = 2
const DEFAULT_FONT_SIZE = 10
const FONT_FAMILY = "'SF Mono', 'Fira Code', monospace"

export class GlyphAtlas {
  private cache = new Map<string, GlyphDescriptor>()
  private pages: AtlasPage[] = []

  /** Look up or render a glyph and return its texture descriptor. */
  getGlyph(text: string, color: string, fontSize = DEFAULT_FONT_SIZE): GlyphDescriptor {
    const key = `${text}|${color}|${fontSize}`
    const cached = this.cache.get(key)
    if (cached) return cached

    // Measure the text
    const font = `${fontSize}px ${FONT_FAMILY}`
    const measuringCtx = this.getMeasuringContext()
    measuringCtx.font = font
    const metrics = measuringCtx.measureText(text)
    const w = Math.ceil(metrics.width) + ATLAS_PADDING * 2
    const h = Math.ceil(fontSize * 1.4) + ATLAS_PADDING * 2

    // Find or create a page with room
    const page = this.findPageWithRoom(w, h)

    // Render text into the page
    const x = page.cursorX
    const y = page.cursorY
    page.ctx.font = font
    page.ctx.textBaseline = 'top'
    page.ctx.fillStyle = color
    page.ctx.fillText(text, x + ATLAS_PADDING, y + ATLAS_PADDING)

    // Advance cursor
    page.cursorX += w
    page.rowHeight = Math.max(page.rowHeight, h)

    // Build a Texture sub-region
    const frame = new Rectangle(x, y, w, h)
    // Pixi v8: Texture constructor takes a TextureSource + a TextureLayout.
    // The simplest sub-region approach is Texture(source, { frame }).
    const texture = new Texture({
      source: page.baseTexture.source,
      frame,
    })

    const descriptor: GlyphDescriptor = { texture, width: w, height: h }
    this.cache.set(key, descriptor)
    return descriptor
  }

  /** Free all backing canvases and Pixi textures. */
  dispose(): void {
    for (const desc of this.cache.values()) {
      desc.texture.destroy()
    }
    this.cache.clear()
    for (const page of this.pages) {
      page.baseTexture.destroy(true)
    }
    this.pages.length = 0
  }

  /** Number of cached glyph entries (useful for tests). */
  get size(): number {
    return this.cache.size
  }

  /** Number of atlas pages allocated (useful for tests). */
  get pageCount(): number {
    return this.pages.length
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private measuringCanvas: HTMLCanvasElement | null = null
  private measuringCtx: CanvasRenderingContext2D | null = null

  private getMeasuringContext(): CanvasRenderingContext2D {
    if (!this.measuringCtx) {
      this.measuringCanvas = document.createElement('canvas')
      this.measuringCanvas.width = 1
      this.measuringCanvas.height = 1
      this.measuringCtx = this.measuringCanvas.getContext('2d')!
    }
    return this.measuringCtx
  }

  private findPageWithRoom(w: number, h: number): AtlasPage {
    // Try the last page first (most likely to have room)
    if (this.pages.length > 0) {
      const page = this.pages[this.pages.length - 1]
      if (this.canFit(page, w, h)) return page
    }
    // Allocate a new page
    return this.allocatePage()
  }

  private canFit(page: AtlasPage, w: number, h: number): boolean {
    // Fits in current row?
    if (page.cursorX + w <= ATLAS_SIZE) return true
    // Start a new row?
    const newRowY = page.cursorY + page.rowHeight
    if (newRowY + h <= ATLAS_SIZE) {
      // Advance to new row
      page.cursorX = 0
      page.cursorY = newRowY
      page.rowHeight = 0
      return true
    }
    return false
  }

  private allocatePage(): AtlasPage {
    const canvas = document.createElement('canvas')
    canvas.width = ATLAS_SIZE
    canvas.height = ATLAS_SIZE
    const ctx = canvas.getContext('2d')!

    const baseTexture = Texture.from({ resource: canvas, alphaMode: 'premultiply-alpha-on-upload' })

    const page: AtlasPage = {
      canvas,
      ctx,
      baseTexture,
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
    }
    this.pages.push(page)
    return page
  }
}
