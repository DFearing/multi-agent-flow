'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Agent, ToolCallNode } from '@/lib/agent-types'
import type { ConversationMessage } from '@/hooks/simulation/types'

export interface SessionStats {
  agents: Map<string, Agent>
  toolCalls: Map<string, ToolCallNode>
  conversations: Map<string, ConversationMessage[]>
}

// ─── Data context (changes when perSession map changes) ──────────────────────

const SessionStatsDataContext = createContext<Map<string, SessionStats> | null>(null)

// ─── Dispatch context (stable for the lifetime of the provider) ──────────────

interface SessionStatsDispatchAPI {
  setSessionStats: (sessionId: string, stats: SessionStats) => void
  removeSessionStats: (sessionId: string) => void
}

const SessionStatsDispatchContext = createContext<SessionStatsDispatchAPI | null>(null)

// ─── Provider ────────────────────────────────────────────────────────────────

export function SessionStatsProvider({ children }: { children: ReactNode }) {
  const [perSession, setPerSession] = useState<Map<string, SessionStats>>(() => new Map())

  const setSessionStats = useCallback((sessionId: string, stats: SessionStats) => {
    setPerSession(prev => {
      const existing = prev.get(sessionId)
      // Avoid creating a new Map if the references are unchanged.
      if (existing
          && existing.agents === stats.agents
          && existing.toolCalls === stats.toolCalls
          && existing.conversations === stats.conversations) return prev
      const next = new Map(prev)
      next.set(sessionId, stats)
      return next
    })
  }, [])

  const removeSessionStats = useCallback((sessionId: string) => {
    setPerSession(prev => {
      if (!prev.has(sessionId)) return prev
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
  }, [])

  const dispatch = useMemo<SessionStatsDispatchAPI>(
    () => ({ setSessionStats, removeSessionStats }),
    // Both callbacks are stable (useCallback with []), so this memo never recomputes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <SessionStatsDataContext.Provider value={perSession}>
      <SessionStatsDispatchContext.Provider value={dispatch}>
        {children}
      </SessionStatsDispatchContext.Provider>
    </SessionStatsDataContext.Provider>
  )
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/** Read the per-session stats Map. Re-renders only when the Map reference changes. */
export function useSessionStatsData(): Map<string, SessionStats> {
  const ctx = useContext(SessionStatsDataContext)
  if (ctx === null) throw new Error('useSessionStatsData must be used inside <SessionStatsProvider>')
  return ctx
}

/** Access the stable dispatch API. Never causes a re-render on its own. */
export function useSessionStatsDispatch(): SessionStatsDispatchAPI {
  const ctx = useContext(SessionStatsDispatchContext)
  if (!ctx) throw new Error('useSessionStatsDispatch must be used inside <SessionStatsProvider>')
  return ctx
}

// ─── Legacy hook (deprecated — prefer the split hooks) ───────────────────────

interface SessionStatsAPI {
  perSession: Map<string, SessionStats>
  setSessionStats: (sessionId: string, stats: SessionStats) => void
  removeSessionStats: (sessionId: string) => void
}

/** @deprecated Use useSessionStatsData() and useSessionStatsDispatch() instead. */
export function useSessionStats(): SessionStatsAPI {
  const perSession = useSessionStatsData()
  const dispatch = useSessionStatsDispatch()
  return { perSession, ...dispatch }
}
