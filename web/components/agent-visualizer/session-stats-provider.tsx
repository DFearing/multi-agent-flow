'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Agent, ToolCallNode } from '@/lib/agent-types'
import type { ConversationMessage } from '@/hooks/simulation/types'

export interface SessionStats {
  agents: Map<string, Agent>
  toolCalls: Map<string, ToolCallNode>
  conversations: Map<string, ConversationMessage[]>
}

interface SessionStatsAPI {
  perSession: Map<string, SessionStats>
  setSessionStats: (sessionId: string, stats: SessionStats) => void
  removeSessionStats: (sessionId: string) => void
}

const Context = createContext<SessionStatsAPI | null>(null)

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

  return (
    <Context.Provider value={{ perSession, setSessionStats, removeSessionStats }}>
      {children}
    </Context.Provider>
  )
}

export function useSessionStats(): SessionStatsAPI {
  const ctx = useContext(Context)
  if (!ctx) throw new Error('useSessionStats must be used inside <SessionStatsProvider>')
  return ctx
}
