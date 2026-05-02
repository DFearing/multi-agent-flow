/**
 * Detect which canvas renderer is active for this page load.
 *
 * Cached at module load: `?renderer=pixi` opts into the WebGL renderer,
 * anything else (no param, or `?renderer=canvas2d`) stays on the default
 * Canvas2D path.
 *
 * UI gates use this to hide controls that only meaningfully affect one
 * renderer (e.g. effect toggles flow into PixiCanvas only).
 */
export const IS_PIXI_RENDERER = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('renderer') === 'pixi'
