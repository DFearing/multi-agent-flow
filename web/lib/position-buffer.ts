/**
 * Typed-array position buffer for agent coordinates.
 *
 * Stores [x, y, vx, vy] per agent in a single Float32Array, indexed by a
 * stable integer slot. Eliminates per-frame `{...agent, x, y}` object
 * spreads during drag and physics ticks.
 *
 * The buffer grows on demand (doubling) and never shrinks — typical session
 * agent counts stay in a small range, so the amortized allocation cost is
 * negligible.
 */

/** Number of floats per agent slot: x, y, vx, vy */
const STRIDE = 4

/** Offsets within each slot */
const OFF_X = 0
const OFF_Y = 1
const OFF_VX = 2
const OFF_VY = 3

/** Initial capacity (agents) */
const INITIAL_CAPACITY = 32

export class PositionBuffer {
  /** Backing Float32Array — [x0, y0, vx0, vy0, x1, y1, vx1, vy1, ...] */
  data: Float32Array
  /** agent-id → slot index */
  private idToIndex: Map<string, number> = new Map()
  /** slot index → agent-id (for reverse lookup during write-back) */
  private indexToId: string[] = []
  /** Next available slot index */
  private nextSlot = 0
  /** Current capacity (in agents, not floats) */
  private capacity: number

  constructor(initialCapacity = INITIAL_CAPACITY) {
    this.capacity = initialCapacity
    this.data = new Float32Array(initialCapacity * STRIDE)
  }

  /** Ensure an agent has a slot. Returns the slot index. */
  register(agentId: string, x: number, y: number, vx = 0, vy = 0): number {
    const existing = this.idToIndex.get(agentId)
    if (existing !== undefined) return existing

    if (this.nextSlot >= this.capacity) {
      this.grow()
    }

    const idx = this.nextSlot++
    this.idToIndex.set(agentId, idx)
    this.indexToId[idx] = agentId
    const base = idx * STRIDE
    this.data[base + OFF_X] = x
    this.data[base + OFF_Y] = y
    this.data[base + OFF_VX] = vx
    this.data[base + OFF_VY] = vy
    return idx
  }

  /** Remove an agent from the buffer. Does NOT compact — slot is wasted. */
  remove(agentId: string): void {
    const idx = this.idToIndex.get(agentId)
    if (idx === undefined) return
    this.idToIndex.delete(agentId)
    // Zero out the slot (cosmetic — not strictly required)
    const base = idx * STRIDE
    this.data[base + OFF_X] = 0
    this.data[base + OFF_Y] = 0
    this.data[base + OFF_VX] = 0
    this.data[base + OFF_VY] = 0
  }

  /** Get the slot index for an agent, or undefined if not registered. */
  indexOf(agentId: string): number | undefined {
    return this.idToIndex.get(agentId)
  }

  /** Read x for a slot. */
  getX(idx: number): number { return this.data[idx * STRIDE + OFF_X] }
  /** Read y for a slot. */
  getY(idx: number): number { return this.data[idx * STRIDE + OFF_Y] }
  /** Read vx for a slot. */
  getVx(idx: number): number { return this.data[idx * STRIDE + OFF_VX] }
  /** Read vy for a slot. */
  getVy(idx: number): number { return this.data[idx * STRIDE + OFF_VY] }

  /** Write x, y for a slot. */
  setPosition(idx: number, x: number, y: number): void {
    const base = idx * STRIDE
    this.data[base + OFF_X] = x
    this.data[base + OFF_Y] = y
  }

  /** Write vx, vy for a slot. */
  setVelocity(idx: number, vx: number, vy: number): void {
    const base = idx * STRIDE
    this.data[base + OFF_VX] = vx
    this.data[base + OFF_VY] = vy
  }

  /** Write all four components. */
  set(idx: number, x: number, y: number, vx: number, vy: number): void {
    const base = idx * STRIDE
    this.data[base + OFF_X] = x
    this.data[base + OFF_Y] = y
    this.data[base + OFF_VX] = vx
    this.data[base + OFF_VY] = vy
  }

  /** Number of registered agents. */
  get size(): number { return this.idToIndex.size }

  /** Iterate over all registered agent IDs and their indices. */
  entries(): IterableIterator<[string, number]> {
    return this.idToIndex.entries()
  }

  /** Get agent id for a slot index. */
  getAgentId(idx: number): string | undefined {
    return this.indexToId[idx]
  }

  /** Reset the buffer — clear all registrations. */
  clear(): void {
    this.idToIndex.clear()
    this.indexToId.length = 0
    this.nextSlot = 0
  }

  private grow(): void {
    const newCapacity = this.capacity * 2
    const newData = new Float32Array(newCapacity * STRIDE)
    newData.set(this.data)
    this.data = newData
    this.capacity = newCapacity
  }
}
