// ─── Glow sprite cache ─────────────────────────────────────────────────────
// Pre-renders radial gradient glows to off-screen canvases.
// Avoids creating CanvasGradient objects every frame.

const glowSpriteCache = new Map<string, HTMLCanvasElement>()

/** Simple radial glow: gradient from center (innerAlpha) to edge (outerAlpha) */
export function getGlowSprite(
  color: string, radius: number, innerAlpha: string, outerAlpha: string,
): HTMLCanvasElement {
  const rQ = Math.ceil(radius)
  const key = `${color}|${rQ}|${innerAlpha}|${outerAlpha}`
  let sprite = glowSpriteCache.get(key)
  if (sprite) return sprite

  const size = rQ * 2
  sprite = document.createElement('canvas')
  sprite.width = size
  sprite.height = size
  const ctx = sprite.getContext('2d')!
  const glow = ctx.createRadialGradient(rQ, rQ, 0, rQ, rQ, rQ)
  glow.addColorStop(0, color + innerAlpha)
  glow.addColorStop(1, color + outerAlpha)
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  glowSpriteCache.set(key, sprite)
  return sprite
}

/** Agent glow: gradient from innerRadius to outerRadius */
export function getAgentGlowSprite(
  color: string, innerRadius: number, outerRadius: number, glowAlphaHex: string,
): HTMLCanvasElement {
  const iR = Math.round(innerRadius)
  const oR = Math.ceil(outerRadius)
  const key = `ag|${color}|${iR}|${oR}|${glowAlphaHex}`
  let sprite = glowSpriteCache.get(key)
  if (sprite) return sprite

  const size = oR * 2
  sprite = document.createElement('canvas')
  sprite.width = size
  sprite.height = size
  const ctx = sprite.getContext('2d')!
  const glow = ctx.createRadialGradient(oR, oR, iR, oR, oR, oR)
  glow.addColorStop(0, color + glowAlphaHex)
  glow.addColorStop(1, color + '00')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  glowSpriteCache.set(key, sprite)
  return sprite
}

/** Scanline strip: vertical fade 0 → midAlpha → 0. Cached per (color, midAlpha).
 *  The sprite is rendered at a fixed width and height = stripHeight; callers
 *  draw it stretched to whatever world width they need. Source width is wide
 *  enough that horizontal stretching doesn't introduce visible artifacts on
 *  the smooth vertical gradient. */
const SCANLINE_SPRITE_WIDTH = 64
export function getScanlineSprite(
  color: string, midAlpha: string, stripHeight: number,
): HTMLCanvasElement {
  const h = Math.max(1, Math.ceil(stripHeight))
  const key = `scan|${color}|${midAlpha}|${h}`
  let sprite = glowSpriteCache.get(key)
  if (sprite) return sprite

  sprite = document.createElement('canvas')
  sprite.width = SCANLINE_SPRITE_WIDTH
  sprite.height = h
  const ctx = sprite.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, color + '00')
  grad.addColorStop(0.5, color + midAlpha)
  grad.addColorStop(1, color + '00')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, SCANLINE_SPRITE_WIDTH, h)

  glowSpriteCache.set(key, sprite)
  return sprite
}

// ─── Text measurement cache ────────────────────────────────────────────────
// Caches ctx.measureText().width to avoid redundant browser layout per frame.
//
// Eviction: when full, drop the oldest TEXT_CACHE_EVICT_BATCH entries. JS Map
// preserves insertion order, so iterating .keys() gives FIFO. Previously this
// did `.clear()` on overflow, which caused periodic stutters in long-running
// sessions — every truncateText/wrapText call after the clear was a fresh
// ctx.measureText() (a layout-read that can trigger reflow).

const textWidthCache = new Map<string, number>()
const TEXT_CACHE_MAX = 2000
const TEXT_CACHE_EVICT_BATCH = 200

