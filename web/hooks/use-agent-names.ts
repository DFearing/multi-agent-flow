'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, createElement } from 'react'

// Per-instance store of user-provided names that override the simulation-derived
// `agent.name` wherever the UI displays it. Persisted in localStorage so renames
// survive reloads.

const STORAGE_KEY = 'agent-flow:agent-names:v1'

type NameMap = Record<string, string>

interface AgentNamesAPI {
  getName(sessionId: string, agentId: string): string | undefined
  setName(sessionId: string, agentId: string, name: string): void
  /** Live map of `${sessionId}:${agentId}` → custom name. */
  names: NameMap
}

const keyOf = (sessionId: string, agentId: string) => `${sessionId}:${agentId}`

const Context = createContext<AgentNamesAPI | null>(null)

function loadNames(): NameMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as NameMap
  } catch { /* ignore */ }
  return {}
}

function saveNames(names: NameMap) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(names)) } catch { /* ignore */ }
}

export function AgentNamesProvider({ children }: { children: ReactNode }) {
  const [names, setNames] = useState<NameMap>({})
  const namesRef = useRef<NameMap>(names)
  namesRef.current = names

  useEffect(() => {
    setNames(loadNames())
  }, [])

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((m: NameMap) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveNames(m), 200)
  }, [])

  const getName = useCallback((sessionId: string, agentId: string) => namesRef.current[keyOf(sessionId, agentId)], [])

  const setName = useCallback((sessionId: string, agentId: string, name: string) => {
    setNames(prev => {
      const trimmed = name.trim()
      const next = { ...prev }
      const k = keyOf(sessionId, agentId)
      if (trimmed) next[k] = trimmed
      else delete next[k]
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  return createElement(Context.Provider, { value: { getName, setName, names } }, children)
}

export function useAgentNames(): AgentNamesAPI {
  const ctx = useContext(Context)
  if (!ctx) throw new Error('useAgentNames must be used inside <AgentNamesProvider>')
  return ctx
}
