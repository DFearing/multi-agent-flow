/**
 * Unit tests for render-cache overlay key/prune logic.
 *
 * Run with: cd web && pnpm test
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  overlayKey,
  pruneOverlayCache,
  overlayCacheSize,
  _resetOverlayCacheForTest,
  _insertOverlayStubForTest,
} from './render-cache'

// ─── overlayKey ─────────────────────────────────────────────────────────────

describe('overlayKey', () => {
  it('produces a string containing a NUL separator', () => {
    const key = overlayKey('stats', 'abc-123')
    expect(key).toBe('stats\0abc-123')
  })

  it('handles agent ids with leading hyphens', () => {
    const key = overlayKey('cost', '-leading-hyphen')
    expect(key).toBe('cost\0-leading-hyphen')
  })

  it('handles agent ids that are entirely hyphens', () => {
    const key = overlayKey('stats', '---')
    expect(key).toBe('stats\0---')
  })
})

// ─── pruneOverlayCache ─────────────────────────────────────────────────────

describe('pruneOverlayCache', () => {
  beforeEach(() => {
    _resetOverlayCacheForTest()
  })

  /** Helper: insert a stub overlay entry keyed by (prefix, agentId). */
  function insertOverlay(prefix: string, agentId: string): void {
    _insertOverlayStubForTest(overlayKey(prefix, agentId))
  }

  it('retains entries for active agents', () => {
    insertOverlay('stats', 'a1')
    insertOverlay('cost', 'a1')
    expect(overlayCacheSize()).toBe(2)

    pruneOverlayCache(new Set(['a1']))
    expect(overlayCacheSize()).toBe(2)
  })

  it('evicts entries for despawned agents', () => {
    insertOverlay('stats', 'a1')
    insertOverlay('stats', 'a2')
    expect(overlayCacheSize()).toBe(2)

    pruneOverlayCache(new Set(['a1']))
    expect(overlayCacheSize()).toBe(1)
  })

  it('correctly handles agent ids containing hyphens (UUID-style)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    insertOverlay('stats', uuid)
    insertOverlay('cost', uuid)
    expect(overlayCacheSize()).toBe(2)

    // Agent is active -- both entries must survive
    pruneOverlayCache(new Set([uuid]))
    expect(overlayCacheSize()).toBe(2)

    // Agent despawns -- both entries must be evicted
    pruneOverlayCache(new Set())
    expect(overlayCacheSize()).toBe(0)
  })

  it('correctly handles agent ids with leading hyphens', () => {
    const id = '-leading-hyphen-agent'
    insertOverlay('stats', id)
    insertOverlay('cost', id)

    pruneOverlayCache(new Set([id]))
    expect(overlayCacheSize()).toBe(2)

    pruneOverlayCache(new Set())
    expect(overlayCacheSize()).toBe(0)
  })

  it('correctly handles agent ids that match a prefix name', () => {
    // Edge case: agent id is literally "stats" or "cost"
    insertOverlay('stats', 'stats')
    insertOverlay('cost', 'cost')

    pruneOverlayCache(new Set(['stats', 'cost']))
    expect(overlayCacheSize()).toBe(2)

    pruneOverlayCache(new Set())
    expect(overlayCacheSize()).toBe(0)
  })

  it('handles mixed active/despawned agents efficiently', () => {
    for (let i = 0; i < 20; i++) {
      insertOverlay('stats', `agent-${i}`)
      insertOverlay('cost', `agent-${i}`)
    }
    expect(overlayCacheSize()).toBe(40)

    // Keep only even-numbered agents
    const active = new Set<string>()
    for (let i = 0; i < 20; i += 2) active.add(`agent-${i}`)

    pruneOverlayCache(active)
    expect(overlayCacheSize()).toBe(20) // 10 agents * 2 overlays each
  })
})
