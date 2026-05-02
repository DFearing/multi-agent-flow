/**
 * Unit tests for PixiBloomFilter -- validates filter construction,
 * intensity uniform updates, and disposal.
 *
 * Run with: cd web && pnpm test
 *
 * Visual verification is not possible in jsdom; these tests cover
 * the API surface and uniform wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock pixi.js ─────────────────────────────────────────────────────

const { mockFilterDestroy } = vi.hoisted(() => ({
  mockFilterDestroy: vi.fn(),
}))

vi.mock('pixi.js', () => {
  class MockFilter {
    resources: Record<string, { uniforms: Record<string, number> }>
    padding: number
    resolution: number | string
    destroy = mockFilterDestroy

    constructor(opts: {
      glProgram: unknown
      resources: Record<string, Record<string, { value: number; type: string }>>
      padding?: number
      resolution?: number | string
    }) {
      // Flatten the resource descriptors into plain uniform values
      // so the filter code can read/write .uniforms.uIntensity etc.
      this.resources = {}
      for (const [groupName, group] of Object.entries(opts.resources)) {
        const uniforms: Record<string, number> = {}
        for (const [key, desc] of Object.entries(group)) {
          uniforms[key] = (desc as { value: number }).value
        }
        this.resources[groupName] = { uniforms }
      }
      this.padding = opts.padding ?? 0
      this.resolution = opts.resolution ?? 1
    }
  }

  class MockGlProgram {
    vertex: string
    fragment: string
    constructor(opts: { vertex: string; fragment: string }) {
      this.vertex = opts.vertex
      this.fragment = opts.fragment
    }
    static from(opts: { vertex: string; fragment: string }) {
      return new MockGlProgram(opts)
    }
  }

  return {
    Filter: MockFilter,
    GlProgram: MockGlProgram,
  }
})

// ─── Import after mocks ─────────────────────────────────────────────────

import { PixiBloomFilter } from './bloom-filter'

// ─── Tests ──────────────────────────────────────────────────────────────

describe('PixiBloomFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs with default intensity', () => {
    const bloom = new PixiBloomFilter()
    expect(bloom.getIntensity()).toBe(0.6)
    expect(bloom.filter).toBeDefined()
    expect(bloom.filter.resources.bloomUniforms.uniforms.uIntensity).toBe(0.6)
  })

  it('constructs with custom intensity', () => {
    const bloom = new PixiBloomFilter(0.8)
    expect(bloom.getIntensity()).toBe(0.8)
    expect(bloom.filter.resources.bloomUniforms.uniforms.uIntensity).toBe(0.8)
  })

  it('setIntensity updates the uniform', () => {
    const bloom = new PixiBloomFilter()
    bloom.setIntensity(0.3)
    expect(bloom.getIntensity()).toBe(0.3)
    expect(bloom.filter.resources.bloomUniforms.uniforms.uIntensity).toBe(0.3)
  })

  it('setIntensity clamps to 0..1', () => {
    const bloom = new PixiBloomFilter()
    bloom.setIntensity(-0.5)
    expect(bloom.getIntensity()).toBe(0)
    bloom.setIntensity(2.0)
    expect(bloom.getIntensity()).toBe(1)
  })

  it('setThreshold updates the uniform', () => {
    const bloom = new PixiBloomFilter()
    bloom.setThreshold(0.5)
    expect(bloom.filter.resources.bloomUniforms.uniforms.uThreshold).toBe(0.5)
  })

  it('setBlurSize updates the uniform', () => {
    const bloom = new PixiBloomFilter()
    bloom.setBlurSize(8.0)
    expect(bloom.filter.resources.bloomUniforms.uniforms.uBlurSize).toBe(8.0)
  })

  it('dispose calls filter.destroy', () => {
    const bloom = new PixiBloomFilter()
    bloom.dispose()
    expect(mockFilterDestroy).toHaveBeenCalledTimes(1)
  })
})
