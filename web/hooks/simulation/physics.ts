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
  /** When true the node is the graph root (e.g. orchestrator) and never
   *  moves under physics — children orbit it. Distinct from `pinned`, which
   *  is the transient drag-hold state. */
  anchor: boolean
}

export interface PhysicsLink {
  source: string
  target: string
}

export interface PhysicsState {
  nodes: Map<string, PhysicsNode>
  links: PhysicsLink[]
  /** Cached array view of `nodes.values()`, rebuilt by syncPhysics. Avoids
   *  the per-tick `Array.from()` allocation in the hot loop. */
  nodeArray: PhysicsNode[]
  /** id → index in nodeArray. Used by the link-force loop for O(1) endpoint
   *  lookup instead of O(N) indexOf (issue #20). */
  nodeIndex: Map<string, number>
  /** Reusable force/velocity scratch buffers — grown on demand, never shrunk.
   *  Eliminates per-tick Float64Array allocations in steady state. */
  fxBuf: Float64Array
  fyBuf: Float64Array
  prevVxBuf: Float64Array
  prevVyBuf: Float64Array
  /** Consecutive frames where max speed < SETTLE_SPEED. */
  settleCount: number
  /** True once settleCount >= SETTLE_FRAMES. */
  settled: boolean
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createPhysicsState(): PhysicsState {
  return {
    nodes: new Map(),
    links: [],
    nodeArray: [],
    nodeIndex: new Map(),
    fxBuf: new Float64Array(0),
    fyBuf: new Float64Array(0),
    prevVxBuf: new Float64Array(0),
    prevVyBuf: new Float64Array(0),
    settleCount: 0,
    settled: true,
  }
}

// ── Sync: rebuild node/link sets from simulation agents & edges ─────────

export function syncPhysics(
  state: PhysicsState,
  agents: Map<string, Agent>,
  edges: Edge[],
): void {
  // Sync nodes — add new, update pinned/anchor status, remove stale.
  const liveIds = new Set<string>()
  for (const [id, agent] of agents) {
    liveIds.add(id)
    let node = state.nodes.get(id)
    const anchor = agent.isMain === true
    if (!node) {
      node = { id, x: agent.x, y: agent.y, vx: 0, vy: 0, pinned: agent.pinned, anchor }
      state.nodes.set(id, node)
    } else {
      node.pinned = agent.pinned
      node.anchor = anchor
      if (node.pinned || node.anchor) {
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

  // Rebuild the node-array cache and id→index map. tickPhysics consumes
  // these every frame; rebuilding them on the (rare) sync keeps the hot
  // loop allocation-free and gives the link force O(1) endpoint lookup.
  state.nodeArray.length = 0
  state.nodeIndex.clear()
  let i = 0
  for (const node of state.nodes.values()) {
    state.nodeArray.push(node)
    state.nodeIndex.set(node.id, i++)
  }
  // Grow scratch buffers if needed (never shrink — typical session-to-session
  // node counts hover in a small range, so reallocating costs more than the
  // memory holds).
  const n = state.nodeArray.length
  if (state.fxBuf.length < n) {
    state.fxBuf = new Float64Array(n)
    state.fyBuf = new Float64Array(n)
    state.prevVxBuf = new Float64Array(n)
    state.prevVyBuf = new Float64Array(n)
  }

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

  const { links, nodeArray, nodeIndex } = state
  const n = nodeArray.length
  if (n === 0) {
    state.settled = true
    return false
  }

  // ── 1. Accumulate forces ─────────────────────────────────────────────
  // Reuse the state-level Float64Arrays — zero the force accumulators and
  // snapshot previous velocities (damping reads vx/vy before any tick
  // mutation). Steady-state: zero allocations.
  const fx = state.fxBuf
  const fy = state.fyBuf
  const prevVx = state.prevVxBuf
  const prevVy = state.prevVyBuf
  for (let i = 0; i < n; i++) {
    prevVx[i] = nodeArray[i].vx
    prevVy[i] = nodeArray[i].vy
    fx[i] = 0
    fy[i] = 0
  }

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
  // Match d3-force's bias split: each end of the link receives HALF the
  // displacement-derived force. Without the split, an asymmetric initial
  // spawn (one subagent at AGENT_SPAWN_DISTANCE = 200 vs. link rest = 350)
  // kicks the orchestrator with 2× the force d3 would apply, sending it
  // flying on the first tick.
  const LINK_BIAS = 0.5
  for (const link of links) {
    const srcIdx = nodeIndex.get(link.source)
    const tgtIdx = nodeIndex.get(link.target)
    if (srcIdx === undefined || tgtIdx === undefined) continue
    const src = nodeArray[srcIdx]
    const tgt = nodeArray[tgtIdx]

    const dx = tgt.x - src.x
    const dy = tgt.y - src.y
    let dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 0.001) dist = 0.001
    const displacement = dist - LINK_DISTANCE
    const force = displacement * LINK_STRENGTH
    const forceX = (dx / dist) * force
    const forceY = (dy / dist) * force
    fx[srcIdx] += forceX * LINK_BIAS
    fy[srcIdx] += forceY * LINK_BIAS
    fx[tgtIdx] -= forceX * LINK_BIAS
    fy[tgtIdx] -= forceY * LINK_BIAS
  }

  // ── 2. Integrate (velocity-Verlet style) ─────────────────────────────
  // Note: the centroid-recentering force is applied as a position translation
  // after integration (step 2b), not as a per-node spring during force
  // accumulation. d3's forceCenter is a pure translation that doesn't fight
  // the link springs; modeling it as a per-node attractor toward origin
  // produces underdamped oscillation against link rest-length.
  let maxSpeed = 0
  let anyMoved = false

  for (let i = 0; i < n; i++) {
    const node = nodeArray[i]
    if (node.pinned || node.anchor) continue

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

  // ── 2b. Centroid recentering ─────────────────────────────────────────
  // Match d3's forceCenter semantics: translate every (unpinned) node by
  // the same delta so the centroid drifts toward origin. Pure position
  // translation, no kinetic energy injected. Pinned nodes act as anchors.
  let cx = 0, cy = 0
  for (let i = 0; i < n; i++) {
    cx += nodeArray[i].x
    cy += nodeArray[i].y
  }
  cx /= n
  cy /= n
  const tx = -cx * CENTER_STRENGTH
  const ty = -cy * CENTER_STRENGTH
  const translationMag = Math.sqrt(tx * tx + ty * ty)
  if (translationMag > 0) {
    for (let i = 0; i < n; i++) {
      if (nodeArray[i].pinned || nodeArray[i].anchor) continue
      nodeArray[i].x += tx
      nodeArray[i].y += ty
    }
    if (translationMag > 0.1) anyMoved = true
  }

  // ── 3. Settle detection ──────────────────────────────────────────────
  // Settle gates on max(velocity, centroid-translation-magnitude) so we
  // don't declare "settled" while the graph is still drifting toward (0,0).
  const effectiveSpeed = Math.max(maxSpeed, translationMag)
  if (effectiveSpeed < SETTLE_SPEED) {
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
