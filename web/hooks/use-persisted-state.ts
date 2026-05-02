'use client'

import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

/**
 * useState that mirrors its value to localStorage. The initial value is
 * read synchronously from storage on first render so reloads don't flicker
 * between the default and the persisted value.
 *
 * Safe in Next.js client components — the lazy initializer guards against
 * `window` being undefined during SSR, and the page only hydrates once the
 * client takes over so hydration mismatch is a non-issue.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initial
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch { /* corrupt entry — fall through to initial */ }
    return initial
  })

  // Skip the first persist after mount: we just read the value from storage,
  // there's nothing new to write.
  const skipFirstWriteRef = useRef(true)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (skipFirstWriteRef.current) {
      skipFirstWriteRef.current = false
      return
    }
    try { localStorage.setItem(key, JSON.stringify(state)) } catch { /* ignore */ }
  }, [key, state])

  return [state, setState]
}
