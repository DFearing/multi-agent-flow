'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Default for unseen workspaces is visible so a fresh session never silently
// disappears — only an explicit `false` entry hides anything.

const STORAGE_KEY = 'agent-flow:workspace-filter:v1'

interface Stored {
  /** Sparse map: missing cwds default to visible. */
  visibility: Record<string, boolean>
}

export interface WorkspaceFilterAPI {
  knownWorkspaces: string[]
  /** Sessions without a cwd (e.g. Codex-runtime sessions before cwd capture)
   *  are always visible — they have nothing to filter on. */
  isVisible(cwd: string | undefined): boolean
  setVisibility(cwd: string, visible: boolean): void
  showAll(): void
  /** Hide every known workspace except `target`. */
  isolate(cwd: string): void
  registerCwd(cwd: string): void
}

function load(): Stored {
  if (typeof window === 'undefined') return { visibility: {} }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>
      return { visibility: parsed.visibility ?? {} }
    }
  } catch { /* ignore */ }
  return { visibility: {} }
}

function save(stored: Stored) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)) } catch { /* ignore */ }
}

export function useWorkspaceFilter(): WorkspaceFilterAPI {
  const [visibility, setVisibilityState] = useState<Record<string, boolean>>({})
  const [seen, setSeen] = useState<Set<string>>(() => new Set())

  // Seed `seen` from prior storage so the dropdown lists workspaces from
  // earlier visits even before any session arrives for them on this load.
  useEffect(() => {
    const stored = load()
    setVisibilityState(stored.visibility)
    setSeen(new Set(Object.keys(stored.visibility)))
  }, [])

  // Debounced persist
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((vis: Record<string, boolean>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => save({ visibility: vis }), 200)
  }, [])
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  const registerCwd = useCallback((cwd: string) => {
    if (!cwd) return
    setSeen(prev => prev.has(cwd) ? prev : new Set(prev).add(cwd))
  }, [])

  const knownWorkspaces = useMemo(() => [...seen].sort(), [seen])

  const isVisible = useCallback((cwd: string | undefined): boolean => {
    if (!cwd) return true
    const v = visibility[cwd]
    return v === undefined ? true : v
  }, [visibility])

  const setVisibility = useCallback((cwd: string, visible: boolean) => {
    setVisibilityState(prev => {
      const next = { ...prev, [cwd]: visible }
      scheduleSave(next)
      return next
    })
    setSeen(prev => prev.has(cwd) ? prev : new Set(prev).add(cwd))
  }, [scheduleSave])

  const showAll = useCallback(() => {
    setVisibilityState(prev => {
      const next = { ...prev }
      for (const cwd of Object.keys(next)) next[cwd] = true
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const isolate = useCallback((target: string) => {
    setVisibilityState(prev => {
      const next: Record<string, boolean> = { ...prev }
      // Hide everything we know about, show only the target.
      for (const cwd of Object.keys(next)) next[cwd] = false
      next[target] = true
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  return { knownWorkspaces, isVisible, setVisibility, showAll, isolate, registerCwd }
}
