'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Agent, ToolCallNode } from '@/lib/agent-types'
import type { ConversationMessage } from '@/hooks/simulation/types'
import {
  createSessionStatsStore,
  useSessionStatsSelector,
  type SessionStatsStore,
} from '@/lib/session-stats-store'

export interface SessionStats {
  agents: Map<string, Agent>
  toolCalls: Map<string, ToolCallNode>
  conversations: Map<string, ConversationMessage[]>
}

// ─── Store context ──────────────────────────────────────────────────────────

const SessionStatsStoreContext = createContext<SessionStatsStore | null>(null)

// ─── Dispatch context (stable for the lifetime of the provider) ─────────

interface SessionStatsDispatchAPI {
  setSessionStats: (sessionId: string, stats: SessionStats) => void
  removeSessionStats: (sessionId: string) => void
}

const SessionStatsDispatchContext = createContext<SessionStatsDispatchAPI | null>(null)

// ─── Provider ───────────────────────────────────────────────────────────────

export function SessionStatsProvider({ children }: { children: ReactNode }) {
  // The store is created once per provider lifetime — no React state involved.
  const store = useMemo(() => createSessionStatsStore(), [])

  const dispatch = useMemo<SessionStatsDispatchAPI>(
    () => ({
      setSessionStats: store.setSessionStats,
      removeSessionStats: store.removeSessionStats,
    }),
    [store],
  )

  return (
    <SessionStatsStoreContext.Provider value={store}>
      <SessionStatsDispatchContext.Provider value={dispatch}>
        {children}
      </SessionStatsDispatchContext.Provider>
    </SessionStatsStoreContext.Provider>
  )
}

// ─── Internal hook to grab the store ────────────────────────────────────────

function useStore(): SessionStatsStore {
  const ctx = useContext(SessionStatsStoreContext)
  if (ctx === null) throw new Error('useSessionStats* must be used inside <SessionStatsProvider>')
  return ctx
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** Access the stable dispatch API. Never causes a re-render on its own. */
export function useSessionStatsDispatch(): SessionStatsDispatchAPI {
  const ctx = useContext(SessionStatsDispatchContext)
  if (!ctx) throw new Error('useSessionStatsDispatch must be used inside <SessionStatsProvider>')
  return ctx
}

/**
 * Select a derived slice from the session-stats store. The component only
 * re-renders when the selected value changes (shallow equality by default).
 *
 * Usage:
 *   const totalCost = useSessionStatsSel(snap => computeTotalCost(snap))
 */
export function useSessionStatsSel<T>(
  selector: (state: ReadonlyMap<string, SessionStats>) => T,
  equalityFn?: (a: T, b: T) => boolean,
): T {
  const store = useStore()
  return useSessionStatsSelector(store, selector, equalityFn)
}

/**
 * Read the per-session stats Map.
 * Compatibility shim — re-renders on ANY store mutation (the full Map
 * snapshot changes reference). Prefer useSessionStatsSel with a selector.
 *
 * @deprecated Use useSessionStatsSel() with a targeted selector instead.
 */
export function useSessionStatsData(): ReadonlyMap<string, SessionStats> {
  const store = useStore()
  return useSessionStatsSelector(
    store,
    (snap) => snap,
    // Identity equality — the snapshot reference changes on every write,
    // which is the same behavior as the old useState-based approach.
    Object.is,
  )
}

// ─── Legacy hook (deprecated — prefer the split hooks) ──────────────────────

interface SessionStatsAPI {
  perSession: ReadonlyMap<string, SessionStats>
  setSessionStats: (sessionId: string, stats: SessionStats) => void
  removeSessionStats: (sessionId: string) => void
}

/** @deprecated Use useSessionStatsSel() and useSessionStatsDispatch() instead. */
export function useSessionStats(): SessionStatsAPI {
  const perSession = useSessionStatsData()
  const dispatch = useSessionStatsDispatch()
  return { perSession, ...dispatch }
}
