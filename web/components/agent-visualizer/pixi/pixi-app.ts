/**
 * Pixi v8 application bootstrap + texture/atlas helpers.
 *
 * Each PixiCanvas instance gets its own Application. In a follow-up PR we will
 * consolidate to a shared Renderer + multi-viewport, but for the spike each
 * panel is self-contained.
 */

import { Application, Texture } from 'pixi.js'

/** Options for bootstrapping a Pixi application into a host element. */
export interface PixiAppOptions {
  /** DOM element to append the Pixi canvas into */
  container: HTMLElement
  /** Initial width in CSS pixels */
  width: number
  /** Initial height in CSS pixels */
  height: number
  /** Background color (hex number) */
  backgroundColor?: number
}

/**
 * Create and initialize a Pixi v8 Application. Returns the app and its root
 * stage container.
 *
 * The caller is responsible for calling `app.destroy(true)` on teardown.
 */
export async function createPixiApp(options: PixiAppOptions): Promise<Application> {
  const app = new Application()
  await app.init({
    resizeTo: options.container,
    backgroundColor: options.backgroundColor ?? 0x050510,
    antialias: true,
    // Use device pixel ratio for sharp rendering
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    // Prefer WebGL — fallback to WebGPU is fine too
    preference: 'webgl',
  })

  // Pixi v8: the canvas is app.canvas
  options.container.appendChild(app.canvas)

  return app
}

// ─── Texture helpers ────────────────────────────────────────────────────────

/** Cache of pre-rendered glow textures, keyed by `${color}|${radius}`. */
const glowTextureCache = new Map<string, Texture>()

/**
 * Generate a radial-gradient glow texture. Cached by color + radius so we
 * only pay the cost once per unique combination.
 *
 * Uses an off-screen Canvas2D to draw the gradient, then wraps as a Pixi
 * Texture. This avoids needing a custom shader for the glow effect.
 */
export function getGlowTexture(
  color: string,
  radius: number,
  innerAlpha = 0x60,
  outerAlpha = 0x00,
): Texture {
  const rQ = Math.ceil(radius)
  const key = `${color}|${rQ}|${innerAlpha}|${outerAlpha}`
  const cached = glowTextureCache.get(key)
  if (cached) return cached

  const size = rQ * 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(rQ, rQ, 0, rQ, rQ, rQ)
  const innerHex = innerAlpha.toString(16).padStart(2, '0')
  const outerHex = outerAlpha.toString(16).padStart(2, '0')
  grad.addColorStop(0, color + innerHex)
  grad.addColorStop(1, color + outerHex)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const texture = Texture.from(canvas)
  glowTextureCache.set(key, texture)
  return texture
}

/**
 * Generate a simple filled circle texture. Used as the base sprite for
 * particles (trail segments, cores, highlights).
 */
const circleTextureCache = new Map<string, Texture>()

export function getCircleTexture(radius: number): Texture {
  const rQ = Math.ceil(radius)
  const key = `circle|${rQ}`
  const cached = circleTextureCache.get(key)
  if (cached) return cached

  const size = rQ * 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.beginPath()
  ctx.arc(rQ, rQ, rQ, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  const texture = Texture.from(canvas)
  circleTextureCache.set(key, texture)
  return texture
}

/**
 * Dispose of all cached textures. Call when the entire Pixi renderer is
 * torn down to free GPU memory.
 */
export function disposeTextureCache(): void {
  for (const t of glowTextureCache.values()) t.destroy(true)
  glowTextureCache.clear()
  for (const t of circleTextureCache.values()) t.destroy(true)
  circleTextureCache.clear()
}
