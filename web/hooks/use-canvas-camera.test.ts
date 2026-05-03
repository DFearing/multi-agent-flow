/**
 * Unit tests for useCanvasCamera — focused on the auto-fit anchor priority.
 *
 * The anchor priority (orchestrator-idle handoff):
 *   1. selectedAgentId (existing focusScope path) trumps automatic anchor.
 *   2. If isMain agent is in an active state → anchor on main.
 *   3. Else if any sub-agent is active → anchor on first in iteration order.
 *   4. Otherwise → main if present, else first agent.
 *
 * Strategy: render the real hook, drive it through its public surface
 * (doZoomToFit + updateCamera), let the lerp settle, then reverse-engineer
 * the anchor point from the final transform:
 *   transform.x = dimensions.width / 2  - anchorX * scale
 *   ⇒ anchorX = (dimensions.width / 2 - transform.x) / scale
 *
 * No mocks — agents/toolCalls/discoveries are pure data (per spec).
 */

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCanvasCamera } from './use-canvas-camera'
import type { Agent, AgentState, ToolCallNode, Discovery } from '@/lib/agent-types'
import { emptyContextBreakdown, isActiveAgentState, ACTIVE_AGENT_STATES } from '@/lib/agent-types'

// ─── Fixtures ──────────────────────────────────────────────────────────────

const DIMENSIONS = { width: 800, height: 600 }

/** Minimal Agent factory — provides defaults for fields not relevant to anchor logic. */
function makeAgent(overrides: Partial<Agent> & { id: string; isMain: boolean; x: number; y: number }): Agent {
  return {
    name: overrides.id,
    state: 'idle' satisfies AgentState,
    parentId: overrides.isMain ? null : 'main',
    tokensUsed: 0,
    tokensMax: 200_000,
    contextBreakdown: emptyContextBreakdown(),
    toolCalls: 0,
    timeAlive: 0,
    vx: 0, vy: 0,
    pinned: false,
    spawnTime: 0,
    opacity: 1,
    scale: 1,
    messageBubbles: [],
    ...overrides,
  }
}

/** Stub HTMLElement with the methods the hook needs. */
function createElementStub(): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      left: 0, top: 0, right: DIMENSIONS.width, bottom: DIMENSIONS.height,
      width: DIMENSIONS.width, height: DIMENSIONS.height, x: 0, y: 0, toJSON: () => ({}),
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLElement
}

/** Build the drawPropsRef shape the hook expects. */
function makeDrawPropsRef(agents: Map<string, Agent>, selectedAgentId: string | null = null) {
  return {
    current: {
      agents,
      toolCalls: new Map<string, ToolCallNode>(),
      discoveries: [] as Discovery[],
      dimensions: DIMENSIONS,
      selectedAgentId,
      pauseAutoFit: false,
      isDragging: false,
    },
  }
}

/**
 * Render the hook, run zoom-to-fit, and lerp to convergence.
 *
 * Returns the final transform plus the inferred anchor point so callers can
 * assert on either.
 */
function settleCamera(agents: Map<string, Agent>, selectedAgentId: string | null = null) {
  const mainCanvasRef = { current: createElementStub() }
  const drawPropsRef = makeDrawPropsRef(agents, selectedAgentId)
  const simTimeRef = { current: 0 }

  const { result } = renderHook(() =>
    useCanvasCamera({
      mainCanvasRef,
      drawPropsRef,
      simTimeRef,
      dimensions: DIMENSIONS,
      agentCount: agents.size,
      selectedAgentId,
    }),
  )

  // Snap initial transform to a known anchor so the lerp converges. The hook
  // initializes transform to (w/2, h/2, 1) on first agentCount > 0 effect.
  // Trigger zoom-to-fit, then iterate updateCamera until the lerp snaps to
  // target (the snap epsilon is small enough that ~500 iterations suffice
  // for any starting transform).
  act(() => {
    result.current.doZoomToFit()
    for (let i = 0; i < 500; i++) {
      result.current.updateCamera(false, false)
    }
  })

  const t = result.current.transformRef.current
  const anchorX = (DIMENSIONS.width / 2 - t.x) / t.scale
  const anchorY = (DIMENSIONS.height / 2 - t.y) / t.scale
  return { transform: t, anchorX, anchorY }
}