export function measureTextCached(ctx: CanvasRenderingContext2D, text: string): number {
  const key = ctx.font + '|' + text
  let w = textWidthCache.get(key)
  if (w !== undefined) return w
  w = ctx.measureText(text).width
  if (textWidthCache.size >= TEXT_CACHE_MAX) {
    let dropped = 0
    for (const oldKey of textWidthCache.keys()) {
      textWidthCache.delete(oldKey)
      if (++dropped >= TEXT_CACHE_EVICT_BATCH) break
    }
  }
  textWidthCache.set(key, w)
  return w
}

// ─── Text sprite (glyph) cache ────────────────────────────────────────────
// Pre-renders short text strings into off-screen canvases so hot-path
// fillText calls become cheap drawImage blits. LRU-evicted to bound memory.
//
// The cache is DPR-aware: sprites are rendered at `dpr` scale so they remain
// crisp on high-DPI screens. Callers draw them with inverse-DPR scaling so
// the logical size matches the original fillText.

interface TextSprite {
  canvas: HTMLCanvasElement
  /** Logical width (CSS px) */
  width: number
  /** Logical height (CSS px) */
  height: number
  /** DPR used when this sprite was rendered */
  dpr: number
  /** Monotonic access counter for LRU eviction */
  lastAccess: number
}

const textSpriteCache = new Map<string, TextSprite>()
const TEXT_SPRITE_MAX = 256
const TEXT_SPRITE_EVICT_BATCH = 32
let textSpriteAccessCounter = 0

/**
 * Get a cached off-screen canvas containing pre-rendered text.
 *
 * @param text   The string to render
 * @param font   CSS font string (e.g. "10px monospace", "bold 9px monospace")
 * @param color  CSS fill color
 * @param align  Text alignment used in the source context (default "left").
 *               When "center", the sprite is rendered with the anchor at its
 *               center so callers can blit at (x - width/2, y).
 * @param baseline Text baseline (default "top")
 * @param dpr    Device pixel ratio (default 1)
 */
export function getTextSprite(
  text: string,
  font: string,
  color: string,
  align: CanvasTextAlign = 'left',
  baseline: CanvasTextBaseline = 'top',
  dpr = 1,
): TextSprite {
  const key = `${text}|${font}|${color}|${align}|${baseline}|${dpr}`
  const cached = textSpriteCache.get(key)
  if (cached) {
    cached.lastAccess = ++textSpriteAccessCounter
    return cached
  }

  // Measure text to determine canvas size
  const measure = document.createElement('canvas')
  measure.width = 1
  measure.height = 1
  const mCtx = measure.getContext('2d')!
  mCtx.font = font
  const metrics = mCtx.measureText(text)

  // Compute logical dimensions with padding for descenders/ascenders
  const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/)
  const fontSize = fontSizeMatch ? parseFloat(fontSizeMatch[1]) : 10
  const logicalW = Math.ceil(metrics.width) + 2 // 1px padding each side
  const logicalH = Math.ceil(fontSize * 1.5) + 2

  // Create the sprite canvas at DPR resolution
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(logicalW * dpr)
  canvas.height = Math.ceil(logicalH * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = baseline === 'middle' ? 'middle' : 'top'

  const drawY = baseline === 'middle' ? logicalH / 2 : 1
  const drawX = 1 // 1px left padding

  ctx.fillText(text, drawX, drawY)

  const sprite: TextSprite = {
    canvas,
    width: logicalW,
    height: logicalH,
    dpr,
    lastAccess: ++textSpriteAccessCounter,
  }

  // Evict oldest entries if at capacity
  if (textSpriteCache.size >= TEXT_SPRITE_MAX) {
    // Collect entries, sort by lastAccess, remove oldest batch
    const entries = Array.from(textSpriteCache.entries())
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    for (let i = 0; i < TEXT_SPRITE_EVICT_BATCH && i < entries.length; i++) {
      textSpriteCache.delete(entries[i][0])
    }
  }

  textSpriteCache.set(key, sprite)
  return sprite
}

