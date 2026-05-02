'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePanelLayout } from './use-panel-layout'

// Default for unseen workspaces is HIDDEN so a page load that sees a brand
// new cwd doesn't auto-mount its canvas. Explicit user toggles ARE persisted
// across reloads, so once a workspace is shown it stays shown.
//
// Storage key is scoped per instance (browser-window/session id from
// panel-layout) so that each window has its own visibility state. Two tabs
// of the same app no longer overwrite each other's selections.
//
// v3 bumps the schema once again to drop the cross-instance v2 saves, which
// were single-key globals that caused exactly that interference.

const STORAGE_PREFIX = 'agent-flow:workspace-filter:v3:'

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

function load(key: string): Stored {
  if (typeof window === 'undefined') return { visibility: {}, knownCwds: [] }
  try {
    const raw = localStorage.getItem(key)
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

function save(key: string, stored: Stored) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, JSON.stringify(stored)) } catch { /* ignore */ }
}

export function useWorkspaceFilter(): WorkspaceFilterAPI {
  const { instanceId } = usePanelLayout()
  const storageKey = useMemo(() => `${STORAGE_PREFIX}${instanceId}`, [instanceId])
  const storageKeyRef = useRef(storageKey)
  storageKeyRef.current = storageKey

  const [visibility, setVisibilityState] = useState<Record<string, boolean>>({})
  const [seen, setSeen] = useState<Set<string>>(() => new Set())

  // Seed both visibility and seen from this instance's prior storage on mount
  // (or whenever the instance id ever changes — practically just once).
  useEffect(() => {
    const stored = load(storageKey)
    setVisibilityState(stored.visibility)
    setSeen(new Set(stored.knownCwds))
  }, [storageKey])

  // Debounced persist (per-instance)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((vis: Record<string, boolean>, cwds: Set<string>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(
      () => save(storageKeyRef.current, { visibility: vis, knownCwds: [...cwds] }),
      200,
    )
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

  // Memoize the return so its identity only changes when an underlying member
  // does. Without this, every render of `useAgentSimulation` (≈ every state
  // commit) would return a fresh object and cascade-invalidate all the memos
  // in `AgentVisualizerInner` that depend on `workspaceFilter`.
  return useMemo(
    () => ({ knownWorkspaces, isVisible, setVisibility, showAll, isolate, registerCwd }),
    [knownWorkspaces, isVisible, setVisibility, showAll, isolate, registerCwd],
  )
}
