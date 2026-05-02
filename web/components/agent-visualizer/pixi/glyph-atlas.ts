/**
 * GlyphAtlas — bakes monospace text strings into a texture atlas for GPU blitting.
 *
 * Design:
 *   - Cache key: `${text}|${color}|${fontSize}`.
 *   - Allocation: row-packed backing canvases. When a row can't fit the next
 *     glyph, a new row starts. When the canvas is full, a new backing canvas
 *     is allocated (no bin-packing for v1).
 *   - Returns Pixi `Texture` sub-regions referencing the backing BaseTexture.
 *   - Page-level LRU eviction: when allocating a new page would exceed the
 *     budget, the oldest page is dropped entirely. Entries on the dropped page
 *     are invalidated; new requests re-render into the newest page.
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
  /** Monotonic page id for LRU tracking. */
  id: number
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
  /** Timestamp of last access (monotonic counter, not wall clock). */
  lastAccessTime: number
}

const ATLAS_SIZE = 1024
const ATLAS_PADDING = 2
const DEFAULT_FONT_SIZE = 10
const FONT_FAMILY = "'SF Mono', 'Fira Code', monospace"

/** Default maximum number of atlas pages before LRU eviction kicks in. */
const DEFAULT_MAX_PAGES = 4

export class GlyphAtlas {
  private cache = new Map<string, GlyphDescriptor & { pageId: number }>()
  private pages: AtlasPage[] = []
  private pageIdCounter = 0
  private accessCounter = 0
  private maxPages: number

  constructor(maxPages = DEFAULT_MAX_PAGES) {
    this.maxPages = maxPages
  }

  /** Look up or render a glyph and return its texture descriptor. */
  getGlyph(text: string, color: string, fontSize = DEFAULT_FONT_SIZE): GlyphDescriptor {
    const key = `${text}|${color}|${fontSize}`
    const cached = this.cache.get(key)
    if (cached) {
      // Touch the page for LRU tracking
      const page = this.pages.find(p => p.id === cached.pageId)
      if (page) {
        page.lastAccessTime = ++this.accessCounter
      }
      return cached
    }

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

    // Touch the page
    page.lastAccessTime = ++this.accessCounter

    // Build a Texture sub-region
    const frame = new Rectangle(x, y, w, h)
    // Pixi v8: Texture constructor takes a TextureSource + a TextureLayout.
    // The simplest sub-region approach is Texture(source, { frame }).
    const texture = new Texture({
      source: page.baseTexture.source,
      frame,
    })

    const descriptor = { texture, width: w, height: h, pageId: page.id }
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
    // Need a new page — evict if at budget
    return this.allocatePageWithEviction()
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

  private allocatePageWithEviction(): AtlasPage {
    // If at budget, evict the oldest page
    if (this.pages.length >= this.maxPages) {
      this.evictOldestPage()
    }
    return this.allocatePage()
  }

  /** Drop the page with the lowest lastAccessTime. Invalidate all cache
   *  entries that reference it — they will be re-rendered on next access. */
  private evictOldestPage(): void {
    if (this.pages.length === 0) return

    // Find the page with the lowest lastAccessTime
    let oldestIdx = 0
    let oldestTime = this.pages[0].lastAccessTime
    for (let i = 1; i < this.pages.length; i++) {
      if (this.pages[i].lastAccessTime < oldestTime) {
        oldestTime = this.pages[i].lastAccessTime
        oldestIdx = i
      }
    }

    const evicted = this.pages[oldestIdx]

    // Remove cache entries that reference this page
    for (const [key, desc] of this.cache) {
      if (desc.pageId === evicted.id) {
        desc.texture.destroy()
        this.cache.delete(key)
      }
    }

    // Destroy the page's backing texture and canvas
    evicted.baseTexture.destroy(true)

    // Remove from pages array
    this.pages.splice(oldestIdx, 1)
  }

  private allocatePage(): AtlasPage {
    const canvas = document.createElement('canvas')
    canvas.width = ATLAS_SIZE
    canvas.height = ATLAS_SIZE
    const ctx = canvas.getContext('2d')!

    const baseTexture = Texture.from({ resource: canvas, alphaMode: 'premultiply-alpha-on-upload' })

    const page: AtlasPage = {
      id: this.pageIdCounter++,
      canvas,
      ctx,
      baseTexture,
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
      lastAccessTime: ++this.accessCounter,
    }
    this.pages.push(page)
    return page
  }
}
