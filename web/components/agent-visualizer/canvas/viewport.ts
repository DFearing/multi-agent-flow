/**
 * Viewport culling helpers — compute the visible world-space rectangle once
 * per frame, then let draw functions skip entities that fall fully outside.
 *
 * All draw passes happen inside a `ctx.save() + translate(transform.x,y) +
 * scale(transform.scale)` block, so coordinates passed to draw functions are
 * in WORLD space. Bounds returned here are also in world space.
 */

export interface ViewBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function computeViewBounds(
  width: number, height: number,
  transform: { x: number; y: number; scale: number },
): ViewBounds {
  const s = transform.scale
  return {
    left: -transform.x / s,
    top: -transform.y / s,
    right: (width - transform.x) / s,
    bottom: (height - transform.y) / s,
  }
}

/** True when (x, y) lies inside `bounds` extended by `margin` on every side. */
export function isPointVisible(x: number, y: number, b: ViewBounds, margin = 0): boolean {
  return x >= b.left - margin && x <= b.right + margin
      && y >= b.top - margin && y <= b.bottom + margin
}

/** True when the rectangle (x, y, w, h) overlaps `bounds` (inclusive). */
export function isRectVisible(x: number, y: number, w: number, h: number, b: ViewBounds): boolean {
  return x + w >= b.left && x <= b.right
      && y + h >= b.top && y <= b.bottom
}

/** True when the AABB containing (fromX,fromY)…(cp1)…(cp2)…(toX,toY) overlaps
 *  `bounds`. Uses the bezier control polygon, which is a strict superset of
 *  the curve, so any visible part of the curve is captured. */
export function isBezierVisible(
  fromX: number, fromY: number,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  toX: number, toY: number,
  b: ViewBounds, margin = 0,
): boolean {
  const minX = Math.min(fromX, cp1x, cp2x, toX)
  if (minX > b.right + margin) return false
  const maxX = Math.max(fromX, cp1x, cp2x, toX)
  if (maxX < b.left - margin) return false
  const minY = Math.min(fromY, cp1y, cp2y, toY)
  if (minY > b.bottom + margin) return false
  const maxY = Math.max(fromY, cp1y, cp2y, toY)
  if (maxY < b.top - margin) return false
  return true
}
