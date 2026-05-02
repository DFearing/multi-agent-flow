/**
 * Unit tests for the shared Pixi renderer + multi-viewport system.
 *
 * Mocks pixi.js to avoid needing a real GPU context. Verifies:
 *   - Singleton renderer: multiple acquires share one Application
 *   - Viewport registration / deregistration
 *   - Ref counting: release when all viewports gone
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock pixi.js ────────────────────────────────────────────────────────

const mockCtx = {
  font: '',
  textBaseline: '',
  fillStyle: '',
  measureText: (text: string) => ({ width: text.length * 6 }),
  fillText: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
}

const origCreateElement = document.createElement.bind(document)
vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
  const el = origCreateElement(tag)
  if (tag === 'canvas') {
    (el as HTMLCanvasElement).getContext = (() => mockCtx) as unknown as HTMLCanvasElement['getContext']
  }
  return el
})

let appInstanceCount = 0

vi.mock('pixi.js', () => {
  class MockContainer {
    label = ''
    children: MockContainer[] = []
    filters: unknown[] | null = null
    position = { x: 0, y: 0 }
    scale = { x: 1, y: 1 }
    addChild(child: MockContainer) { this.children.push(child); return child }
    removeChild(child: MockContainer) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) this.children.splice(idx, 1)
    }
    destroy() { this.children.length = 0 }
  }

  class MockTextureSource {
    _id = 0
  }

  class MockTexture {
    source = new MockTextureSource()
    frame = { x: 0, y: 0, width: 0, height: 0 }
    _destroyed = false
    constructor() {}
    destroy() { this._destroyed = true }
    static from(_opts: unknown): MockTexture { return new MockTexture() }
  }

  class MockRenderTexture {
    _destroyed = false
    destroy() { this._destroyed = true }
    static create(_opts: unknown): MockRenderTexture { return new MockRenderTexture() }
  }

  class MockRectangle {
    x: number; y: number; width: number; height: number
    constructor(x = 0, y = 0, w = 0, h = 0) {
      this.x = x; this.y = y; this.width = w; this.height = h
    }
  }

  class MockApplication {
    stage = new MockContainer()
    canvas = origCreateElement('canvas')
    renderer = {
      resolution: 1,
      render: vi.fn(),
      extract: {
        canvas: vi.fn(() => origCreateElement('canvas')),
      },
      destroy: vi.fn(),
    }
    _destroyed = false

    constructor() {
      appInstanceCount++
    }

    async init(_opts: unknown) {
      // no-op
    }

    destroy() {
      this._destroyed = true
    }
  }

  return {
    Application: MockApplication,
    Container: MockContainer,
    Texture: MockTexture,
    RenderTexture: MockRenderTexture,
    Rectangle: MockRectangle,
  }
})

// ─── Import after mocks ──────────────────────────────────────────────────

import {
  acquireSharedRenderer,
  releaseSharedRenderer,
  registerViewport,
  deregisterViewport,
  getViewportCount,
  isSharedRendererActive,
} from './pixi-app'

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Shared Pixi Renderer', () => {
  beforeEach(() => {
    appInstanceCount = 0
    // Clean up any leftover state from previous tests
    while (isSharedRendererActive()) {
      releaseSharedRenderer()
    }
  })

  afterEach(() => {
    while (isSharedRendererActive()) {
      releaseSharedRenderer()
    }
  })

  it('creates exactly one Application across multiple acquires', async () => {
    const app1 = await acquireSharedRenderer()
    const app2 = await acquireSharedRenderer()

    expect(app1).toBe(app2)
    expect(appInstanceCount).toBe(1)

    releaseSharedRenderer()
    releaseSharedRenderer()
  })

  it('isSharedRendererActive returns true after acquire', async () => {
    expect(isSharedRendererActive()).toBe(false)

    await acquireSharedRenderer()
    expect(isSharedRendererActive()).toBe(true)

    releaseSharedRenderer()
    expect(isSharedRendererActive()).toBe(false)
  })

  it('registerViewport creates a viewport with a stage container', async () => {
    await acquireSharedRenderer()

    const vp = registerViewport('vp-1')
    expect(vp).toBeDefined()
    expect(vp.id).toBe('vp-1')
    expect(vp.stage).toBeDefined()
    expect(getViewportCount()).toBe(1)

    deregisterViewport('vp-1')
    expect(getViewportCount()).toBe(0)

    releaseSharedRenderer()
  })

  it('multiple viewports coexist on the same renderer', async () => {
    await acquireSharedRenderer()

    registerViewport('vp-a')
    registerViewport('vp-b')
    registerViewport('vp-c')

    expect(getViewportCount()).toBe(3)
    // Still only one Application
    expect(appInstanceCount).toBe(1)

    deregisterViewport('vp-a')
    deregisterViewport('vp-b')
    deregisterViewport('vp-c')

    releaseSharedRenderer()
  })

  it('deregisterViewport is idempotent', async () => {
    await acquireSharedRenderer()
    registerViewport('vp-x')

    deregisterViewport('vp-x')
    deregisterViewport('vp-x') // no-op, no throw
    expect(getViewportCount()).toBe(0)

    releaseSharedRenderer()
  })

  it('releaseSharedRenderer destroys app when refCount reaches 0', async () => {
    await acquireSharedRenderer()
    await acquireSharedRenderer()

    expect(isSharedRendererActive()).toBe(true)
    releaseSharedRenderer()
    expect(isSharedRendererActive()).toBe(true) // still ref'd
    releaseSharedRenderer()
    expect(isSharedRendererActive()).toBe(false) // destroyed
  })

  it('re-acquires a fresh app after full release', async () => {
    const app1 = await acquireSharedRenderer()
    releaseSharedRenderer()
    expect(isSharedRendererActive()).toBe(false)

    const app2 = await acquireSharedRenderer()
    // New instance — not the same object
    expect(app2).not.toBe(app1)
    expect(appInstanceCount).toBe(2)

    releaseSharedRenderer()
  })
})
