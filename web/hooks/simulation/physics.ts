/**
 * Custom small-graph physics solver for ≤50 nodes per session.
 *
 * Replaces d3-force with a simpler, allocation-free integrator that avoids
 * the overhead of quadtree construction, alpha-decay scheduling, and the
 * synchronous 15-tick burst sync that dominated the frame budget during
 * spawn storms.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Parameter mapping from FORCE constants (canvas-constants.ts) → solver:
 *
 *   FORCE.chargeStrength  → REPULSION_STRENGTH  (Coulomb coefficient; negative = repulsive)
 *   FORCE.centerStrength  → CENTER_STRENGTH     (soft pull toward origin)
 *   FORCE.collideRadius   → COLLIDE_RADIUS      (minimum node separation)
 *   FORCE.linkDistance     → LINK_DISTANCE       (spring rest length)
 *   FORCE.linkStrength     → LINK_STRENGTH       (Hooke spring constant)
 *   FORCE.velocityDecay    → VELOCITY_DECAY      (per-tick velocity damping, 0–1)
 *   FORCE.alphaDecay       → (not used — settle by velocity threshold instead)
 *
 * d3-force applies forces as acceleration deltas then multiplies velocity
 * by (1 - velocityDecay) each tick. We replicate that model directly.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type { Agent, Edge } from '@/lib/agent-types'
import { FORCE } from '@/lib/canvas-constants'

// ── Solver parameters (derived from FORCE constants) ────────────────────

const REPULSION_STRENGTH = Math.abs(FORCE.chargeStrength) // positive magnitude
const CENTER_STRENGTH = FORCE.centerStrength
const COLLIDE_RADIUS = FORCE.collideRadius
const LINK_DISTANCE = FORCE.linkDistance
const LINK_STRENGTH = FORCE.linkStrength
const VELOCITY_DECAY = FORCE.velocityDecay

/** Below this max-speed (px/frame) the simulation is "settling". */
const SETTLE_SPEED = 0.05
/** Number of consecutive frames below SETTLE_SPEED before declaring settled. */
const SETTLE_FRAMES = 5

/** Minimum distance squared to avoid division-by-zero in Coulomb repulsion. */
const MIN_DIST_SQ = 1

// ── Public types ────────────────────────────────────────────────────────

export interface PhysicsNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** When true the node is immovable (drag-pinned). */
  pinned: boolean
}

export interface PhysicsLink {
  source: string
  target: string
}

export interface PhysicsState {
  nodes: Map<string, PhysicsNode>
  links: PhysicsLink[]
  /** Consecutive frames where max speed < SETTLE_SPEED. */
  settleCount: number
  /** True once settleCount >= SETTLE_FRAMES. */
  settled: boolean
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createPhysicsState(): PhysicsState {
  return { nodes: new Map(), links: [], settleCount: 0, settled: true }
}

// ── Sync: rebuild node/link sets from simulation agents & edges ─────────

export function syncPhysics(
  state: PhysicsState,
  agents: Map<string, Agent>,
  edges: Edge[],
): void {
  // Sync nodes — add new, update pinned status, remove stale.
  const liveIds = new Set<string>()
  for (const [id, agent] of agents) {
    liveIds.add(id)
    let node = state.nodes.get(id)
    if (!node) {
      node = { id, x: agent.x, y: agent.y, vx: 0, vy: 0, pinned: agent.pinned }
      state.nodes.set(id, node)
    } else {
      node.pinned = agent.pinned
      if (node.pinned) {
        node.x = agent.x
        node.y = agent.y
        node.vx = 0
        node.vy = 0
      }
    }
  }
  // Remove nodes that no longer exist in agents.
  for (const id of state.nodes.keys()) {
    if (!liveIds.has(id)) state.nodes.delete(id)
  }

  // Rebuild links from parent-child edges (same filter as the d3-force version).
  const nodeIds = state.nodes
  state.links = edges
    .filter(e => e.type === 'parent-child' && nodeIds.has(e.from) && nodeIds.has(e.to))
    .map(e => ({ source: e.from, target: e.to }))

  // Wake the solver.
  state.settleCount = 0
  state.settled = false
}

// ── Wake: temporarily reset settle state (used after drag / sync) ───────

export function wakePhysics(state: PhysicsState): void {
  state.settleCount = 0
  state.settled = false
}

// ── Pin a node (drag) ───────────────────────────────────────────────────

export function pinNode(state: PhysicsState, id: string, x: number, y: number): void {
  const node = state.nodes.get(id)
  if (node) {
    node.x = x
    node.y = y
    node.vx = 0
    node.vy = 0
    node.pinned = true
  }
  // Wake so connected nodes respond to the new position.
  wakePhysics(state)
}

// ── Tick: one integration step ──────────────────────────────────────────

/**
 * Runs one step of the physics integrator. Returns true if any node moved
 * more than 0.1 px (callers use this to decide whether to clone the agent map).
 *
 * This mutates `state.nodes` in place — no allocations in steady state.
 */
export function tickPhysics(state: PhysicsState): boolean {
  if (state.settled) return false

  const { nodes, links } = state
  const nodeArray = Array.from(nodes.values())
  const n = nodeArray.length
  if (n === 0) {
    state.settled = true
    return false
  }

  // ── 1. Accumulate forces ─────────────────────────────────────────────
  // We reuse vx/vy as accumulators: zero them first, accumulate forces,
  // then integrate. This mirrors d3-force's pattern where velocity is
  // damped then forces are added as deltas.

  // Store previous velocities for damping.
  const prevVx = new Float64Array(n)
  const prevVy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    prevVx[i] = nodeArray[i].vx
    prevVy[i] = nodeArray[i].vy
  }

