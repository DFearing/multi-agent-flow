import { useSyncExternalStore, useRef, useCallback } from 'react'
import type { SessionStats } from '@/components/agent-visualizer/session-stats-provider'

// ─── Shallow equality ───────────────────────────────────────────────────────

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
  const keysA = Object.keys(a) as (keyof T)[]
  const keysB = Object.keys(b) as (keyof T)[]
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false
  }
  return true
}

// ─── Store ──────────────────────────────────────────────────────────────────

type Listener = () => void

export interface SessionStatsStore {
  /** Get the full snapshot (immutable reference — changes on every write). */
  getSnapshot: () => ReadonlyMap<string, SessionStats>
  /** Write a single session entry. Only notifies subscribers if the entry
   *  actually changed (reference equality on agents/toolCalls/conversations). */
  setSessionStats: (sessionId: string, stats: SessionStats) => void
  /** Remove a session entry. */
  removeSessionStats: (sessionId: string) => void
  /** Subscribe a listener that fires on any mutation. */
  subscribe: (listener: Listener) => () => void
}

export function createSessionStatsStore(): SessionStatsStore {
  let data = new Map<string, SessionStats>()
  // Frozen snapshot — replaced on every mutation so useSyncExternalStore can
  // detect changes via reference identity.
  let snapshot: ReadonlyMap<string, SessionStats> = data

  const listeners = new Set<Listener>()

  function emit(): void {
    for (const l of listeners) l()
  }

  function getSnapshot(): ReadonlyMap<string, SessionStats> {
    return snapshot
  }

  function setSessionStats(sessionId: string, stats: SessionStats): void {
    const existing = data.get(sessionId)
    if (
      existing
      && existing.agents === stats.agents
      && existing.toolCalls === stats.toolCalls
      && existing.conversations === stats.conversations
    ) {
      return
    }
    // Mutate the working map in place — no fresh outer Map allocation.
    data.set(sessionId, stats)
    // Publish a new snapshot reference so selectors can detect change.
    snapshot = new Map(data)
    emit()
  }

  function removeSessionStats(sessionId: string): void {
    if (!data.has(sessionId)) return
    data.delete(sessionId)
    snapshot = new Map(data)
    emit()
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  return { getSnapshot, setSessionStats, removeSessionStats, subscribe }
}

// ─── Selector hook ──────────────────────────────────────────────────────────

/**
 * Subscribe to the session-stats store with a selector. The component only
 * re-renders when the selector's return value changes (compared via
 * `equalityFn`, defaulting to shallow equality for objects).
 */
export function useSessionStatsSelector<T>(
  store: SessionStatsStore,
  selector: (state: ReadonlyMap<string, SessionStats>) => T,
  equalityFn: (a: T, b: T) => boolean = shallowEqual,
): T {
  // Cache the latest selected value so we can compare on each store change
  // and skip re-renders when the slice hasn't changed.
  const prevRef = useRef<{ value: T; snapshot: ReadonlyMap<string, SessionStats> } | null>(null)

  const getSnapshotWithSelector = useCallback((): T => {
    const snap = store.getSnapshot()
    const prev = prevRef.current
    if (prev && prev.snapshot === snap) return prev.value
    const next = selector(snap)
    if (prev && equalityFn(prev.value, next)) {
      // Slice unchanged — preserve old reference so useSyncExternalStore
      // doesn't trigger a re-render.
      prevRef.current = { value: prev.value, snapshot: snap }
      return prev.value
    }
    prevRef.current = { value: next, snapshot: snap }
    return next
  }, [store, selector, equalityFn])

  return useSyncExternalStore(store.subscribe, getSnapshotWithSelector, getSnapshotWithSelector)
}
