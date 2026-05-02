/**
 * Bloom post-processing for holographic glow effect.
 * Takes the main canvas, extracts bright areas, blurs them,
 * and composites back with additive blending.
 */

export class BloomRenderer {
  private bloomCanvas: HTMLCanvasElement
  private bloomCtx: CanvasRenderingContext2D
  private tempCanvas: HTMLCanvasElement
  private tempCtx: CanvasRenderingContext2D
  private intensity: number

  private enabled: boolean

  constructor(intensity: number = 0.6) {
    this.intensity = intensity
    this.bloomCanvas = document.createElement('canvas')
    this.tempCanvas = document.createElement('canvas')
    const bCtx = this.bloomCanvas.getContext('2d')
    const tCtx = this.tempCanvas.getContext('2d')
    this.enabled = !!(bCtx && tCtx)
    this.bloomCtx = bCtx!
    this.tempCtx = tCtx!
  }

  resize(width: number, height: number): void {
    // Bloom at half resolution for performance
    const scale = 0.5
    this.bloomCanvas.width = width * scale
    this.bloomCanvas.height = height * scale
    this.tempCanvas.width = width * scale
    this.tempCanvas.height = height * scale
  }

  apply(sourceCanvas: HTMLCanvasElement, targetCtx: CanvasRenderingContext2D): void {
    const w = this.bloomCanvas.width
    const h = this.bloomCanvas.height

    if (w === 0 || h === 0 || !this.enabled) return

    // Half-res copy of the source.
    this.bloomCtx.clearRect(0, 0, w, h)
    this.bloomCtx.drawImage(sourceCanvas, 0, 0, w, h)

    // Single Gaussian blur pass — CSS `filter: blur(N)` is already Gaussian,
    // so the multi-pass approximation we used previously was redundant. The
    // ~12px radius matches the cumulative effect of the old 8+6+4 chain
    // closely enough that the visual difference is minimal, with ~3× fewer
    // GPU ops per canvas per frame.
    this.tempCtx.clearRect(0, 0, w, h)
    this.tempCtx.filter = 'blur(12px)'
    this.tempCtx.drawImage(this.bloomCanvas, 0, 0)
    this.tempCtx.filter = 'none'

    // Composite bloom over the target with additive blending.
    targetCtx.save()
    targetCtx.globalCompositeOperation = 'lighter'
    targetCtx.globalAlpha = this.intensity
    targetCtx.drawImage(this.tempCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height)
    targetCtx.restore()
  }

  setIntensity(intensity: number): void {
    this.intensity = Math.max(0, Math.min(1, intensity))
  }

  /** Composite the most recent bloom result onto the target.
   *  Useful for throttled rendering: run apply() on render frames, then
   *  call applyCache() on skip frames to blit the last bloom without
   *  re-running the blur pipeline. */
  applyCache(sourceCanvas: HTMLCanvasElement, targetCtx: CanvasRenderingContext2D): void {
    const w = this.tempCanvas.width
    const h = this.tempCanvas.height
    if (w === 0 || h === 0 || !this.enabled) return

    targetCtx.save()
    targetCtx.globalCompositeOperation = 'lighter'
    targetCtx.globalAlpha = this.intensity
    targetCtx.drawImage(this.tempCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height)
    targetCtx.restore()
  }
}
