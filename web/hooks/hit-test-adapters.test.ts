/**
 * Unit tests for hit-test adapter contract.
 *
 * Verifies that both Canvas2D and Pixi adapter factories return objects
 * satisfying the HitTestAdapter interface, and that they delegate correctly
 * to the underlying hit-detection functions.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Agent, ToolCallNode, Discovery } from '@/lib/agent-types'
import { createCanvas2DHitTestAdapter, createPixiHitTestAdapter } from './hit-test-adapters'
import type { HitTestAdapter } from './use-canvas-interaction'

function makeAgent(id: string, x: number, y: number, isMain = false): Agent {
  return {
    id,
    name: id,
    x,
    y,
    vx: 0,
    vy: 0,
    state: 'idle',
    opacity: 1,
    isMain,
    toolCalls: 0,
    messageBubbles: [],
    timeAlive: 0,
    pinned: false,
    parentId: null,
    tokensUsed: 0,
    tokensMax: 200000,
    contextBreakdown: { systemPrompt: 0, userMessages: 0, toolResults: 0, reasoning: 0, subagentResults: 0 },
    spawnTime: 0,
    scale: 1,
  } as Agent
}

function makeToolCall(id: string, agentId: string, x: number, y: number): ToolCallNode {
  return {
    id,
    agentId,
    toolName: 'test',
    args: '{}',
    x,
    y,
    opacity: 1,
    state: 'running',
  } as ToolCallNode
}

function makeDrawPropsRef(
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
  discoveries: Discovery[],
) {
  return {
    current: { agents, toolCalls, discoveries },
  }
}

function assertHitTestInterface(adapter: HitTestAdapter) {
  expect(adapter.findAgentAt).toBeInstanceOf(Function)
  expect(adapter.findToolCallAt).toBeInstanceOf(Function)
  expect(adapter.findBubbleAgentAt).toBeInstanceOf(Function)
  expect(adapter.findDiscoveryAt).toBeInstanceOf(Function)
}

describe('createCanvas2DHitTestAdapter', () => {
  it('returns an object satisfying HitTestAdapter', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    assertHitTestInterface(adapter)
  })

  it('findAgentAt hits an agent at its position', () => {
    const agents = new Map<string, Agent>()
    agents.set('a1', makeAgent('a1', 100, 100, true))
    const ref = makeDrawPropsRef(agents, new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)

    // Hit inside the main agent radius
    expect(adapter.findAgentAt(100, 100)).toBe('a1')
    // Miss far away
    expect(adapter.findAgentAt(500, 500)).toBeNull()
  })

  it('findAgentAt returns null on empty agents', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    expect(adapter.findAgentAt(0, 0)).toBeNull()
  })

  it('findToolCallAt returns null on empty tool calls', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    expect(adapter.findToolCallAt(0, 0)).toBeNull()
  })

  it('findDiscoveryAt returns null on empty discoveries', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    expect(adapter.findDiscoveryAt(0, 0)).toBeNull()
  })

  it('findBubbleAgentAt returns null on empty agents', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    expect(adapter.findBubbleAgentAt(0, 0)).toBeNull()
  })
})

describe('createPixiHitTestAdapter', () => {
  function makeMockContainer(label: string, parent?: { label: string; parent?: unknown }) {
    return { label, parent: parent ?? null }
  }

  function makeBoundaryRef(hitResult: unknown) {
    return {
      current: {
        hitTest: vi.fn().mockReturnValue(hitResult),
      },
    }
  }

  it('returns an object satisfying HitTestAdapter', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const boundaryRef = { current: null }
    const adapter = createPixiHitTestAdapter(ref, simTimeRef, boundaryRef as never)
    assertHitTestInterface(adapter)
  })

  it('findAgentAt returns agent id when hit lands on agent container', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const container = makeMockContainer('agent-abc')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(ref, simTimeRef, boundaryRef as never)

    expect(adapter.findAgentAt(100, 100)).toBe('abc')
  })

  it('findToolCallAt returns tool id when hit lands on tool container', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const container = makeMockContainer('tool-xyz')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(ref, simTimeRef, boundaryRef as never)

    expect(adapter.findToolCallAt(50, 50)).toBe('xyz')
  })

  it('findDiscoveryAt returns discovery id when hit lands on discovery container', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const container = makeMockContainer('discovery-d1')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(ref, simTimeRef, boundaryRef as never)

    expect(adapter.findDiscoveryAt(30, 30)).toBe('d1')
  })

  it('findBubbleAgentAt returns agent id from bubble label', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const container = makeMockContainer('bubble-agent1')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(ref, simTimeRef, boundaryRef as never)

    expect(adapter.findBubbleAgentAt(10, 10)).toBe('agent1')
  })

  it('walk-up: hit on child finds labeled parent', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const parent = makeMockContainer('agent-walk')
    const child = makeMockContainer('body', parent)
    const boundaryRef = makeBoundaryRef(child)
    const adapter = createPixiHitTestAdapter(ref, simTimeRef, boundaryRef as never)

    expect(adapter.findAgentAt(100, 100)).toBe('walk')
  })

  it('returns null when hit returns null', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const boundaryRef = makeBoundaryRef(null)
    const adapter = createPixiHitTestAdapter(ref, simTimeRef, boundaryRef as never)

    expect(adapter.findAgentAt(100, 100)).toBeNull()
    expect(adapter.findToolCallAt(100, 100)).toBeNull()
    expect(adapter.findBubbleAgentAt(100, 100)).toBeNull()
    expect(adapter.findDiscoveryAt(100, 100)).toBeNull()
  })

  it('returns null when boundaryRef.current is null', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const boundaryRef = { current: null }
    const adapter = createPixiHitTestAdapter(ref, simTimeRef, boundaryRef as never)

    expect(adapter.findAgentAt(100, 100)).toBeNull()
    expect(adapter.findToolCallAt(100, 100)).toBeNull()
    expect(adapter.findBubbleAgentAt(100, 100)).toBeNull()
    expect(adapter.findDiscoveryAt(100, 100)).toBeNull()
  })
})
