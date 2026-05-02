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
    const boundaryRef = { current: null }
    const adapter = createPixiHitTestAdapter(boundaryRef as never)
    assertHitTestInterface(adapter)
  })

  it('findAgentAt returns agent id when hit lands on agent container', () => {
    const container = makeMockContainer('agent-abc')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    // stageX=100, stageY=100 (world coords ignored by Pixi adapter)
    expect(adapter.findAgentAt(0, 0, 100, 100)).toBe('abc')
    expect(boundaryRef.current.hitTest).toHaveBeenCalledWith(100, 100)
  })

  it('findToolCallAt returns tool id when hit lands on tool container', () => {
    const container = makeMockContainer('tool-xyz')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    expect(adapter.findToolCallAt(0, 0, 50, 50)).toBe('xyz')
    expect(boundaryRef.current.hitTest).toHaveBeenCalledWith(50, 50)
  })

  it('findDiscoveryAt returns discovery id when hit lands on discovery container', () => {
    const container = makeMockContainer('discovery-d1')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    expect(adapter.findDiscoveryAt(0, 0, 30, 30)).toBe('d1')
    expect(boundaryRef.current.hitTest).toHaveBeenCalledWith(30, 30)
  })

  it('findBubbleAgentAt returns agent id from bubble label', () => {
    const container = makeMockContainer('bubble-agent1')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    expect(adapter.findBubbleAgentAt(0, 0, 10, 10)).toBe('agent1')
    expect(boundaryRef.current.hitTest).toHaveBeenCalledWith(10, 10)
  })

  it('walk-up: hit on child finds labeled parent', () => {
    const parent = makeMockContainer('agent-walk')
    const child = makeMockContainer('body', parent)
    const boundaryRef = makeBoundaryRef(child)
    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    expect(adapter.findAgentAt(0, 0, 100, 100)).toBe('walk')
  })

  it('returns null when hit returns null', () => {
    const boundaryRef = makeBoundaryRef(null)
    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    expect(adapter.findAgentAt(0, 0, 100, 100)).toBeNull()
    expect(adapter.findToolCallAt(0, 0, 100, 100)).toBeNull()
    expect(adapter.findBubbleAgentAt(0, 0, 100, 100)).toBeNull()
    expect(adapter.findDiscoveryAt(0, 0, 100, 100)).toBeNull()
  })

  it('returns null when boundaryRef.current is null', () => {
    const boundaryRef = { current: null }
    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    expect(adapter.findAgentAt(0, 0, 100, 100)).toBeNull()
    expect(adapter.findToolCallAt(0, 0, 100, 100)).toBeNull()
    expect(adapter.findBubbleAgentAt(0, 0, 100, 100)).toBeNull()
    expect(adapter.findDiscoveryAt(0, 0, 100, 100)).toBeNull()
  })

  it('uses stage-space coords for hitTest, not world-space coords', () => {
    // This verifies the coordinate-space fix: the adapter passes stageX/stageY
    // (not worldX/worldY) to EventBoundary.hitTest.
    const container = makeMockContainer('agent-test')
    const boundaryRef = makeBoundaryRef(container)
    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    // worldX=500, worldY=500 (should be ignored)
    // stageX=200, stageY=150 (should be passed to hitTest)
    adapter.findAgentAt(500, 500, 200, 150)
    expect(boundaryRef.current.hitTest).toHaveBeenCalledWith(200, 150)
  })
})

describe('createPixiHitTestAdapter — coordinate-space integration', () => {
  /**
   * Integration test that simulates the EventBoundary.hitTest coordinate transform
   * behavior. In Pixi v8, hitTest(x, y) applies the root container's
   * worldTransform.applyInverse() to convert from stage-space to local-space,
   * then checks if children are hit at those local coords.
   *
   * This test verifies that under a camera pan+zoom, stage-space coords correctly
   * resolve to the entity at the expected world position.
   */
  it('correctly hits entity under pan+zoom when given stage-space coords', () => {
    // Simulate a camera: pan=(100, 50), zoom=2x
    // worldContainer.position = (100, 50), worldContainer.scale = 2
    // worldTransform = [2, 0, 0, 2, 100, 50]
    // applyInverse(stageX, stageY) => ((stageX - 100) / 2, (stageY - 50) / 2)
    const panX = 100
    const panY = 50
    const zoom = 2

    // Agent is at world position (150, 75)
    const agentWorldX = 150
    const agentWorldY = 75
    const agentRadius = 20

    // The corresponding stage-space coords for this world position:
    // stageX = agentWorldX * zoom + panX = 150 * 2 + 100 = 400
    // stageY = agentWorldY * zoom + panY = 75 * 2 + 50 = 200
    const stageX = agentWorldX * zoom + panX
    const stageY = agentWorldY * zoom + panY

    // Build a mock boundary that mimics the real transform math
    const agentContainer = { label: 'agent-target', parent: null }
    const boundaryRef = {
      current: {
        hitTest: vi.fn().mockImplementation((sx: number, sy: number) => {
          // Simulate worldTransform.applyInverse: convert stage -> world
          const localX = (sx - panX) / zoom
          const localY = (sy - panY) / zoom
          // Check if (localX, localY) is within agent radius
          const dx = localX - agentWorldX
          const dy = localY - agentWorldY
          if (dx * dx + dy * dy <= agentRadius * agentRadius) {
            return agentContainer
          }
          return null
        }),
      },
    }

    const adapter = createPixiHitTestAdapter(boundaryRef as never)

    // Hitting at the correct stage coords should find the agent
    expect(adapter.findAgentAt(agentWorldX, agentWorldY, stageX, stageY)).toBe('target')

    // Hitting at world coords passed as stage coords would miss (the old bug)
    // agentWorldX=150, agentWorldY=75 in stage-space would map to:
    // localX = (150 - 100) / 2 = 25, localY = (75 - 50) / 2 = 12.5
    // That's far from (150, 75), so it should miss
    expect(adapter.findAgentAt(agentWorldX, agentWorldY, agentWorldX, agentWorldY)).toBeNull()
  })

  it('correctly misses entity when stage coords map to empty area', () => {
    const panX = 50
    const panY = 50
    const zoom = 1.5

    const agentWorldX = 200
    const agentWorldY = 200
    const agentRadius = 15

    // Click at a stage position that maps to a world position far from the agent
    const missStageX = 10
    const missStageY = 10

    const agentContainer = { label: 'agent-far', parent: null }
    const boundaryRef = {
      current: {
        hitTest: vi.fn().mockImplementation((sx: number, sy: number) => {
          const localX = (sx - panX) / zoom
          const localY = (sy - panY) / zoom
          const dx = localX - agentWorldX
          const dy = localY - agentWorldY
          if (dx * dx + dy * dy <= agentRadius * agentRadius) {
            return agentContainer
          }
          return null
        }),
      },
    }

    const adapter = createPixiHitTestAdapter(boundaryRef as never)
    expect(adapter.findAgentAt(0, 0, missStageX, missStageY)).toBeNull()
  })
})