/**
 * Draw a cached text sprite. Replaces ctx.fillText() in hot paths.
 *
 * The sprite was rendered at `dpr` scale; this function applies inverse
 * scaling so the logical size matches the original fillText output.
 *
 * @param ctx    Target rendering context
 * @param sprite Cached text sprite from getTextSprite()
 * @param x      Logical x position
 * @param y      Logical y position
 * @param align  How to interpret x: "left" = left edge, "center" = center
 * @param baseline How to interpret y: "top" = top edge, "middle" = center
 */
export function drawTextSprite(
  ctx: CanvasRenderingContext2D,
  sprite: TextSprite,
  x: number,
  y: number,
  align: CanvasTextAlign = 'left',
  baseline: CanvasTextBaseline = 'top',
): void {
  const drawX = align === 'center' ? x - sprite.width / 2
    : align === 'right' ? x - sprite.width
    : x
  const drawY = baseline === 'middle' ? y - sprite.height / 2
    : baseline === 'bottom' ? y - sprite.height
    : y

  // The sprite canvas is at dpr resolution. We need to blit it at logical
  // size, so we draw the full canvas into a logicalW x logicalH rect.
  ctx.drawImage(
    sprite.canvas,
    Math.round(drawX) - 1, // offset for the 1px padding in the sprite
    Math.round(drawY),
    sprite.width,
    sprite.height,
  )
}

// ─── Per-agent overlay composite cache ────────────────────────────────────
// Caches the full stats overlay or cost label (box + text) per agent into an
// off-screen canvas keyed by (agentId, dataHash). When data is unchanged
// between frames, we just drawImage the cached overlay.

interface OverlaySprite {
  canvas: HTMLCanvasElement
  /** Logical width */
  width: number
  /** Logical height */
  height: number
  /** DPR used when rendered */
  dpr: number
  /** Hash of the data that was rendered (for invalidation) */
  dataHash: string
}

const overlayCache = new Map<string, OverlaySprite>()

/**
 * Get or create a cached overlay sprite for an agent.
 *
 * @param agentId  Unique agent identifier (cache key)
 * @param dataHash String encoding the data values (e.g. toolCalls, timeAlive).
 *                 When this changes, the cache entry is invalidated.
 * @param width    Logical width of the overlay
 * @param height   Logical height of the overlay
 * @param dpr      Device pixel ratio
 * @param render   Callback to render the overlay into the provided context.
 *                 The context is already scaled by dpr. Draw at logical coords.
 */
export function getOverlaySprite(
  agentId: string,
  dataHash: string,
  width: number,
  height: number,
  dpr: number,
  render: (ctx: CanvasRenderingContext2D) => void,
): OverlaySprite {
  const existing = overlayCache.get(agentId)
  if (existing && existing.dataHash === dataHash && existing.dpr === dpr) {
    return existing
  }

  const canvas = existing?.canvas ?? document.createElement('canvas')
  const pxW = Math.ceil(width * dpr)
  const pxH = Math.ceil(height * dpr)

  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }

  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, pxW, pxH)
  ctx.save()
  ctx.scale(dpr, dpr)
  render(ctx)
  ctx.restore()

  const sprite: OverlaySprite = { canvas, width, height, dpr, dataHash }
  overlayCache.set(agentId, sprite)
  return sprite
}

/**
 * Draw a cached overlay sprite at the given logical position.
 */
export function drawOverlaySprite(
  ctx: CanvasRenderingContext2D,
  sprite: OverlaySprite,
  x: number,
  y: number,
): void {
  ctx.drawImage(sprite.canvas, Math.round(x), Math.round(y), sprite.width, sprite.height)
}

/**
 * Evict overlay cache entries for agents that no longer exist.
 * Call once per frame (or every N frames) with the current agents map.
 *
 * Cache keys are prefixed (e.g. "stats-agentId", "cost-agentId").
 * We extract the agent ID after the first hyphen and check against the
 * active set.
 */
export function pruneOverlayCache(activeAgentIds: ReadonlySet<string>): void {
  for (const key of overlayCache.keys()) {
    const dashIdx = key.indexOf('-')
    const agentId = dashIdx >= 0 ? key.slice(dashIdx + 1) : key
    if (!activeAgentIds.has(agentId)) {
      overlayCache.delete(key)
    }
  }
}
