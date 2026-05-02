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
  | 'cost-summary'
  | `canvas-${string}`

export interface PanelRect {
  x: number
  y: number
  w: number
  h: number
  z: number
  s?: number
  /** When true, this window does not render the panel (it lives on a different instance). */
  hidden?: boolean
}

export type PanelLayoutMap = Partial<Record<PanelId, PanelRect>>

export interface PanelLayoutAPI {
  getPanelRect(id: PanelId, defaults: Omit<PanelRect, 'z'>): PanelRect
  setPanelRect(id: PanelId, rect: Partial<PanelRect>): void
  /** Bring the panel to the front. `currentRect` is required so that panels
   *  still using defaults (no stored entry yet) can be written with a complete
   *  rect rather than a partial one. */
  bringToFront(id: PanelId, currentRect: PanelRect): void
  resetLayout(): void
  saveLayout(): void
  hardResetLayout(): void
  hasSavedLayout(): boolean
  sendPanelToNext(id: PanelId): string | null
  sendPanelToPrev(id: PanelId): string | null
  /** Tile every visible non-top-bar panel into equal slices of the area
   *  below the top bar. `axis: 'vertical'` stacks them top-to-bottom (full
   *  width each); `axis: 'horizontal'` lays them side-by-side (full height
   *  each). Hidden panels and the top-bar itself are skipped. */
  tilePanels(axis: 'horizontal' | 'vertical'): void
  /** Other live session ids paired with this window (host and/or attachers). */
  otherInstances: string[]
  /** This window's own session id. */
  instanceId: string
  /** True when this page load minted a brand-new session id (no `?session=` in the URL). */
  isFreshInstance: boolean
  /** Optional host session id from `?host=` URL param. Null when this window is standalone. */
  hostId: string | null
  /** True when `?host=<id>` was supplied but no layout for that id exists in localStorage. */
  hostNotFound: boolean
  /** True when this window booted as an empty attachment (has `?host=<id>` and no
   *  stored layout for its own session id), meaning it should remain blank until
   *  the host sends panels via `→`. Becomes false once anything is sent in or the
   *  user does some other action that writes layout state. */
  bootedAsAttached: boolean
  /** Live map of all stored panel rects. */
  panels: PanelLayoutMap
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = 'agent-flow:layout:v1:'
const SAVED_PREFIX = 'agent-flow:layout:saved:v1:'
const COMMAND_PREFIX = 'agent-flow:command:'
const PEERS_PREFIX = 'agent-flow:peers:v1:'
const HEARTBEAT_MS = 5000
const STALE_MS = 30000
const MAX_Z = 9999

/** Panels that should be pre-hidden on a fresh attach (`?host=<id>` with no `?session=`):
 *  the new window starts blank, waiting for the host to `→` panels to it. */
const ALL_PANEL_IDS: PanelId[] = [
  'top-bar', 'message-feed', 'agent-detail', 'agent-chat',
  'file-attention', 'session-transcript', 'timeline',
]

// ─── URL / session id ──────────────────────────────────────────────────────────

let _wasFreshInstance = false

function readUrlIds(): { sessionId: string; hostId: string | null } {
  if (typeof window === 'undefined') return { sessionId: 'ssr', hostId: null }
  const url = new URL(window.location.href)
  const hostId = url.searchParams.get('host')
  const existing = url.searchParams.get('session')
  if (existing) return { sessionId: existing, hostId }
  _wasFreshInstance = true
  return { sessionId: Math.random().toString(36).slice(2, 10), hostId }
}

const { sessionId: INSTANCE_ID, hostId: HOST_ID } = readUrlIds()
const IS_FRESH_INSTANCE: boolean = _wasFreshInstance
const STORAGE_KEY = `${STORAGE_PREFIX}${INSTANCE_ID}`
const SAVED_KEY = `${SAVED_PREFIX}${INSTANCE_ID}`
const MY_COMMAND_KEY = `${COMMAND_PREFIX}${INSTANCE_ID}`
const MY_PEERS_KEY = `${PEERS_PREFIX}${INSTANCE_ID}`
const HOST_PEERS_KEY = HOST_ID ? `${PEERS_PREFIX}${HOST_ID}` : null

// ─── Context ───────────────────────────────────────────────────────────────────

export const PanelLayoutContext = createContext<PanelLayoutAPI | null>(null)

export function usePanelLayout(): PanelLayoutAPI {
  const ctx = useContext(PanelLayoutContext)
  if (!ctx) throw new Error('usePanelLayout must be used within a PanelLayoutProvider')
  return ctx
}

// ─── Storage helpers ───────────────────────────────────────────────────────────

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

function loadSaved(): PanelLayoutMap | null {
  if (typeof window === 'undefined') return null
  try {
    const own = localStorage.getItem(SAVED_KEY)
    if (own) return JSON.parse(own) as PanelLayoutMap
  } catch { /* ignore */ }
  return null
}

function writeSaved(map: PanelLayoutMap | null) {
  if (typeof window === 'undefined') return
  try {
    if (map === null) {
      localStorage.removeItem(SAVED_KEY)
      return
    }
    localStorage.setItem(SAVED_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

/** A session "exists" (and can be host-joined) iff it has ever booted in this browser
 *  and not been hard-reset. Boot writes an empty layout entry so the key is present
 *  from the first paint. */
function sessionExists(sessionId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${sessionId}`) !== null
  } catch { return false }
}

/** Ensure this session's STORAGE_KEY is present (as an empty map if no prior state),
 *  so that other windows opening with `?host=<INSTANCE_ID>` can validate us. */
function ensureSelfRegistered() {
  if (typeof window === 'undefined') return
  try {
    if (localStorage.getItem(STORAGE_KEY) === null) {
      localStorage.setItem(STORAGE_KEY, '{}')
    }
  } catch { /* ignore */ }
}

// ─── Peer registry (per-session) ───────────────────────────────────────────────

type PeerMap = Record<string, { lastSeen: number }>

function readPeerMap(key: string): PeerMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as PeerMap
  } catch { /* ignore */ }
  return {}
}

function writePeerMap(key: string, map: PeerMap) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(map))
  } catch { /* ignore */ }
}

function pruneStale(map: PeerMap): PeerMap {
  const cutoff = Date.now() - STALE_MS
  for (const k of Object.keys(map)) {
    if (map[k].lastSeen < cutoff) delete map[k]
  }
  return map
}

/** Heartbeat: if we have a host, register self in host's peers; prune stale entries
 *  from our own peers (entries written by attachers). */
function heartbeat(): void {
  const now = Date.now()
  if (HOST_PEERS_KEY) {
    const map = readPeerMap(HOST_PEERS_KEY)
    map[INSTANCE_ID] = { lastSeen: now }
    pruneStale(map)
    writePeerMap(HOST_PEERS_KEY, map)
  }
  // Always prune our own peers map so dead attachers fall out.
  const own = readPeerMap(MY_PEERS_KEY)
  if (Object.keys(own).length > 0) {
    pruneStale(own)
    writePeerMap(MY_PEERS_KEY, own)
  }
}

/** Compute the live peer list: host (if set), siblings of host, and our own attachers.
 *  Excludes self. */
function readLivePeers(): string[] {
  const set = new Set<string>()
  if (HOST_ID) set.add(HOST_ID)
  if (HOST_PEERS_KEY) {
    const siblings = pruneStale(readPeerMap(HOST_PEERS_KEY))
    for (const id of Object.keys(siblings)) {
      if (id !== INSTANCE_ID) set.add(id)
    }
  }
  const attachers = pruneStale(readPeerMap(MY_PEERS_KEY))
  for (const id of Object.keys(attachers)) {
    if (id !== INSTANCE_ID) set.add(id)
  }
  return [...set].sort()
}

function unregister() {
  if (typeof window === 'undefined') return
  if (!HOST_PEERS_KEY) return
  try {
    const map = readPeerMap(HOST_PEERS_KEY)
    delete map[INSTANCE_ID]
    writePeerMap(HOST_PEERS_KEY, map)
  } catch { /* ignore */ }
}

// ─── Cross-window commands ─────────────────────────────────────────────────────

type Command =
  | { type: 'show-panel'; panelId: PanelId; rect?: Partial<PanelRect>; from: string; ts: number }

function sendCommand(targetId: string, cmd: Command) {
  if (typeof window === 'undefined') return
  try {
    const key = `${COMMAND_PREFIX}${targetId}`
    const existing = localStorage.getItem(key)
    const queue: Command[] = existing ? JSON.parse(existing) : []
    queue.push(cmd)
    localStorage.setItem(key, JSON.stringify(queue))
  } catch { /* ignore */ }
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function usePanelLayoutState(): PanelLayoutAPI {
  // SSR-safe initial state. Client values populate in the boot effect.
  const [panels, setPanels] = useState<PanelLayoutMap>({})
  const panelsRef = useRef(panels)
  panelsRef.current = panels

  const [otherInstances, setOtherInstances] = useState<string[]>([])
  const [hostNotFound, setHostNotFound] = useState(false)
  const [bootedAsAttached, setBootedAsAttached] = useState(false)

  // Sync `?session=<id>` URL param post-hydration. Next.js's app router can
  // revert module-level history.replaceState, so we do it from an effect.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('session') === INSTANCE_ID) return
    url.searchParams.set('session', INSTANCE_ID)
    window.history.replaceState({}, '', url.toString())
  }, [])

  // Boot: validate host (if any), register self, hydrate stored layout.
  // Attach with no stored layout (`?host=<id>` set, own STORAGE_KEY empty)
  // starts blank — every panel is marked `hidden:true` so the new window is
  // empty until the host sends panels via `→`. Bookmarked attachments with
  // a saved layout restore that layout instead.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (HOST_ID && !sessionExists(HOST_ID)) {
      setHostNotFound(true)
      return
    }
    ensureSelfRegistered()
    const stored = loadFromStorage()
    if (HOST_ID && Object.keys(stored).length === 0) {
      const allHidden: PanelLayoutMap = {}
      for (const id of ALL_PANEL_IDS) {
        allHidden[id] = { x: 0, y: 0, w: 0, h: 0, z: 10, hidden: true }
      }
      saveToStorage(allHidden)
      setPanels(allHidden)
      setBootedAsAttached(true)
      return
    }
    if (Object.keys(stored).length > 0) {
      setPanels(stored)
    }
  }, [])

  // Heartbeat: maintain peer registration and refresh peer list.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (hostNotFound) return
    const tick = () => {
      heartbeat()
      const next = readLivePeers()
      setOtherInstances(prev => {
        if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev
        return next
      })
    }
    tick()
    const interval = setInterval(tick, HEARTBEAT_MS)
    const onUnload = () => unregister()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      clearInterval(interval)
      window.removeEventListener('beforeunload', onUnload)
      unregister()
    }
  }, [hostNotFound])

  // Debounced persist
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleSave = useCallback((map: PanelLayoutMap) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveToStorage(map), 250)
  }, [])

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

  const bringToFront = useCallback((id: PanelId, currentRect: PanelRect) => {
    setPanels(prev => {
      let maxZ = 0
      for (const key in prev) {
        const z = prev[key as PanelId]?.z ?? 0
        if (z > maxZ) maxZ = z
      }
      const currentZ = prev[id]?.z ?? 0
      if (currentZ >= maxZ && currentZ > 0) return prev

      let nextZ = maxZ + 1
      // Renumber when z gets too high to avoid overflow.
      if (nextZ > MAX_Z) {
        const entries = Object.entries(prev) as [PanelId, PanelRect][]
        entries.sort((a, b) => a[1].z - b[1].z)
        const renumbered: PanelLayoutMap = {}
        entries.forEach(([key, val], i) => {
          renumbered[key] = { ...val, z: 10 + i }
        })
        nextZ = 10 + entries.length
        const base = renumbered[id] ?? prev[id] ?? currentRect
        const result = { ...renumbered, [id]: { ...base, z: nextZ } }
        scheduleSave(result)
        return result
      }

      const base = prev[id] ?? currentRect
      const next = { ...prev, [id]: { ...base, z: nextZ } }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const resetLayout = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    const saved = loadSaved()
    if (saved) {
      setPanels(saved)
      saveToStorage(saved)
      return
    }
    setPanels({})
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(STORAGE_KEY, '{}') } catch { /* ignore */ }
    }
  }, [])

  const saveLayout = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    writeSaved(panelsRef.current)
  }, [])

  const hardResetLayout = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    setPanels({})
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
      try { localStorage.removeItem(MY_PEERS_KEY) } catch { /* ignore */ }
    }
    writeSaved(null)
  }, [])

  const hasSavedLayout = useCallback(() => loadSaved() !== null, [])

  // Listen for incoming commands targeted at us.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e: StorageEvent) => {
      if (e.key !== MY_COMMAND_KEY) return
      if (!e.newValue) return
      try {
        const queue: Command[] = JSON.parse(e.newValue)
        if (!Array.isArray(queue) || queue.length === 0) return
        for (const cmd of queue) {
          if (cmd.type === 'show-panel') {
            setPanels(prev => {
              const existing = prev[cmd.panelId]
              const incoming = cmd.rect
              const merged: PanelRect = {
                x: incoming?.x ?? existing?.x ?? 0,
                y: incoming?.y ?? existing?.y ?? 0,
                w: incoming?.w ?? existing?.w ?? 0,
                h: incoming?.h ?? existing?.h ?? 0,
                z: existing?.z ?? 10,
                s: incoming?.s ?? existing?.s,
                hidden: false,
              }
              return { ...prev, [cmd.panelId]: merged }
            })
            window.dispatchEvent(new CustomEvent('agent-flow:show-panel', { detail: { panelId: cmd.panelId } }))
          }
        }
        try { localStorage.setItem(MY_COMMAND_KEY, '[]') } catch { /* ignore */ }
      } catch { /* ignore */ }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const sendPanelInDirection = useCallback((id: PanelId, dir: 1 | -1): string | null => {
    if (otherInstances.length === 0) return null
    const all = [...otherInstances, INSTANCE_ID].sort()
    const myIdx = all.indexOf(INSTANCE_ID)
    const target = all[(myIdx + dir + all.length) % all.length]
    if (target === INSTANCE_ID) return null
    setPanels(prev => {
      const existing = prev[id] ?? { x: 0, y: 0, w: 100, h: 100, z: 10 }
      const next = { ...prev, [id]: { ...existing, hidden: true } }
      scheduleSave(next)
      return next
    })
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('agent-flow:hide-panel', { detail: { panelId: id } }))
    }
    const sourceRect = panelsRef.current[id]
    const forwardRect: Partial<PanelRect> | undefined = sourceRect
      ? { x: sourceRect.x, y: sourceRect.y, w: sourceRect.w, h: sourceRect.h, s: sourceRect.s, hidden: false }
      : undefined
    sendCommand(target, {
      type: 'show-panel',
      panelId: id,
      rect: forwardRect,
      from: INSTANCE_ID,
      ts: Date.now(),
    })
    return target
  }, [otherInstances, scheduleSave])

  const sendPanelToNext = useCallback((id: PanelId) => sendPanelInDirection(id, 1), [sendPanelInDirection])
  const sendPanelToPrev = useCallback((id: PanelId) => sendPanelInDirection(id, -1), [sendPanelInDirection])

  const tilePanels = useCallback((axis: 'horizontal' | 'vertical') => {
    if (typeof window === 'undefined') return
    setPanels(prev => {
      const candidates: PanelId[] = []
      for (const key of Object.keys(prev) as PanelId[]) {
        if (key === 'top-bar') continue
        const r = prev[key]
        if (!r || r.hidden || r.w <= 0 || r.h <= 0) continue
        candidates.push(key)
      }
      if (candidates.length === 0) return prev

      // Stable, intuitive order: sort by current top-left in the tiling axis,
      // so the panel currently leftmost stays leftmost (horizontal) or
      // topmost stays topmost (vertical).
      candidates.sort((a, b) => {
        const ra = prev[a]!, rb = prev[b]!
        return axis === 'horizontal' ? ra.x - rb.x : ra.y - rb.y
      })

      const topBar = prev['top-bar']
      const topBarBottom = topBar && !topBar.hidden ? topBar.y + topBar.h : 0
      const margin = 12
      const gap = 8
      const availX = margin
      const availY = topBarBottom + margin
      const availW = Math.max(100, window.innerWidth - margin * 2)
      const availH = Math.max(100, window.innerHeight - availY - margin)

      const next: PanelLayoutMap = { ...prev }
      const n = candidates.length
      if (axis === 'horizontal') {
        const totalGap = gap * (n - 1)
        const slice = Math.floor((availW - totalGap) / n)
        candidates.forEach((id, i) => {
          const base = prev[id]!
          next[id] = {
            ...base,
            x: availX + i * (slice + gap),
            y: availY,
            w: slice,
            h: availH,
            hidden: false,
          }
        })
      } else {
        const totalGap = gap * (n - 1)
        const slice = Math.floor((availH - totalGap) / n)
        candidates.forEach((id, i) => {
          const base = prev[id]!
          next[id] = {
            ...base,
            x: availX,
            y: availY + i * (slice + gap),
            w: availW,
            h: slice,
            hidden: false,
          }
        })
      }
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  return {
    getPanelRect, setPanelRect, bringToFront,
    resetLayout, saveLayout, hardResetLayout, hasSavedLayout,
    sendPanelToNext, sendPanelToPrev, tilePanels, otherInstances, instanceId: INSTANCE_ID,
    isFreshInstance: IS_FRESH_INSTANCE,
    hostId: HOST_ID,
    hostNotFound,
    bootedAsAttached,
    panels,
  }
}
