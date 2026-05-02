/**
 * Shared Pixi v8 renderer — singleton GL context + multi-viewport via multiView.
 *
 * Architecture:
 *   - ONE Application with `multiView: true` (one hidden GL canvas, one
 *     WebGL context shared across all viewports).
 *   - N viewports: each PixiCanvas registers a viewport on mount and
 *     deregisters on unmount.
 *   - Each viewport owns a Container (its scene-graph subtree) and a
 *     visible <canvas>. On each frame, the shared renderer renders the
 *     viewport's container directly to its visible canvas via
 *     `renderer.render({ container, target: canvas, clear: true })`.
 *     Pixi's multiView postrender handles the internal blit.
 *   - Texture atlases (glyphs, glow sprites, circle sprites) live on the
 *     shared renderer — no per-canvas duplication.
 *
 * The shared render rAF is owned by SimulationManager.registerRender().
 * Each PixiCanvas registers its draw callback there; when it runs, it
 * calls sharedRenderer.renderViewport() for its viewport id.
 */

import { Application, Container, EventBoundary, Texture, type WebGLRenderer } from 'pixi.js'

// ─── Viewport registry ─────────────────────────────────────────────────────

/** State tracked per registered viewport. */
export interface Viewport {
  /** Unique viewport id (typically React useId or a counter). */
  id: string
  /** Root container for this viewport's scene graph. */
  stage: Container
  /** The visible <canvas> element in the DOM for this viewport. */
  canvas: HTMLCanvasElement | null
  /** Current viewport dimensions in CSS pixels. */
  width: number
  height: number
  /** EventBoundary for per-pixel hit-testing against this viewport's world container. */
  boundary: EventBoundary | null
}

/** Singleton state for the shared renderer. */
interface SharedRendererState {
  app: Application<WebGLRenderer>
  viewports: Map<string, Viewport>
  /** Reference count — destroy the app when it drops to 0. */
  refCount: number
  /** True once app.init() has resolved. */
  ready: boolean
  /** Pending init promise (prevents double-init). */
  initPromise: Promise<void> | null
}

let shared: SharedRendererState | null = null

/**
 * Acquire the shared Pixi Application. The first call creates and
 * initializes it; subsequent calls increment the ref count.
 *
 * Call `releaseSharedRenderer()` on teardown — when refCount hits 0
 * the Application is destroyed.
 */
export async function acquireSharedRenderer(): Promise<Application<WebGLRenderer>> {
  if (shared) {
    shared.refCount++
    if (shared.initPromise) await shared.initPromise
    return shared.app
  }

  const app = new Application<WebGLRenderer>()

  const state: SharedRendererState = {
    app,
    viewports: new Map(),
    refCount: 1,
    ready: false,
    initPromise: null,
  }
  shared = state

  state.initPromise = app.init({
    backgroundColor: 0x050510,
    antialias: true,
    resolution: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
    autoDensity: true,
    preference: 'webgl',
    multiView: true,
    autoStart: false,
    width: 1,
    height: 1,
  }).then(() => {
    state.ready = true
    state.initPromise = null
  })

  await state.initPromise
  return app
}

/**
 * Release one reference to the shared renderer. When refCount reaches 0,
 * the Application and all viewports are destroyed.
 */
export function releaseSharedRenderer(): void {
  if (!shared) return
  shared.refCount--
  if (shared.refCount <= 0) {
    for (const vp of shared.viewports.values()) {
      vp.stage.destroy({ children: true })
    }
    shared.viewports.clear()
    disposeTextureCache()
    shared.app.destroy(true)
    shared = null
  }
}

/** Get the number of currently registered viewports (for tests). */
export function getViewportCount(): number {
  return shared?.viewports.size ?? 0
}

/** Check whether the shared renderer is initialized (for tests). */
export function isSharedRendererActive(): boolean {
  return shared !== null && shared.ready
}

/**
 * Register a new viewport. Returns the Viewport record.
 * The caller owns the stage Container (adding layers to it).
 */
export function registerViewport(id: string): Viewport {
  if (!shared) throw new Error('SharedRenderer not initialized — call acquireSharedRenderer() first')
  const existing = shared.viewports.get(id)
  if (existing) return existing

  const stage = new Container()
  stage.label = `viewport-${id}`

  const viewport: Viewport = {
    id,
    stage,
    canvas: null,
    width: 0,
    height: 0,
    boundary: null,
  }
  shared.viewports.set(id, viewport)
  return viewport
}

/**
 * Set the EventBoundary root for a viewport. Call after building the world
 * container so hit-tests route through the correct scene-graph subtree.
 */
export function setViewportBoundaryRoot(id: string, root: Container): void {
  if (!shared) return
  const vp = shared.viewports.get(id)
  if (!vp) return
  vp.boundary = new EventBoundary(root)
}

/**
 * Retrieve the EventBoundary for a viewport (for external hit-testing).
 */
export function getViewportBoundary(id: string): EventBoundary | null {
  if (!shared) return null
  const vp = shared.viewports.get(id)
  return vp?.boundary ?? null
}

/**
 * Deregister a viewport. The stage Container is destroyed along with
 * its children.
 */
export function deregisterViewport(id: string): void {
  if (!shared) return
  const vp = shared.viewports.get(id)
  if (!vp) return
  vp.boundary = null
  vp.stage.destroy({ children: true })
  shared.viewports.delete(id)
}

/**
 * Bind a visible <canvas> element to a viewport and set its dimensions.
 * Must be called after registerViewport and whenever the canvas resizes.
 */
export function bindViewportCanvas(
  id: string,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  if (!shared) return
  const vp = shared.viewports.get(id)
  if (!vp) return

  vp.canvas = canvas
  resizeViewport(id, width, height)
}

/**
 * Resize a viewport's visible canvas backing store to match new dimensions.
 */
export function resizeViewport(id: string, width: number, height: number): void {
  if (!shared || !shared.ready) return
  const vp = shared.viewports.get(id)
  if (!vp) return
  if (width <= 0 || height <= 0) return
  if (vp.width === width && vp.height === height) return

  vp.width = width
  vp.height = height

  const resolution = shared.app.renderer.resolution

  if (vp.canvas) {
    vp.canvas.width = Math.round(width * resolution)
    vp.canvas.height = Math.round(height * resolution)
  }
}

/**
 * Render a viewport's scene graph directly to its visible canvas via
 * multiView. Called once per viewport per frame from the PixiCanvas
 * draw callback.
 */
export function renderViewport(id: string): void {
  if (!shared || !shared.ready) return
  const vp = shared.viewports.get(id)
  if (!vp || !vp.canvas) return

  shared.app.renderer.render({
    container: vp.stage,
    target: vp.canvas,
    clear: true,
  })
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
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('getGlowTexture: 2D context unavailable')
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
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('getCircleTexture: 2D context unavailable')
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
