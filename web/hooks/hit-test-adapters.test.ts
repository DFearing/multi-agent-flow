/**
 * Unit tests for hit-test adapter contract.
 *
 * Verifies that the Canvas2D adapter factory returns an object satisfying
 * the HitTestAdapter interface, and that it delegates correctly to the
 * underlying hit-detection functions.
 */

import { describe, it, expect } from 'vitest'
import type { Agent, ToolCallNode, Discovery } from '@/lib/agent-types'
import { createCanvas2DHitTestAdapter } from './hit-test-adapters'
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

    // Hit inside the main agent radius (stage coords ignored by Canvas2D adapter)
    expect(adapter.findAgentAt(100, 100, 0, 0)).toBe('a1')
    // Miss far away
    expect(adapter.findAgentAt(500, 500, 0, 0)).toBeNull()
  })

  it('findAgentAt returns null on empty agents', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    expect(adapter.findAgentAt(0, 0, 0, 0)).toBeNull()
  })

  it('findToolCallAt returns null on empty tool calls', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    expect(adapter.findToolCallAt(0, 0, 0, 0)).toBeNull()
  })

  it('findDiscoveryAt returns null on empty discoveries', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    expect(adapter.findDiscoveryAt(0, 0, 0, 0)).toBeNull()
  })

  it('findBubbleAgentAt returns null on empty agents', () => {
    const ref = makeDrawPropsRef(new Map(), new Map(), [])
    const simTimeRef = { current: 0 }
    const adapter = createCanvas2DHitTestAdapter(ref, simTimeRef)
    expect(adapter.findBubbleAgentAt(0, 0, 0, 0)).toBeNull()
  })
})

