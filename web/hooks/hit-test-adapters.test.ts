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
  it('returns an object satisfying HitTestAdapter', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createPixiHitTestAdapter(ref, simTimeRef)
    assertHitTestInterface(adapter)
  })

  it('findAgentAt hits an agent at its position', () => {
    const agents = new Map<string, Agent>()
    agents.set('a1', makeAgent('a1', 200, 200, false))
    const ref = makeDrawPropsRef(agents, new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createPixiHitTestAdapter(ref, simTimeRef)

    // Hit inside the sub-agent radius
    expect(adapter.findAgentAt(200, 200)).toBe('a1')
    // Miss far away
    expect(adapter.findAgentAt(999, 999)).toBeNull()
  })

  it('reads from ref.current at call time, not creation time', () => {
    const agents1 = new Map<string, Agent>()
    const ref = makeDrawPropsRef(agents1, new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createPixiHitTestAdapter(ref, simTimeRef)

    // Initially no agents
    expect(adapter.findAgentAt(100, 100)).toBeNull()

    // Add an agent after adapter creation
    const agents2 = new Map<string, Agent>()
    agents2.set('a2', makeAgent('a2', 100, 100, true))
    ref.current.agents = agents2

    // Adapter should pick up the new data
    expect(adapter.findAgentAt(100, 100)).toBe('a2')
  })
})