/** Compare an inferred anchor to an expected agent's coordinates. */
function expectAnchoredOn(actual: { anchorX: number; anchorY: number }, expected: Agent): void {
  // Lerp snaps when |delta| < 0.5px (translation), so 1px tolerance is safe.
  expect(actual.anchorX).toBeCloseTo(expected.x, 0)
  expect(actual.anchorY).toBeCloseTo(expected.y, 0)
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('useCanvasCamera auto-fit anchor priority', () => {
  it('case 1: orchestrator (isMain) in active state — anchor on orchestrator', () => {
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'thinking' })
    const sub = makeAgent({ id: 'sub-1', isMain: false, x: 500, y: 400, state: 'tool_calling' })
    const agents = new Map([[main.id, main], [sub.id, sub]])

    const result = settleCamera(agents)
    expectAnchoredOn(result, main)
  })

  it('case 2: orchestrator idle + one sub-agent active — anchor on the active sub', () => {
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'idle' })
    const sub = makeAgent({ id: 'sub-1', isMain: false, x: 500, y: 400, state: 'thinking' })
    const agents = new Map([[main.id, main], [sub.id, sub]])

    const result = settleCamera(agents)
    expectAnchoredOn(result, sub)
  })

  it('case 3: orchestrator idle + multiple subs active — anchor on first in iteration order', () => {
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'idle' })
    const subA = makeAgent({ id: 'sub-a', isMain: false, x: 300, y: 300, state: 'tool_calling' })
    const subB = makeAgent({ id: 'sub-b', isMain: false, x: 700, y: 500, state: 'thinking' })
    // Map preserves insertion order; subA inserted first ⇒ should win the tie-break.
    const agents = new Map<string, Agent>()
    agents.set(main.id, main)
    agents.set(subA.id, subA)
    agents.set(subB.id, subB)

    const result = settleCamera(agents)
    expectAnchoredOn(result, subA)
  })

  it('case 4: all agents idle — anchor on orchestrator (regression coverage)', () => {
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'idle' })
    const sub = makeAgent({ id: 'sub-1', isMain: false, x: 500, y: 400, state: 'idle' })
    const agents = new Map([[main.id, main], [sub.id, sub]])

    const result = settleCamera(agents)
    expectAnchoredOn(result, main)
  })

  it('case 5: no isMain + sub-agents active — anchor on first active sub', () => {
    const subA = makeAgent({ id: 'sub-a', isMain: false, x: 200, y: 200, state: 'idle' })
    const subB = makeAgent({ id: 'sub-b', isMain: false, x: 600, y: 400, state: 'thinking' })
    const subC = makeAgent({ id: 'sub-c', isMain: false, x: 700, y: 500, state: 'tool_calling' })
    const agents = new Map<string, Agent>()
    agents.set(subA.id, subA)
    agents.set(subB.id, subB)
    agents.set(subC.id, subC)

    const result = settleCamera(agents)
    expectAnchoredOn(result, subB)
  })

  it('case 6a: selectedAgentId set — focus-scope path is unaffected by new anchor logic', () => {
    // When a non-main agent is selected, focusScope = selected + descendants.
    // The legacy main-if-in-scope-else-first rule still wins: out-of-scope
    // agents (including an active orchestrator) cannot shift the anchor.
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'thinking' })
    const subSelected = makeAgent({ id: 'sub-1', isMain: false, x: 600, y: 400, state: 'idle' })
    const subOther = makeAgent({ id: 'sub-2', isMain: false, x: 700, y: 500, state: 'thinking' })
    const agents = new Map([[main.id, main], [subSelected.id, subSelected], [subOther.id, subOther]])

    // Selecting a sub-agent activates focusScope. The orchestrator-active
    // priority must NOT override the explicit selection.
    const result = settleCamera(agents, subSelected.id)
    expectAnchoredOn(result, subSelected)
  })

  it('case 6b: selectedAgentId on sub with active descendant — anchor stays on selected (no handoff)', () => {
    // Regression guard: the new active-handoff logic must NOT apply within a
    // user-explicit focus scope. If the user selects sub-1 and its descendant
    // sub-1a is active, the anchor stays on sub-1 (legacy focus behavior),
    // not sub-1a. User intent overrides automatic handoff.
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'idle' })
    const sub1 = makeAgent({ id: 'sub-1', isMain: false, x: 400, y: 300, state: 'idle', parentId: 'main' })
    const sub1a = makeAgent({ id: 'sub-1a', isMain: false, x: 700, y: 500, state: 'thinking', parentId: 'sub-1' })
    const agents = new Map([[main.id, main], [sub1.id, sub1], [sub1a.id, sub1a]])

    const result = settleCamera(agents, sub1.id)
    // Legacy rule: no main in scope, first-in-scope wins. sub-1 is iterated
    // before sub-1a, so sub-1 is the anchor regardless of sub-1a being active.
    expectAnchoredOn(result, sub1)
  })

  it('waiting_permission counts as active — anchor on the waiting sub when orchestrator idle', () => {
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'idle' })
    const sub = makeAgent({ id: 'sub-1', isMain: false, x: 500, y: 400, state: 'waiting_permission' })
    const agents = new Map([[main.id, main], [sub.id, sub]])

    const result = settleCamera(agents)
    expectAnchoredOn(result, sub)
  })

  it('idle+complete orchestrator + idle subs — anchor on main (no active candidates)', () => {
    // Defensive: complete is not "active" — verifies the predicate doesn't
    // leak any non-listed states into the active set.
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'complete' })
    const sub = makeAgent({ id: 'sub-1', isMain: false, x: 500, y: 400, state: 'complete' })
    const agents = new Map([[main.id, main], [sub.id, sub]])

    const result = settleCamera(agents)
    expectAnchoredOn(result, main)
  })
})

