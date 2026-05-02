import { useRef, useEffect, useLayoutEffect, useCallback } from 'react'

/**
 * Auto-scrolls a container to the bottom when new items are added.
 * Disengages when the user scrolls up, re-engages when near the bottom.
 *
 * @param itemCount - Number of items (triggers scroll when this changes)
 * @param visible - Whether the scrollable area is currently visible
 * @param nearBottomThreshold - Distance from bottom (px) to re-enable auto-scroll
 */
export function useAutoScroll(
  itemCount: number,
  visible: boolean,
  nearBottomThreshold = 60,
) {
  const ref = useRef<HTMLDivElement>(null)
  const autoScroll = useRef(true)
  const prevVisible = useRef(false)
  const prevScrollHeight = useRef(0)

  // Auto-scroll on new items (if user hasn't scrolled up)
  useEffect(() => {
    if (ref.current && autoScroll.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [itemCount])

  // Catch the streaming case: the last message grows token-by-token without
  // changing itemCount. Run on every render and stick to bottom whenever the
  // scrollable content grew since the last paint.
  useLayoutEffect(() => {
    if (!ref.current) return
    const sh = ref.current.scrollHeight
    if (sh > prevScrollHeight.current && autoScroll.current) {
      ref.current.scrollTop = sh
    }
    prevScrollHeight.current = sh
  })

  // Scroll to bottom when container becomes visible
  useEffect(() => {
    if (visible && !prevVisible.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
      autoScroll.current = true
    }
    prevVisible.current = visible
  }, [visible])

  const handleScroll = useCallback(() => {
    if (!ref.current) return
    const { scrollTop, scrollHeight, clientHeight } = ref.current
    autoScroll.current = scrollHeight - scrollTop - clientHeight < nearBottomThreshold
  }, [nearBottomThreshold])

  /** Programmatically scroll to bottom and re-enable auto-scroll */
  const scrollToBottom = useCallback(() => {
    autoScroll.current = true
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [])

  return {
    ref,
    handleScroll,
    scrollToBottom,
    isAutoScrolling: autoScroll,
  }
}
