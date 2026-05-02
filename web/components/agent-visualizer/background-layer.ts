import { DepthParticle } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { alphaHex } from '@/lib/utils'

const NUM_PARTICLES = 80
const HEX_GRID_SIZE = 60

// ─── Hex grid off-screen cache ─────────────────────────────────────────────
// Single-entry cache per AgentCanvas instance. Rebuilds when the cache key
// changes; otherwise blits the pre-rendered off-screen canvas.
//
// The hex pulse animation depends on `time`; we quantize it to ~200ms steps
// so the cache hits ~12/13 frames at 60fps while the animation still reads
// as alive. This is the sole visual deviation from the uncached path — the
// pulse updates at ~5Hz instead of every frame.

/** Quantization step for the time component of the cache key (seconds). */
const HEX_TIME_QUANT = 0.2

export interface HexGridCache {
  canvas: OffscreenCanvas | HTMLCanvasElement
  key: string
}

export function createHexGridCache(): HexGridCache {
  // Lazily sized on first use — start with a 1×1 placeholder.
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas')
  return { canvas, key: '' }
}

/**
 * Build a cache key from the values that affect the hex grid's pixel output.
 * Camera translation is reduced mod the hex tile period so panning within a
 * tile period reuses the same rendered grid (the grid tiles at `size * 1.5`
 * horizontally and `hexHeight` vertically in world space, which maps to
 * `period * scale` in screen space where tx/ty live).
 */
function hexCacheKey(
  width: number,
  height: number,
  dpr: number,
  scale: number,
  tx: number,
  ty: number,
  time: number,
): string {
  const size = HEX_GRID_SIZE
  const hexHeight = size * Math.sqrt(3)
  // Screen-space repeat distance for the hex tiling.
  const periodX = size * 1.5 * scale
  const periodY = hexHeight * scale

  // Reduce camera offset to the residual within one screen-space tile period.
  // Round to 2 decimal places so floating-point jitter doesn't produce
  // distinct keys for what amounts to the same pixel output.
  const modX = Math.round(((tx % periodX) + periodX) % periodX * 100) / 100
  const modY = Math.round(((ty % periodY) + periodY) % periodY * 100) / 100
  const timeQ = Math.round(time / HEX_TIME_QUANT)
  return `${width}|${height}|${dpr}|${scale.toFixed(4)}|${modX}|${modY}|${timeQ}`
}

/**
 * Draw the hex grid, using the off-screen cache when possible.
 * `dpr` is `window.devicePixelRatio` — the cache renders in device pixels.
 */
function drawHexGridCached(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  transform: { x: number; y: number; scale: number },
  time: number,
  cache: HexGridCache,
): void {
  const key = hexCacheKey(width, height, dpr, transform.scale, transform.x, transform.y, time)

  if (cache.key !== key) {
    // Resize the off-screen canvas to match the on-screen canvas in device pixels.
    const pw = Math.ceil(width * dpr)
    const ph = Math.ceil(height * dpr)
    if (cache.canvas.width !== pw || cache.canvas.height !== ph) {
      cache.canvas.width = pw
      cache.canvas.height = ph
    }

    const offCtx =
      cache.canvas instanceof OffscreenCanvas
        ? cache.canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null
        : cache.canvas.getContext('2d')
    if (!offCtx) return

    // Clear and render at device-pixel scale.
    offCtx.clearRect(0, 0, pw, ph)
    offCtx.save()
    offCtx.scale(dpr, dpr)

    const timeQ = Math.round(time / HEX_TIME_QUANT) * HEX_TIME_QUANT
    drawHexGrid(offCtx as unknown as CanvasRenderingContext2D, width, height, transform, timeQ)

    offCtx.restore()
    cache.key = key
  }

  // Blit the cached grid onto the main canvas.
  // The main canvas context is already scaled by dpr, so we draw in CSS-pixel
  // coordinates and let drawImage handle the device-pixel source.
  ctx.drawImage(cache.canvas, 0, 0, width, height)
}

export function createDepthParticles(width: number, height: number): DepthParticle[] {
  const particles: DepthParticle[] = []
  for (let i = 0; i < NUM_PARTICLES; i++) {
    particles.push({
      x: Math.random() * width * 2 - width * 0.5,
      y: Math.random() * height * 2 - height * 0.5,
      size: Math.random() * 1.5 + 0.5,
      brightness: Math.random() * 0.3 + 0.05,
      speed: Math.random() * 0.15 + 0.05,
      depth: Math.random(),
    })
  }
  return particles
}

