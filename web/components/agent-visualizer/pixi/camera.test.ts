import { describe, it, expect } from 'vitest'
import { applyCameraTransform } from './camera'
import type { Container } from 'pixi.js'

/** Minimal mock of a Pixi Container — only the position/scale surface. */
function mockContainer(): Container {
  const pos = { _x: 0, _y: 0 }
  const scl = { _x: 1, _y: 1 }
  return {
    position: {
      get x() { return pos._x },
      get y() { return pos._y },
      set(x: number, y?: number) { pos._x = x; pos._y = y ?? x },
    },
    scale: {
      get x() { return scl._x },
      get y() { return scl._y },
      set(x: number, y?: number) { scl._x = x; scl._y = y ?? x },
    },
  } as unknown as Container
}

describe('applyCameraTransform', () => {
  it('sets position and scale from transform', () => {
    const container = mockContainer()
    applyCameraTransform(container, { x: 50, y: 100, scale: 2 })

    expect(container.position.x).toBe(50)
    expect(container.position.y).toBe(100)
    expect(container.scale.x).toBe(2)
    expect(container.scale.y).toBe(2)
  })

  it('is idempotent — calling twice with same transform produces same result', () => {
    const container = mockContainer()
    const transform = { x: 50, y: 100, scale: 2 }

    applyCameraTransform(container, transform)
    applyCameraTransform(container, transform)

    expect(container.position.x).toBe(50)
    expect(container.position.y).toBe(100)
    expect(container.scale.x).toBe(2)
    expect(container.scale.y).toBe(2)
  })

  it('overwrites previous values (no accumulation)', () => {
    const container = mockContainer()

    applyCameraTransform(container, { x: 10, y: 20, scale: 1.5 })
    applyCameraTransform(container, { x: 30, y: 40, scale: 0.5 })

    expect(container.position.x).toBe(30)
    expect(container.position.y).toBe(40)
    expect(container.scale.x).toBe(0.5)
    expect(container.scale.y).toBe(0.5)
  })

  it('handles zero transform', () => {
    const container = mockContainer()
    applyCameraTransform(container, { x: 0, y: 0, scale: 0 })

    expect(container.position.x).toBe(0)
    expect(container.position.y).toBe(0)
    expect(container.scale.x).toBe(0)
    expect(container.scale.y).toBe(0)
  })
})
