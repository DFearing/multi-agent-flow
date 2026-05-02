/**
 * Unit tests for the shared Pixi renderer + multi-viewport system.
 *
 * Mocks pixi.js to avoid needing a real GPU context. Verifies:
 *   - Singleton renderer: multiple acquires share one Application
 *   - Viewport registration / deregistration
 *   - Ref counting: release when all viewports gone
 *   - multiView init and direct render-to-canvas
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock pixi.js ────────────────────────────────────────────────────────

const origCreateElement = document.createElement.bind(document)

let appInstanceCount = 0
let lastInitOpts: Record<string, unknown> | null = null

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
      destroy: vi.fn(),
    }
    _destroyed = false

    constructor() {
      appInstanceCount++
    }

    async init(opts: Record<string, unknown>) {
      lastInitOpts = opts
    }

    destroy() {
      this._destroyed = true
    }
  }

  return {
    Application: MockApplication,
    Container: MockContainer,
    Texture: MockTexture,
    Rectangle: MockRectangle,
  }
})

// ─── Import after mocks ──────────────────────────────────────────────────

import {
  acquireSharedRenderer,
  releaseSharedRenderer,
  registerViewport,
  deregisterViewport,
  bindViewportCanvas,
  renderViewport,
  getViewportCount,
  isSharedRendererActive,
} from './pixi-app'

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Shared Pixi Renderer', () => {
  beforeEach(() => {
    appInstanceCount = 0
    lastInitOpts = null
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

  it('initializes with multiView: true', async () => {
    await acquireSharedRenderer()

    expect(lastInitOpts).toBeDefined()
    expect(lastInitOpts!.multiView).toBe(true)
    expect(lastInitOpts!.preference).toBe('webgl')

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

  it('renderViewport calls renderer.render with target canvas and clear', async () => {
    const app = await acquireSharedRenderer()
    registerViewport('vp-render')

    const canvas = origCreateElement('canvas')
    bindViewportCanvas('vp-render', canvas, 800, 600)

    const vp = registerViewport('vp-render') // returns existing

    renderViewport('vp-render')

    const renderMock = app.renderer.render as ReturnType<typeof vi.fn>
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(renderMock).toHaveBeenCalledWith({
      container: vp.stage,
      target: canvas,
      clear: true,
    })

    deregisterViewport('vp-render')
    releaseSharedRenderer()
  })

  it('renderViewport does not call extract.canvas', async () => {
    const app = await acquireSharedRenderer()
    registerViewport('vp-noextract')

    const canvas = origCreateElement('canvas')
    bindViewportCanvas('vp-noextract', canvas, 400, 300)

    renderViewport('vp-noextract')

    // The renderer should not have an extract property used
    expect((app.renderer as unknown as Record<string, unknown>).extract).toBeUndefined()

    deregisterViewport('vp-noextract')
    releaseSharedRenderer()
  })

  it('renderViewport is a no-op when canvas is not bound', async () => {
    const app = await acquireSharedRenderer()
    registerViewport('vp-nocanvas')

    renderViewport('vp-nocanvas')

    const renderMock = app.renderer.render as ReturnType<typeof vi.fn>
    expect(renderMock).not.toHaveBeenCalled()

    deregisterViewport('vp-nocanvas')
    releaseSharedRenderer()
  })
})
