/**
 * Fixed-capacity ring buffer with O(1) push, O(1) indexed access,
 * and an in-order iterator. When full, the oldest element is silently
 * overwritten. All operations are allocation-free in steady state.
 */
export class RingBuffer<T> {
  private readonly _buf: (T | undefined)[]
  private readonly _capacity: number
  /** Next write position (wraps modulo capacity). */
  private _head = 0
  /** Number of live elements (≤ capacity). */
  private _length = 0

  constructor(capacity: number) {
    if (capacity < 1) throw new RangeError('RingBuffer capacity must be >= 1')
    this._capacity = capacity
    this._buf = new Array<T | undefined>(capacity)
  }

  /** Number of elements currently stored. */
  get length(): number {
    return this._length
  }

  /** Maximum number of elements before overflow. */
  get capacity(): number {
    return this._capacity
  }

  /** Append an element. If the buffer is full, the oldest element is dropped. O(1). */
  push(value: T): void {
    this._buf[this._head] = value
    this._head = (this._head + 1) % this._capacity
    if (this._length < this._capacity) this._length++
  }

  /**
   * Read element at logical index `i` (0 = oldest retained element).
   * Returns `undefined` for out-of-range indices.
   */
  get(i: number): T | undefined {
    if (i < 0 || i >= this._length) return undefined
    const start = (this._head - this._length + this._capacity) % this._capacity
    return this._buf[(start + i) % this._capacity]
  }

  /** Iterate elements oldest-first. */
  *[Symbol.iterator](): IterableIterator<T> {
    const start = (this._head - this._length + this._capacity) % this._capacity
    for (let i = 0; i < this._length; i++) {
      yield this._buf[(start + i) % this._capacity] as T
    }
  }

  /** Return a plain array snapshot (oldest-first). */
  toArray(): T[] {
    const out: T[] = new Array(this._length)
    const start = (this._head - this._length + this._capacity) % this._capacity
    for (let i = 0; i < this._length; i++) {
      out[i] = this._buf[(start + i) % this._capacity] as T
    }
    return out
  }

  /** Remove all elements. O(1) — does not deallocate the backing array. */
  clear(): void {
    this._head = 0
    this._length = 0
  }

  /**
   * Create a shallow clone. The new buffer shares element references but
   * has an independent write head and backing array.
   */
  clone(): RingBuffer<T> {
    const copy = new RingBuffer<T>(this._capacity)
    copy._head = this._head
    copy._length = this._length
    for (let i = 0; i < this._capacity; i++) {
      copy._buf[i] = this._buf[i]
    }
    return copy
  }
}
