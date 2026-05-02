'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Default for unseen workspaces is HIDDEN so a page load that sees a brand
// new cwd doesn't auto-mount its canvas. Explicit user toggles ARE persisted
// across reloads, so once a workspace is shown it stays shown.
//
// Storage key is versioned: pre-v2 saves used a "visibility" map where the
// implicit default was `true`. Loading those would re-show every previously
// seen workspace, which defeats the point — we drop them and start fresh.

const STORAGE_KEY = 'agent-flow:workspace-filter:v2'

interface Stored {
  /** Sparse map: missing cwds default to hidden. */
  visibility: Record<string, boolean>
  /** All cwds we've ever seen — drives the dropdown population. */
  knownCwds: string[]
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
  if (typeof window === 'undefined') return { visibility: {}, knownCwds: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>
      return {
        visibility: parsed.visibility ?? {},
        knownCwds: parsed.knownCwds ?? Object.keys(parsed.visibility ?? {}),
      }
    }
  } catch { /* ignore */ }
  return { visibility: {}, knownCwds: [] }
}

function save(stored: Stored) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)) } catch { /* ignore */ }
}

export function useWorkspaceFilter(): WorkspaceFilterAPI {
  const [visibility, setVisibilityState] = useState<Record<string, boolean>>({})
  const [seen, setSeen] = useState<Set<string>>(() => new Set())

  // Seed both visibility and seen from prior storage on mount.
  useEffect(() => {
    const stored = load()
    setVisibilityState(stored.visibility)
    setSeen(new Set(stored.knownCwds))
  }, [])

  // Debounced persist
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((vis: Record<string, boolean>, cwds: Set<string>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => save({ visibility: vis, knownCwds: [...cwds] }), 200)
  }, [])
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  const registerCwd = useCallback((cwd: string) => {
    if (!cwd) return
    setSeen(prev => {
      if (prev.has(cwd)) return prev
      const next = new Set(prev).add(cwd)
      // Persist the membership update — visibility for this cwd stays absent
      // (= hidden by default) until the user toggles it.
      setVisibilityState(curVis => {
        scheduleSave(curVis, next)
        return curVis
      })
      return next
    })
  }, [scheduleSave])

  const knownWorkspaces = useMemo(() => [...seen].sort(), [seen])

  const isVisible = useCallback((cwd: string | undefined): boolean => {
    if (!cwd) return true
    const v = visibility[cwd]
    return v === undefined ? false : v
  }, [visibility])

  const setVisibility = useCallback((cwd: string, visible: boolean) => {
    setVisibilityState(prev => {
      const next = { ...prev, [cwd]: visible }
      setSeen(curSeen => {
        const nextSeen = curSeen.has(cwd) ? curSeen : new Set(curSeen).add(cwd)
        scheduleSave(next, nextSeen)
        return nextSeen
      })
      return next
    })
  }, [scheduleSave])

  const showAll = useCallback(() => {
    setVisibilityState(prev => {
      const next: Record<string, boolean> = { ...prev }
      for (const cwd of seen) next[cwd] = true
      scheduleSave(next, seen)
      return next
    })
  }, [scheduleSave, seen])

  const isolate = useCallback((target: string) => {
    setVisibilityState(prev => {
      const next: Record<string, boolean> = { ...prev }
      for (const cwd of seen) next[cwd] = false
      next[target] = true
      scheduleSave(next, seen)
      return next
    })
  }, [scheduleSave, seen])

  return { knownWorkspaces, isVisible, setVisibility, showAll, isolate, registerCwd }
}