describe('useCanvasCamera anchor — boundary cases', () => {
  it('single agent (orchestrator only) — anchors on the orchestrator', () => {
    // Smallest non-empty graph. Both the active-handoff and legacy fallback
    // branches should converge to the orchestrator when there are no subs.
    const main = makeAgent({ id: 'main', isMain: true, x: 250, y: 175, state: 'thinking' })
    const agents = new Map([[main.id, main]])

    const result = settleCamera(agents)
    expectAnchoredOn(result, main)
  })

  it('single sub-agent (no orchestrator) idle — anchors on the lone sub', () => {
    // Defensive: when no isMain agent exists, the legacy fallback returns
    // firstAgent. Confirms the absence-of-main path doesn't crash on a null
    // mainAgent in the active-handoff branch.
    const sub = makeAgent({ id: 'sub-1', isMain: false, x: 400, y: 300, state: 'idle' })
    const agents = new Map([[sub.id, sub]])

    const result = settleCamera(agents)
    expectAnchoredOn(result, sub)
  })

  it('zero agents — computeFitTransform returns null and the camera never moves', () => {
    // computeFitTransform's first guard (agents.size === 0 → null) must hold
    // after the anchor logic was added. Calling doZoomToFit with no agents
    // must not throw and must leave the transform at its default (0, 0, 1).
    const mainCanvasRef = { current: createElementStub() }
    const drawPropsRef = makeDrawPropsRef(new Map())
    const simTimeRef = { current: 0 }

    const { result } = renderHook(() =>
      useCanvasCamera({
        mainCanvasRef,
        drawPropsRef,
        simTimeRef,
        dimensions: DIMENSIONS,
        agentCount: 0,
        selectedAgentId: null,
      }),
    )

    expect(() => {
      act(() => {
        result.current.doZoomToFit()
        result.current.updateCamera(false, false)
      })
    }).not.toThrow()

    // Transform stays at the default — initialization effect only runs when
    // agentCount > 0, so the ref keeps its initial { x:0, y:0, scale:1 }.
    expect(result.current.transformRef.current).toEqual({ x: 0, y: 0, scale: 1 })
  })
})

