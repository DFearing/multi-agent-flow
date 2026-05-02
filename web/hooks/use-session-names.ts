'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, createElement } from 'react'

// User-renameable per-session labels. Overrides the default session label
// (which is derived from the first user message). Persisted in localStorage
// so renames survive reloads. Keyed by sessionId — same id across sim runs
// only happens when the JSONL files are kept (e.g. sim --keep), so renames
// effectively scope to that "long-lived" session.

const STORAGE_KEY = 'agent-flow:session-names:v1'

type NameMap = Record<string, string>

interface SessionNamesAPI {
  getName(sessionId: string): string | undefined
  setName(sessionId: string, name: string): void
  /** Live map of sessionId → custom name. */
  names: NameMap
}

const Context = createContext<SessionNamesAPI | null>(null)

function load(): NameMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as NameMap
  } catch { /* ignore */ }
  return {}
}

function save(names: NameMap) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(names)) } catch { /* ignore */ }
}

export function SessionNamesProvider({ children }: { children: ReactNode }) {
  const [names, setNames] = useState<NameMap>({})
  const namesRef = useRef<NameMap>(names)
  namesRef.current = names

  useEffect(() => {
    setNames(load())
  }, [])

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((m: NameMap) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => save(m), 200)
  }, [])

  const getName = useCallback((sessionId: string) => namesRef.current[sessionId], [])

  const setName = useCallback((sessionId: string, name: string) => {
    setNames(prev => {
      const trimmed = name.trim()
      const next = { ...prev }
      if (trimmed) next[sessionId] = trimmed
      else delete next[sessionId]
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  return createElement(Context.Provider, { value: { getName, setName, names } }, children)
}

export function useSessionNames(): SessionNamesAPI {
  const ctx = useContext(Context)
  if (!ctx) throw new Error('useSessionNames must be used inside <SessionNamesProvider>')
  return ctx
}
