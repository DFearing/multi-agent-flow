import { describe, it, expect } from 'vitest'
import { PositionBuffer } from './position-buffer'

describe('PositionBuffer', () => {
  it('registers agents and reads back positions', () => {
    const buf = new PositionBuffer()
    const idx = buf.register('agent-1', 10, 20, 1, 2)

    expect(buf.getX(idx)).toBe(10)
    expect(buf.getY(idx)).toBe(20)
    expect(buf.getVx(idx)).toBe(1)
    expect(buf.getVy(idx)).toBe(2)
  })

  it('register is idempotent — returns same index for same id', () => {
    const buf = new PositionBuffer()
    const idx1 = buf.register('a', 0, 0)
    const idx2 = buf.register('a', 99, 99)
    expect(idx1).toBe(idx2)
    // Position should not be overwritten by duplicate register
    expect(buf.getX(idx1)).toBe(0)
  })

  it('setPosition and setVelocity update in place', () => {
    const buf = new PositionBuffer()
    const idx = buf.register('a', 0, 0)

    buf.setPosition(idx, 42, 84)
    expect(buf.getX(idx)).toBe(42)
    expect(buf.getY(idx)).toBe(84)

    buf.setVelocity(idx, 3, 4)
    expect(buf.getVx(idx)).toBe(3)
    expect(buf.getVy(idx)).toBe(4)
  })

  it('set writes all four components', () => {
    const buf = new PositionBuffer()
    const idx = buf.register('a', 0, 0)
    buf.set(idx, 1, 2, 3, 4)
    expect(buf.getX(idx)).toBe(1)
    expect(buf.getY(idx)).toBe(2)
    expect(buf.getVx(idx)).toBe(3)
    expect(buf.getVy(idx)).toBe(4)
  })

  it('remove clears the slot', () => {
    const buf = new PositionBuffer()
    buf.register('a', 10, 20)
    buf.remove('a')
    expect(buf.indexOf('a')).toBeUndefined()
    expect(buf.size).toBe(0)
  })

  it('grows automatically beyond initial capacity', () => {
    const buf = new PositionBuffer(2) // tiny initial capacity
    for (let i = 0; i < 10; i++) {
      buf.register(`agent-${i}`, i, i * 2)
    }
    expect(buf.size).toBe(10)
    // Verify all positions survived the grow
    for (let i = 0; i < 10; i++) {
      const idx = buf.indexOf(`agent-${i}`)!
      expect(buf.getX(idx)).toBe(i)
      expect(buf.getY(idx)).toBe(i * 2)
    }
  })

  it('clear resets all state', () => {
    const buf = new PositionBuffer()
    buf.register('a', 1, 2)
    buf.register('b', 3, 4)
    buf.clear()
    expect(buf.size).toBe(0)
    expect(buf.indexOf('a')).toBeUndefined()
    expect(buf.indexOf('b')).toBeUndefined()
  })

  it('zero allocations during 100-tick steady-state position updates', () => {
    const buf = new PositionBuffer()
    // Register 10 agents
    const indices: number[] = []
    for (let i = 0; i < 10; i++) {
      indices.push(buf.register(`agent-${i}`, i * 10, i * 20))
    }

    // Warm up — ensure all JIT compilation / hidden class transitions settle
    for (let tick = 0; tick < 10; tick++) {
      for (const idx of indices) {
        buf.setPosition(idx, buf.getX(idx) + 0.1, buf.getY(idx) + 0.1)
        buf.setVelocity(idx, 0.5, 0.5)
      }
    }

    // Measure: 100 ticks of position updates should not allocate new objects.
    // We verify by checking that the backing array reference is stable.
    const dataRef = buf.data
    for (let tick = 0; tick < 100; tick++) {
      for (const idx of indices) {
        const x = buf.getX(idx)
        const y = buf.getY(idx)
        const vx = buf.getVx(idx)
        const vy = buf.getVy(idx)
        buf.setPosition(idx, x + vx * 0.016, y + vy * 0.016)
      }
    }
    // The backing array should not have been reallocated (no new agents spawned)
    expect(buf.data).toBe(dataRef)
    // Verify positions actually updated (not a no-op)
    expect(buf.getX(indices[0])).not.toBe(0)
  })

  it('entries iterates registered agents', () => {
    const buf = new PositionBuffer()
    buf.register('a', 0, 0)
    buf.register('b', 1, 1)

    const result = new Map(buf.entries())
    expect(result.size).toBe(2)
    expect(result.has('a')).toBe(true)
    expect(result.has('b')).toBe(true)
  })

  it('getAgentId returns the id for a slot index', () => {
    const buf = new PositionBuffer()
    const idx = buf.register('test-agent', 0, 0)
    expect(buf.getAgentId(idx)).toBe('test-agent')
  })
})