describe('useCanvasCamera anchor invalidation', () => {
  it('re-anchors when the orchestrator transitions from idle to active mid-session', () => {
    // Reproduces the cache-staleness concern: with the orchestrator initially
    // idle and a sub-agent active, anchor is on the sub. When the orchestrator
    // becomes active, a fresh fit must re-anchor on it (cache-invalidation
    // safety-net via anchorAgentId in the cache key).
    const mainCanvasRef = { current: createElementStub() }
    const main = makeAgent({ id: 'main', isMain: true, x: 100, y: 100, state: 'idle' })
    const sub = makeAgent({ id: 'sub-1', isMain: false, x: 500, y: 400, state: 'thinking' })
    const agents = new Map([[main.id, main], [sub.id, sub]])
    const drawPropsRef = makeDrawPropsRef(agents)
    const simTimeRef = { current: 0 }

    const { result } = renderHook(() =>
      useCanvasCamera({
        mainCanvasRef,
        drawPropsRef,
        simTimeRef,
        dimensions: DIMENSIONS,
        agentCount: agents.size,
        selectedAgentId: null,
      }),
    )

    // First settle: anchor must be on the active sub.
    act(() => {
      result.current.doZoomToFit()
      for (let i = 0; i < 500; i++) result.current.updateCamera(false, false)
    })
    {
      const t = result.current.transformRef.current
      const anchorX = (DIMENSIONS.width / 2 - t.x) / t.scale
      const anchorY = (DIMENSIONS.height / 2 - t.y) / t.scale
      expect(anchorX).toBeCloseTo(sub.x, 0)
      expect(anchorY).toBeCloseTo(sub.y, 0)
    }

    // Mutate state in place (simulating the worst case the cache-key safety
    // net is designed for: same Map ref, but the active-anchor decision has
    // flipped). Then trigger a fresh zoom-to-fit and confirm the camera
    // re-anchors on the now-active orchestrator.
    main.state = 'tool_calling'
    sub.state = 'idle'

    act(() => {
      result.current.doZoomToFit()
      for (let i = 0; i < 500; i++) result.current.updateCamera(false, false)
    })
    {
      const t = result.current.transformRef.current
      const anchorX = (DIMENSIONS.width / 2 - t.x) / t.scale
      const anchorY = (DIMENSIONS.height / 2 - t.y) / t.scale
      expect(anchorX).toBeCloseTo(main.x, 0)
      expect(anchorY).toBeCloseTo(main.y, 0)
    }
  })
})

describe('isActiveAgentState predicate', () => {
  // Pure-predicate contract test. Locks the active/inactive partition that
  // both the camera anchor (this hook) and the radial-glow background layer
  // depend on. If a future state is added to AgentState, the type system
  // forces this case list to be reconsidered (cases below are exhaustive).
  it.each<[AgentState, boolean]>([
    ['thinking',           true],
    ['tool_calling',       true],
    ['waiting_permission', true],
    ['idle',               false],
    ['complete',           false],
    ['error',              false],
    ['paused',             false],
  ])('%s → %s', (state, expected) => {
    expect(isActiveAgentState(state)).toBe(expected)
  })

  it('ACTIVE_AGENT_STATES set has exactly the three active states', () => {
    // Guard against accidental membership drift — the radial-glow effect and
    // the camera-anchor decision must agree on which states are "active".
    expect(ACTIVE_AGENT_STATES.size).toBe(3)
    expect(ACTIVE_AGENT_STATES.has('thinking')).toBe(true)
    expect(ACTIVE_AGENT_STATES.has('tool_calling')).toBe(true)
    expect(ACTIVE_AGENT_STATES.has('waiting_permission')).toBe(true)
  })
})
