import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RingBuffer } from './ring-buffer'

describe('RingBuffer', () => {
  it('tracks length correctly', () => {
    const buf = new RingBuffer<number>(4)
    assert.equal(buf.length, 0)
    buf.push(1)
    assert.equal(buf.length, 1)
    buf.push(2)
    buf.push(3)
    buf.push(4)
    assert.equal(buf.length, 4)
  })

  it('returns elements in insertion order via get()', () => {
    const buf = new RingBuffer<string>(4)
    buf.push('a')
    buf.push('b')
    buf.push('c')
    assert.equal(buf.get(0), 'a')
    assert.equal(buf.get(1), 'b')
    assert.equal(buf.get(2), 'c')
    assert.equal(buf.get(3), undefined)
  })

  it('overwrites oldest elements when full (wrap)', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    buf.push(3)
    // Full — next push drops 1
    buf.push(4)
    assert.equal(buf.length, 3)
    assert.equal(buf.get(0), 2)
    assert.equal(buf.get(1), 3)
    assert.equal(buf.get(2), 4)
  })

  it('handles multiple wraps correctly', () => {
    const buf = new RingBuffer<number>(3)
    for (let i = 0; i < 10; i++) buf.push(i)
    assert.equal(buf.length, 3)
    assert.equal(buf.get(0), 7)
    assert.equal(buf.get(1), 8)
    assert.equal(buf.get(2), 9)
  })

  it('iterates in oldest-first order', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(10)
    buf.push(20)
    buf.push(30)
    buf.push(40) // drops 10
    const items = [...buf]
    assert.deepEqual(items, [20, 30, 40])
  })

  it('toArray() returns a snapshot', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    const arr = buf.toArray()
    assert.deepEqual(arr, [1, 2])
    // Mutating the array does not affect the buffer
    arr.push(999)
    assert.equal(buf.length, 2)
  })

  it('clone() produces an independent copy', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    const copy = buf.clone()
    buf.push(3)
    buf.push(4) // buf: [2, 3, 4]; copy: [1, 2]
    assert.equal(copy.length, 2)
    assert.deepEqual(copy.toArray(), [1, 2])
    assert.deepEqual(buf.toArray(), [2, 3, 4])
  })

  it('clear() resets to empty', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    buf.push(2)
    buf.clear()
    assert.equal(buf.length, 0)
    assert.equal(buf.get(0), undefined)
    assert.deepEqual([...buf], [])
  })

  it('rejects capacity < 1', () => {
    assert.throws(() => new RingBuffer<number>(0), /capacity must be >= 1/)
    assert.throws(() => new RingBuffer<number>(-5), /capacity must be >= 1/)
  })

  it('get() returns undefined for out-of-range indices', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1)
    assert.equal(buf.get(-1), undefined)
    assert.equal(buf.get(1), undefined)
    assert.equal(buf.get(100), undefined)
  })

  it('works with capacity 1', () => {
    const buf = new RingBuffer<string>(1)
    buf.push('a')
    assert.equal(buf.get(0), 'a')
    buf.push('b')
    assert.equal(buf.length, 1)
    assert.equal(buf.get(0), 'b')
    assert.deepEqual([...buf], ['b'])
  })
})
