/**
 * Camera adapter — applies `transformRef.current` (`{ x, y, scale }`) from
 * `useCanvasCamera` onto a Pixi Container (the "world" layer).
 *
 * This is intentionally thin: all easing, inertia, and auto-fit logic lives
 * in `useCanvasCamera`. This adapter just *reads* the transform and *sets* it
 * on the container once per frame.
 *
 * ## Screen-space layers
 *
 * Any future HUD / overlay content (perf counter, cost labels, etc.) that
 * should remain in screen space must be added as a sibling of `worldContainer`
 * on `app.stage` — NOT as a child of `worldContainer`. The stage itself is
 * never transformed; only the world container receives the camera transform.
 * This keeps the seam clean for follow-up sub-tasks that add screen-space UI.
 */

import type { Container } from 'pixi.js'
import type { Transform } from '@/hooks/use-canvas-camera'

/**
 * Apply the camera transform to the world container.
 *
 * Call once per rAF tick, after physics / simulation updates, before Pixi
 * renders. The function is idempotent — calling it twice with the same
 * `transform` values produces the same result (position and scale are set
 * absolutely, not incrementally).
 */
export function applyCameraTransform(
  worldContainer: Container,
  transform: Transform,
): void {
  worldContainer.position.set(transform.x, transform.y)
  worldContainer.scale.set(transform.scale)
}
