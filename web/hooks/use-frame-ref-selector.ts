import { useSyncExternalStore, useRef, useCallback, useEffect } from 'react'
import type { SimulationState } from './simulation/types'

/**
 * Minimum interval (ms) between subscriber notifications. The underlying
 * ref may update at 60 fps via requestAnimationFrame — this caps how often
 * React re-renders to avoid churning the UI for purely visual state.
 */
const POLL_INTERVAL_MS = 250

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
  // Mutable snapshot that the external store reads from. Updated by a
  // polling interval that compares the ref's current value against the
  // cached selection.
  const cachedRef = useRef<T>(selector(frameRef.current))
  const listenersRef = useRef(new Set<() => void>())

  // Polling timer: reads frameRef, runs selector, emits if changed.
  useEffect(() => {
    const id = setInterval(() => {
      const next = selector(frameRef.current)
      if (!Object.is(next, cachedRef.current)) {
        cachedRef.current = next
        for (const l of listenersRef.current) l()
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [frameRef, selector])

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener)
    return () => { listenersRef.current.delete(listener) }
  }, [])

  const getSnapshot = useCallback(() => cachedRef.current, [])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
