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
