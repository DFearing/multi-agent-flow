import { describe, it, expect } from 'vitest'
import {
  createPhysicsState,
  syncPhysics,
  wakePhysics,
  pinNode,
  tickPhysics,
  applyPhysicsToAgents,
  type PhysicsState,
} from './physics'
import { FORCE } from '@/lib/canvas-constants'
import type { Agent, Edge } from '@/lib/agent-types'
import { emptyContextBreakdown } from '@/lib/agent-types'

/** Helper: build a minimal Agent for physics testing. */
function makeAgent(id: string, x: number, y: number, opts?: Partial<Agent>): Agent {
  return {
    id, name: id, state: 'idle',
    parentId: null,
    tokensUsed: 0, tokensMax: 200_000,
    contextBreakdown: emptyContextBreakdown(),
    toolCalls: 0, timeAlive: 0,
    x, y, vx: 0, vy: 0,
    pinned: false, isMain: id === 'parent',
    spawnTime: 0, opacity: 1, scale: 1,
    messageBubbles: [],
    ...opts,
  }
}

/** Run the physics for N ticks, returning the state. */
function runTicks(state: PhysicsState, n: number): void {
  for (let i = 0; i < n; i++) tickPhysics(state)
}

describe('physics solver', () => {
  it('should settle a parent + 2 children into a stable layout', () => {
    const agents = new Map<string, Agent>()
    agents.set('parent', makeAgent('parent', 0, 0))
    agents.set('child-1', makeAgent('child-1', 50, 50, { parentId: 'parent' }))
    agents.set('child-2', makeAgent('child-2', -50, 50, { parentId: 'parent' }))

    const edges: Edge[] = [
      { id: 'e1', from: 'parent', to: 'child-1', type: 'parent-child', opacity: 1 },
      { id: 'e2', from: 'parent', to: 'child-2', type: 'parent-child', opacity: 1 },
    ]

    const state = createPhysicsState()
    syncPhysics(state, agents, edges)

    // Run enough ticks to settle.
    runTicks(state, 300)

    expect(state.settled).toBe(true)

    const parent = state.nodes.get('parent')!
    const child1 = state.nodes.get('child-1')!
    const child2 = state.nodes.get('child-2')!

    // Parent should be near center (within reasonable distance of origin due
    // to center pull — strong repulsion with 3 nodes pushes equilibrium out).
    expect(Math.abs(parent.x)).toBeLessThan(300)
    expect(Math.abs(parent.y)).toBeLessThan(300)

    // Children should be separated by approximately FORCE.linkDistance from parent.
    const d1 = Math.sqrt((child1.x - parent.x) ** 2 + (child1.y - parent.y) ** 2)
    const d2 = Math.sqrt((child2.x - parent.x) ** 2 + (child2.y - parent.y) ** 2)
    // Allow 50% tolerance — the repulsion and center forces shift equilibrium.
    expect(d1).toBeGreaterThan(FORCE.linkDistance * 0.4)
    expect(d1).toBeLessThan(FORCE.linkDistance * 2.0)
    expect(d2).toBeGreaterThan(FORCE.linkDistance * 0.4)
    expect(d2).toBeLessThan(FORCE.linkDistance * 2.0)

    // Children should be separated from each other (repulsion).
    const childDist = Math.sqrt((child1.x - child2.x) ** 2 + (child1.y - child2.y) ** 2)
    expect(childDist).toBeGreaterThan(FORCE.collideRadius)

    // No exploding velocities.
    for (const node of state.nodes.values()) {
      expect(Math.abs(node.vx)).toBeLessThan(1)
      expect(Math.abs(node.vy)).toBeLessThan(1)
    }
  })

  it('should not tick when settled', () => {
    const state = createPhysicsState()
    // Empty state is settled by default.
    expect(state.settled).toBe(true)
    const moved = tickPhysics(state)
    expect(moved).toBe(false)
  })

  it('should wake after sync', () => {
    const state = createPhysicsState()
    expect(state.settled).toBe(true)

    const agents = new Map<string, Agent>()
    agents.set('a', makeAgent('a', 0, 0))
    syncPhysics(state, agents, [])
    expect(state.settled).toBe(false)
  })

  it('should respect pinned nodes', () => {
    const agents = new Map<string, Agent>()
    agents.set('pinned', makeAgent('pinned', 100, 100, { pinned: true }))
    agents.set('free', makeAgent('free', 200, 200))

    const state = createPhysicsState()
    syncPhysics(state, agents, [])
    runTicks(state, 50)

    const pinnedNode = state.nodes.get('pinned')!
    // Pinned node should not have moved.
    expect(pinnedNode.x).toBe(100)
    expect(pinnedNode.y).toBe(100)
  })

  it('pinNode should update position and wake solver', () => {
    const agents = new Map<string, Agent>()
    agents.set('a', makeAgent('a', 0, 0))
    agents.set('b', makeAgent('b', 100, 100))

    const state = createPhysicsState()
    syncPhysics(state, agents, [])
    runTicks(state, 300)
    expect(state.settled).toBe(true)

    pinNode(state, 'a', 500, 500)
    expect(state.settled).toBe(false)
    expect(state.nodes.get('a')!.x).toBe(500)
    expect(state.nodes.get('a')!.y).toBe(500)
    expect(state.nodes.get('a')!.pinned).toBe(true)
  })

  it('applyPhysicsToAgents returns null when nothing moved', () => {
    const agents = new Map<string, Agent>()
    agents.set('a', makeAgent('a', 10, 20))

    const state = createPhysicsState()
    syncPhysics(state, agents, [])
    // Manually set node to same position as agent.
    state.nodes.get('a')!.x = 10
    state.nodes.get('a')!.y = 20

    const result = applyPhysicsToAgents(state, agents)
    expect(result).toBeNull()
  })

  it('applyPhysicsToAgents returns new map when nodes moved', () => {
    const agents = new Map<string, Agent>()
    agents.set('a', makeAgent('a', 10, 20))

    const state = createPhysicsState()
    syncPhysics(state, agents, [])
    // Move node substantially.
    state.nodes.get('a')!.x = 50
    state.nodes.get('a')!.y = 60

    const result = applyPhysicsToAgents(state, agents)
    expect(result).not.toBeNull()
    expect(result!.get('a')!.x).toBe(50)
    expect(result!.get('a')!.y).toBe(60)
  })

  it('should handle single node settling near origin', () => {
    const agents = new Map<string, Agent>()
    agents.set('solo', makeAgent('solo', 200, 300))

    const state = createPhysicsState()
    syncPhysics(state, agents, [])
    runTicks(state, 200)

    expect(state.settled).toBe(true)
    const node = state.nodes.get('solo')!
    // Single node with center pull should converge near origin.
    expect(Math.abs(node.x)).toBeLessThan(10)
    expect(Math.abs(node.y)).toBeLessThan(10)
  })
})