  // Reset force accumulators.
  const fx = new Float64Array(n)
  const fy = new Float64Array(n)

  // ── 1a. All-pairs Coulomb repulsion O(N²) ────────────────────────────
  for (let i = 0; i < n; i++) {
    const ni = nodeArray[i]
    for (let j = i + 1; j < n; j++) {
      const nj = nodeArray[j]
      const dx = nj.x - ni.x
      const dy = nj.y - ni.y
      let distSq = dx * dx + dy * dy
      if (distSq < MIN_DIST_SQ) distSq = MIN_DIST_SQ
      // Coulomb: F = k / r^2, direction along the line between nodes.
      // We want force magnitude = REPULSION_STRENGTH / distSq.
      const dist = Math.sqrt(distSq)
      const force = REPULSION_STRENGTH / distSq
      const forceX = (dx / dist) * force
      const forceY = (dy / dist) * force
      // Repulsive: push i away from j and j away from i.
      fx[i] -= forceX
      fy[i] -= forceY
      fx[j] += forceX
      fy[j] += forceY
    }
  }

  // ── 1b. Collision (soft overlap resolution) ──────────────────────────
  for (let i = 0; i < n; i++) {
    const ni = nodeArray[i]
    for (let j = i + 1; j < n; j++) {
      const nj = nodeArray[j]
      const dx = nj.x - ni.x
      const dy = nj.y - ni.y
      const distSq = dx * dx + dy * dy
      const minDist = COLLIDE_RADIUS * 2
      if (distSq < minDist * minDist && distSq > 0) {
        const dist = Math.sqrt(distSq)
        const overlap = minDist - dist
        const pushX = (dx / dist) * overlap * 0.5
        const pushY = (dy / dist) * overlap * 0.5
        fx[i] -= pushX
        fy[i] -= pushY
        fx[j] += pushX
        fy[j] += pushY
      }
    }
  }

  // ── 1c. Spring forces on parent-child links (Hooke) ──────────────────
  for (const link of links) {
    const src = nodes.get(link.source)
    const tgt = nodes.get(link.target)
    if (!src || !tgt) continue
    const srcIdx = nodeArray.indexOf(src)
    const tgtIdx = nodeArray.indexOf(tgt)
    if (srcIdx < 0 || tgtIdx < 0) continue

    const dx = tgt.x - src.x
    const dy = tgt.y - src.y
    let dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 0.001) dist = 0.001
    const displacement = dist - LINK_DISTANCE
    const force = displacement * LINK_STRENGTH
    const forceX = (dx / dist) * force
    const forceY = (dy / dist) * force
    fx[srcIdx] += forceX
    fy[srcIdx] += forceY
    fx[tgtIdx] -= forceX
    fy[tgtIdx] -= forceY
  }

  // ── 1d. Center pull toward (0, 0) ────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const node = nodeArray[i]
    fx[i] -= node.x * CENTER_STRENGTH
    fy[i] -= node.y * CENTER_STRENGTH
  }

  // ── 2. Integrate (velocity-Verlet style) ─────────────────────────────
  let maxSpeed = 0
  let anyMoved = false

  for (let i = 0; i < n; i++) {
    const node = nodeArray[i]
    if (node.pinned) continue

    // Damp previous velocity, then add force as acceleration (mass = 1).
    let vx = prevVx[i] * (1 - VELOCITY_DECAY) + fx[i]
    let vy = prevVy[i] * (1 - VELOCITY_DECAY) + fy[i]

    // Clamp max velocity to prevent explosions.
    const speed = Math.sqrt(vx * vx + vy * vy)
    const maxVel = 50
    if (speed > maxVel) {
      vx = (vx / speed) * maxVel
      vy = (vy / speed) * maxVel
    }

    node.vx = vx
    node.vy = vy

    const newX = node.x + vx
    const newY = node.y + vy

    if (Math.abs(newX - node.x) > 0.1 || Math.abs(newY - node.y) > 0.1) {
      anyMoved = true
    }

    node.x = newX
    node.y = newY

    if (speed > maxSpeed) maxSpeed = speed
  }

  // ── 3. Settle detection ──────────────────────────────────────────────
  if (maxSpeed < SETTLE_SPEED) {
    state.settleCount++
    if (state.settleCount >= SETTLE_FRAMES) {
      state.settled = true
    }
  } else {
    state.settleCount = 0
  }

  return anyMoved
}

// ── Write-back: apply physics positions to agent map ────────────────────

/**
 * Apply physics node positions back to agents. Returns a new Map only if
 * at least one agent moved >0.1 px (lazy-clone pattern from the d3-force
 * tick handler).
 */
export function applyPhysicsToAgents(
  state: PhysicsState,
  agents: Map<string, Agent>,
): Map<string, Agent> | null {
  let newAgents: Map<string, Agent> | null = null
  for (const node of state.nodes.values()) {
    const agent = agents.get(node.id)
    if (!agent || agent.pinned) continue
    if (Math.abs(agent.x - node.x) > 0.1 || Math.abs(agent.y - node.y) > 0.1) {
      if (!newAgents) newAgents = new Map(agents)
      newAgents.set(node.id, { ...agent, x: node.x, y: node.y })
    }
  }
  return newAgents
}
