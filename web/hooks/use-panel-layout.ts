'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PanelId =
  | 'top-bar'
  | 'message-feed'
  | 'agent-detail'
  | 'agent-chat'
  | 'file-attention'
  | 'session-transcript'
  | 'timeline'
  | 'control-bar'

export interface PanelRect {
  x: number
  y: number
  w: number
  h: number
  z: number
}

export type PanelLayoutMap = Partial<Record<PanelId, PanelRect>>

export interface PanelLayoutAPI {
  getPanelRect(id: PanelId, defaults: Omit<PanelRect, 'z'>): PanelRect
  setPanelRect(id: PanelId, rect: Partial<PanelRect>): void
  bringToFront(id: PanelId): void
  resetLayout(): void
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'agent-flow:layout:v1'
const MAX_Z = 9999

// ─── Context ───────────────────────────────────────────────────────────────────

export const PanelLayoutContext = createContext<PanelLayoutAPI | null>(null)

export function usePanelLayout(): PanelLayoutAPI {
  const ctx = useContext(PanelLayoutContext)
  if (!ctx) throw new Error('usePanelLayout must be used within a PanelLayoutProvider')
  return ctx
}

// ─── Hook (used inside provider component) ─────────────────────────────────────

function loadFromStorage(): PanelLayoutMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as PanelLayoutMap
  } catch { /* ignore */ }
  return {}
}

function saveToStorage(map: PanelLayoutMap) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

export function usePanelLayoutState(): PanelLayoutAPI {
  const [panels, setPanels] = useState<PanelLayoutMap>(() => loadFromStorage())
  const panelsRef = useRef(panels)
  panelsRef.current = panels

  // Debounced persist
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((map: PanelLayoutMap) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveToStorage(map), 250)
  }, [])

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  const getPanelRect = useCallback((id: PanelId, defaults: Omit<PanelRect, 'z'>): PanelRect => {
    const stored = panelsRef.current[id]
    if (stored) return stored
    return { ...defaults, z: 10 }
  }, [])

  const setPanelRect = useCallback((id: PanelId, rect: Partial<PanelRect>) => {
    setPanels(prev => {
      const existing = prev[id] ?? { x: 0, y: 0, w: 100, h: 100, z: 10 }
      const next = { ...prev, [id]: { ...existing, ...rect } }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const bringToFront = useCallback((id: PanelId) => {
    setPanels(prev => {
      // Find the current max z
      let maxZ = 0
      for (const key in prev) {
        const z = prev[key as PanelId]?.z ?? 0
        if (z > maxZ) maxZ = z
      }
      const currentZ = prev[id]?.z ?? 0
      // Already on top
      if (currentZ >= maxZ && currentZ > 0) return prev

      let nextZ = maxZ + 1
      // Clamp: if z gets too high, renumber everything
      if (nextZ > MAX_Z) {
        const entries = Object.entries(prev) as [PanelId, PanelRect][]
        entries.sort((a, b) => a[1].z - b[1].z)
        const renumbered: PanelLayoutMap = {}
        entries.forEach(([key, val], i) => {
          renumbered[key] = { ...val, z: 10 + i }
        })
        nextZ = 10 + entries.length
        const result = { ...renumbered, [id]: { ...(renumbered[id] ?? prev[id] ?? { x: 0, y: 0, w: 100, h: 100 }), z: nextZ } }
        scheduleSave(result)
        return result
      }

      const existing = prev[id]
      if (!existing) return prev
      const next = { ...prev, [id]: { ...existing, z: nextZ } }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const resetLayout = useCallback(() => {
    setPanels({})
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    }
  }, [])

  return { getPanelRect, setPanelRect, bringToFront, resetLayout }
}
