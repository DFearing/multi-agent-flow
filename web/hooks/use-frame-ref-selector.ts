import { useSyncExternalStore, useRef, useCallback, useEffect } from 'react'
import type { SimulationState } from './simulation/types'

/**
 * Minimum interval (ms) between subscriber notifications. The underlying
 * ref may update at 60 fps via requestAnimationFrame — this caps how often
 * React re-renders to avoid churning the UI for purely visual state.
 */
const POLL_INTERVAL_MS = 250

// Shared 4 Hz ticker — one setInterval drives every useFrameRefSelector
// instance in the app. With N session canvases each instantiating M selectors,
// the previous design ran N*M independent setIntervals — under CPU throttle
// these cluster into long-task fragments. A single shared timer fans out to
// all subscribers in O(N*M) per tick, but only one wakeup per period.
const subscribers = new Set<() => void>()
let intervalId: ReturnType<typeof setInterval> | null = null

function ensureTicker() {
  if (intervalId !== null) return
  intervalId = setInterval(() => {
    for (const tick of subscribers) tick()
  }, POLL_INTERVAL_MS)
}

function stopTickerIfEmpty() {
  if (subscribers.size === 0 && intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/**
 * Subscribe to a slice of a MutableRefObject<SimulationState> without
 * coupling to React re-renders of the simulation hook. The selector runs
 * on a polling timer (POLL_INTERVAL_MS) and only triggers a React render
 * when the selected value changes (via Object.is).
 *
 * Use this for chrome that reads `frameRef.currentTime`, `isPlaying`, or
 * `speed` and doesn't need to update at 60fps.
 */
export function useFrameRefSelector<T>(
  frameRef: React.RefObject<SimulationState>,
  selector: (state: SimulationState) => T,
): T {
  // Mutable snapshot that the external store reads from. Updated by the
  // shared ticker that compares the ref's current value against the cached
  // selection.
  const cachedRef = useRef<T>(selector(frameRef.current))
  const listenersRef = useRef(new Set<() => void>())

  useEffect(() => {
    const tick = () => {
      const next = selector(frameRef.current)
      if (!Object.is(next, cachedRef.current)) {
        cachedRef.current = next
        for (const l of listenersRef.current) l()
      }
    }
    subscribers.add(tick)
    ensureTicker()
    return () => {
      subscribers.delete(tick)
      stopTickerIfEmpty()
    }
  }, [frameRef, selector])

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => { listenersRef.current.delete(listener) }
  }, [])

  const getSnapshot = useCallback(() => cachedRef.current, [])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
