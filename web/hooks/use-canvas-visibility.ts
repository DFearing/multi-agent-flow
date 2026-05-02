/**
 * Hook that combines IntersectionObserver + document.visibilityState to
 * determine whether the render rAF should run for a given canvas.
 *
 * The render path gates on `visibleRef.current`:
 *   visibleRef = isInViewport AND isDocumentVisible
 *
 * When the canvas transitions from hidden to visible, `needsCatchUpRef`
 * is set to true so the draw loop can force one immediate redraw to catch
 * up with simulation changes that occurred while off-screen.
 *
 * The simulation sub-state keeps ticking regardless of visibility — only
 * the render path is gated.
 *
 * For cross-window / detached panels (created via window.open), the hook
 * listens to `visibilitychange` on `containerRef.current.ownerDocument`
 * rather than the global `document`. This ensures minimizing the secondary
 * window correctly pauses rendering in that window.
 *
 * Trade-off: ownerDocument is read once at mount time. Re-parenting the
 * container element to a different document at runtime is not supported —
 * the hook would need to be remounted (e.g. via a key change) to rebind.
 */

import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'

export interface CanvasVisibility {
  visibleRef: MutableRefObject<boolean>
  needsCatchUpRef: MutableRefObject<boolean>
}

export function useCanvasVisibility(
  containerRef: RefObject<HTMLElement | null>,
  pauseWhenOffscreen: boolean,
): CanvasVisibility {
  const visibleRef = useRef(true)
  const needsCatchUpRef = useRef(false)

  // Internal sub-state refs
  const isInViewportRef = useRef(true)
  const isDocVisibleRef = useRef(true)

  // ─── IntersectionObserver + visibilitychange ──────────────────────────
  useEffect(() => {
    if (!pauseWhenOffscreen) {
      visibleRef.current = true
      isInViewportRef.current = true
      isDocVisibleRef.current = true
      return
    }

    const el = containerRef.current
    if (!el) return

    const ownerDoc = el.ownerDocument ?? document

    // Helper: recompute combined visibility and handle transitions
    const recompute = () => {
      const prev = visibleRef.current
      const next = isInViewportRef.current && isDocVisibleRef.current
      visibleRef.current = next
      if (!prev && next) {
        needsCatchUpRef.current = true
      }
    }

    // Initial document visibility state
    isDocVisibleRef.current = ownerDoc.visibilityState === 'visible'
    recompute()

    // IntersectionObserver
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          isInViewportRef.current = entry.isIntersecting
        }
        recompute()
      },
      { threshold: 0 },
    )
    io.observe(el)

    // visibilitychange listener on ownerDocument
    const onVisChange = () => {
      isDocVisibleRef.current = ownerDoc.visibilityState === 'visible'
      recompute()
    }
    ownerDoc.addEventListener('visibilitychange', onVisChange)

    return () => {
      io.disconnect()
      ownerDoc.removeEventListener('visibilitychange', onVisChange)
    }
  }, [pauseWhenOffscreen, containerRef])

  return { visibleRef, needsCatchUpRef }
}
