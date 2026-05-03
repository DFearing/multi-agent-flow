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
  _wouldHitOverlayCacheForTest,
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

// ─── Overlay cache hit-rate regression ────────────────────────────────────
// Verifies that the quantized dataHash scheme produces cache HITs when the
// underlying values change by less than the visible quantum (PR #63 fix).

describe('overlay cache hit rate (quantization regression)', () => {
  beforeEach(() => {
    _resetOverlayCacheForTest()
  })

  /**
   * Simulate the stats overlay dataHash construction from draw-agents.ts:
   *   const timeSec = Math.floor(agent.timeAlive)
   *   const statsText = `${agent.toolCalls} tools · ${timeSec}s`
   *   const dataHash = `stats|${statsText}`
   */
  function statsDataHash(toolCalls: number, timeAlive: number): string {
    const timeSec = Math.floor(timeAlive)
    return `stats|${toolCalls} tools · ${timeSec}s`
  }

  /**
   * Simulate the cost overlay dataHash construction from draw-cost.ts:
   *   const label = `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`
   *   toolHash quantized to nearest 1000 tokens
   *   const dataHash = `cost|${label}|${toolHash}`
   */
  function costDataHash(cost: number, toolTokens: Map<string, number>): string {
    const label = `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`
    const toolHash = Array.from(toolTokens.entries())
      .map(([n, t]) => `${n}:${Math.round(t / 1000)}`)
      .join(',')
    return `cost|${label}|${toolHash}`
  }

  it('stats overlay HITs when timeAlive changes sub-second (e.g. 12.34 → 12.78)', () => {
    const agentId = 'agent-1'
    const key = overlayKey('stats', agentId)
    const hash1 = statsDataHash(5, 12.34)
    _insertOverlayStubForTest(key, hash1)

    // Sub-second change: 12.34 → 12.78 (same integer second)
    const hash2 = statsDataHash(5, 12.78)
    expect(hash1).toBe(hash2) // hashes must be identical
    expect(_wouldHitOverlayCacheForTest(key, hash2)).toBe(true)
  })

  it('stats overlay MISSES when timeAlive crosses a second boundary (12.9 → 13.1)', () => {
    const agentId = 'agent-1'
    const key = overlayKey('stats', agentId)
    const hash1 = statsDataHash(5, 12.9)
    _insertOverlayStubForTest(key, hash1)

    const hash2 = statsDataHash(5, 13.1)
    expect(hash1).not.toBe(hash2)
    expect(_wouldHitOverlayCacheForTest(key, hash2)).toBe(false)
  })

  it('stats overlay MISSES when toolCalls changes', () => {
    const agentId = 'agent-1'
    const key = overlayKey('stats', agentId)
    const hash1 = statsDataHash(5, 20.5)
    _insertOverlayStubForTest(key, hash1)

    const hash2 = statsDataHash(6, 20.5)
    expect(_wouldHitOverlayCacheForTest(key, hash2)).toBe(false)
  })

  it('cost overlay HITs when tool tokens change by less than 1000', () => {
    const agentId = 'agent-1'
    const key = overlayKey('cost', agentId)
    // 5100 / 1000 = 5.1 → rounds to 5;  5400 / 1000 = 5.4 → rounds to 5
    const tools1 = new Map([['Read', 5100], ['Bash', 3000]])
    const hash1 = costDataHash(0.05, tools1)
    _insertOverlayStubForTest(key, hash1)

    // Sub-quantum change: +300 tokens to Read (5100 → 5400), still rounds to 5
    const tools2 = new Map([['Read', 5400], ['Bash', 3000]])
    const hash2 = costDataHash(0.05, tools2)
    expect(hash1).toBe(hash2)
    expect(_wouldHitOverlayCacheForTest(key, hash2)).toBe(true)
  })

  it('cost overlay MISSES when tool tokens cross a 1000-token boundary', () => {
    const agentId = 'agent-1'
    const key = overlayKey('cost', agentId)
    const tools1 = new Map([['Read', 4800]])
    const hash1 = costDataHash(0.05, tools1)
    _insertOverlayStubForTest(key, hash1)

    // Cross the 5000 boundary: 4800 rounds to 5, 5500 rounds to 6
    const tools2 = new Map([['Read', 5500]])
    const hash2 = costDataHash(0.05, tools2)
    expect(hash1).not.toBe(hash2)
    expect(_wouldHitOverlayCacheForTest(key, hash2)).toBe(false)
  })

  it('cost overlay MISSES when the formatted cost label changes', () => {
    const agentId = 'agent-1'
    const key = overlayKey('cost', agentId)
    const tools = new Map([['Read', 5000]])
    const hash1 = costDataHash(0.043, tools)
    _insertOverlayStubForTest(key, hash1)

    const hash2 = costDataHash(0.044, tools)
    expect(_wouldHitOverlayCacheForTest(key, hash2)).toBe(false)
  })
})