export function updateDepthParticles(
  particles: DepthParticle[],
  deltaTime: number,
  width: number,
  height: number,
): void {
  for (const p of particles) {
    p.x += p.speed * deltaTime * 10 * (1 - p.depth * 0.5)
    p.y -= p.speed * deltaTime * 5 * (1 - p.depth * 0.3)

    // Wrap around
    if (p.x > width * 1.5) p.x = -width * 0.5
    if (p.y < -height * 0.5) p.y = height * 1.5
  }
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  particles: DepthParticle[],
  transform: { x: number; y: number; scale: number },
  showHexGrid: boolean,
  time: number,
  activeAgentPos?: { x: number; y: number; color: string },
  dpr?: number,
  hexCache?: HexGridCache,
): void {
  // Deep void
  ctx.fillStyle = COLORS.void
  ctx.fillRect(0, 0, width, height)

  // Ambient spotlight following active agent
  if (activeAgentPos) {
    const screenX = activeAgentPos.x * transform.scale + transform.x
    const screenY = activeAgentPos.y * transform.scale + transform.y
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, 300)
    gradient.addColorStop(0, activeAgentPos.color + '08')
    gradient.addColorStop(1, 'transparent')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }

  // Depth particles (parallax)
  for (const p of particles) {
    const parallaxFactor = 0.3 + p.depth * 0.7
    const px = p.x + transform.x * parallaxFactor * 0.1
    const py = p.y + transform.y * parallaxFactor * 0.1
    const size = p.size * (0.5 + p.depth * 0.5)
    const alpha = p.brightness * (0.5 + p.depth * 0.5)

    ctx.beginPath()
    ctx.fillStyle = COLORS.holoBase + alphaHex(alpha)
    ctx.arc(px, py, size, 0, Math.PI * 2)
    ctx.fill()
  }

  // Hex grid (optional)
  if (showHexGrid) {
    if (hexCache && dpr) {
      drawHexGridCached(ctx, width, height, dpr, transform, time, hexCache)
    } else {
      drawHexGrid(ctx, width, height, transform, time)
    }
  }
}

// Pre-computed hex vertex offsets (avoids trig per vertex per frame)
const HEX_OFFSETS = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 3) * i - Math.PI / 2
  return { cos: Math.cos(angle), sin: Math.sin(angle) }
})

// Reused alpha -> coordinate buckets for the hex grid. Drawn each frame; we
// keep the Map and its value arrays alive across frames and just reset
// array.length, instead of allocating a fresh Map + ~40 fresh arrays per
// frame as the grid was previously doing.
const HEX_BUCKETS = new Map<number, number[]>()

function drawHexGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  transform: { x: number; y: number; scale: number },
  time: number,
): void {
  ctx.save()
  ctx.translate(transform.x, transform.y)
  ctx.scale(transform.scale, transform.scale)

  const size = HEX_GRID_SIZE
  const hexHeight = size * Math.sqrt(3)
  const startX = Math.floor(-transform.x / transform.scale / (size * 1.5)) * (size * 1.5) - size * 3
  const startY = Math.floor(-transform.y / transform.scale / hexHeight) * hexHeight - hexHeight * 2
  const endX = startX + width / transform.scale + size * 6
  const endY = startY + height / transform.scale + hexHeight * 4

  const r = size * 0.4
  ctx.strokeStyle = COLORS.hexGrid
  ctx.lineWidth = 0.5

  // Quantize alpha into buckets to batch hexagons into fewer draw calls.
  // Reset the persistent buckets to empty without dropping their backing
  // arrays — the alpha set across frames is small (~40 quantized levels),
  // so the keys we'll re-encounter dominate.
  for (const arr of HEX_BUCKETS.values()) arr.length = 0
  const timeSin = time * 0.5

  for (let x = startX; x < endX; x += size * 1.5) {
    for (let y = startY; y < endY; y += hexHeight) {
      const offsetY = ((x - startX) / (size * 1.5)) % 2 === 0 ? 0 : hexHeight / 2
      const cx = x
      const cy = y + offsetY
      const dist = Math.sqrt(cx * cx + cy * cy)
      const pulse = Math.sin(timeSin + dist * 0.005) * 0.3 + 0.7
      // Quantize to 4 alpha levels to batch draws
      const alpha = Math.round(0.15 * pulse * 40) / 40
      let bucket = HEX_BUCKETS.get(alpha)
      if (!bucket) { bucket = []; HEX_BUCKETS.set(alpha, bucket) }
      // Store coords as flat pairs to avoid the [x, y] tuple allocation per cell.
      bucket.push(cx, cy)
    }
  }

  // Draw each alpha bucket as a single batched path
  for (const [alpha, coords] of HEX_BUCKETS) {
    if (coords.length === 0) continue
    ctx.globalAlpha = alpha
    ctx.beginPath()
    for (let i = 0; i < coords.length; i += 2) {
      const cx = coords[i]
      const cy = coords[i + 1]
      ctx.moveTo(cx + r * HEX_OFFSETS[0].cos, cy + r * HEX_OFFSETS[0].sin)
      for (let v = 1; v < 6; v++) {
        ctx.lineTo(cx + r * HEX_OFFSETS[v].cos, cy + r * HEX_OFFSETS[v].sin)
      }
      ctx.closePath()
    }
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  ctx.restore()
}
