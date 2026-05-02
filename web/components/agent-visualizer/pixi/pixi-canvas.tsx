'use client'

/**
 * PixiCanvas -- WebGL-based sibling to AgentCanvas.
 *
 * Gated behind `?renderer=pixi`. Same prop contract as AgentCanvas so the
 * two are interchangeable in session-canvas-panel.tsx.
 *
 * Uses the shared Pixi renderer (single GL context, multiView). Each
 * PixiCanvas instance registers a viewport that owns:
 *   - A Container (scene-graph subtree with all layers)
 *   - A visible <canvas> element (rendered into directly each frame)
 *
 * Rendering layers (z-order):
 *   background -> edges -> tool-calls -> discoveries -> agents -> bubbles -> particles
 * Bloom post-processing is applied per-viewport as a stage-level filter.
 */

import { useRef, useEffect, useState, useMemo, useId } from 'react'
import { Container, EventBoundary } from 'pixi.js'
import type { SimulationState } from '@/hooks/simulation/types'
import { useCanvasCamera } from '@/hooks/use-canvas-camera'
import { useCanvasInteraction } from '@/hooks/use-canvas-interaction'
import { useCanvasVisibility } from '@/hooks/use-canvas-visibility'
import { createPixiHitTestAdapter } from '@/hooks/hit-test-adapters'
import {
  acquireSharedRenderer,
  releaseSharedRenderer,
  registerViewport,
  deregisterViewport,
  bindViewportCanvas,
  resizeViewport,
  renderViewport,
  setViewportBoundaryRoot,
} from './pixi-app'
import type { Viewport } from './pixi-app'
import { BackgroundLayer } from './background-layer'
import { AgentsLayer } from './agents-layer'
import { EdgesLayer } from './edges-layer'
import { ToolCallsLayer } from './tool-calls-layer'
import { DiscoveriesLayer } from './discoveries-layer'
import { BubblesLayer } from './bubbles-layer'
import { ParticlesLayer } from './particles-layer'
import { PixiBloomFilter } from './bloom-filter'
import { applyCameraTransform } from './camera'
import { useSimulationManager } from '../simulation-manager-provider'
import type { EffectToggles } from '@/hooks/use-perf-settings'

const DEFAULT_EFFECTS: EffectToggles = {
  bloom: true,
  particles: true,
  bubbles: true,
  backgroundParticles: true,
}

interface CanvasProps {
  /** Ref to simulation state — read every frame without React re-renders */
  simulationRef: React.RefObject<SimulationState>
  selectedAgentId: string | null
  hoveredAgentId: string | null
  showStats: boolean
  showHexGrid: boolean
  zoomToFitTrigger?: number
  pauseAutoFit?: boolean
  onAgentClick: (agentId: string | null) => void
  onAgentHover: (agentId: string | null) => void
  onAgentDrag: (agentId: string, x: number, y: number) => void
  onContextMenu: (e: React.MouseEvent, type: 'agent' | 'edge' | 'canvas', id?: string) => void
  onToolCallClick?: (toolCallId: string | null) => void
  selectedToolCallId?: string | null
  onDiscoveryClick?: (discoveryId: string | null) => void
  selectedDiscoveryId?: string | null
  showCostOverlay?: boolean
  minZoomLevel?: number
  sessionId?: string
  /** When true (default), pause the render rAF when the canvas scrolls
   *  off-screen. The simulation sub-state keeps ticking so stats panels
   *  still receive fresh data. */
  pauseWhenOffscreen?: boolean
  /** Per-effect toggles. Disabled effects skip their per-frame update and
   *  hide their display objects so the GPU can cull the empty subtree. */
  effects?: EffectToggles
}

export function PixiCanvas({
  simulationRef,
  selectedAgentId,
  hoveredAgentId,
  showStats,
  showHexGrid,
  zoomToFitTrigger,
  pauseAutoFit,
  onAgentClick,
  onAgentHover,
  onAgentDrag,
  onContextMenu,
  onToolCallClick,
  selectedToolCallId,
  onDiscoveryClick,
  selectedDiscoveryId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showCostOverlay,
  minZoomLevel,
  pauseWhenOffscreen = true,
  effects = DEFAULT_EFFECTS,
}: CanvasProps) {
  const manager = useSimulationManager()
  const containerRef = useRef<HTMLDivElement>(null)
  const visibleCanvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport | null>(null)
  const backgroundLayerRef = useRef<BackgroundLayer | null>(null)
  const agentsLayerRef = useRef<AgentsLayer | null>(null)
  const edgesLayerRef = useRef<EdgesLayer | null>(null)
  const toolCallsLayerRef = useRef<ToolCallsLayer | null>(null)
  const discoveriesLayerRef = useRef<DiscoveriesLayer | null>(null)
  const bubblesLayerRef = useRef<BubblesLayer | null>(null)
  const particlesLayerRef = useRef<ParticlesLayer | null>(null)
  const bloomFilterRef = useRef<PixiBloomFilter | null>(null)
  const worldRef = useRef<Container | null>(null)
  const boundaryRef = useRef<EventBoundary | null>(null)
  /** Set to true once boot() completes and layers are ready. */
  const readyRef = useRef(false)
  /** Mirror of readyRef for effect dependencies — refs aren't reactive. */
  const [booted, setBooted] = useState(false)
  const timeRef = useRef(0)
  const lastFrameRef = useRef(0)

  // Stable viewport id for this component instance
  const viewportId = useId()

  // Visibility gating: IntersectionObserver + document.visibilityState
  const { visibleRef, needsCatchUpRef } = useCanvasVisibility(containerRef, pauseWhenOffscreen)

  // ─── Dimensions (mirrors Canvas2D path) ─────────────────────────────────
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        const h = entry.contentRect.height
        setDimensions({ width: w, height: h })
        resizeViewport(viewportId, w, h)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportId])

  // ─── Element ref for camera/interaction hooks ───────────────────────────
  // useCanvasCamera and useCanvasInteraction accept RefObject<HTMLElement>.
  // We use the container div — it has the same bounding rect as the canvas.
  const mainCanvasRef = useRef<HTMLElement | null>(null)

  // Populate mainCanvasRef from the container div on mount.
  useEffect(() => {
    if (containerRef.current) {
      mainCanvasRef.current = containerRef.current
    }
  }, [])

  // ─── Simulation time ref (written in draw loop) ─────────────────────────
  const simTimeRef = useRef(0)

  // ─── DrawProps ref for camera + interaction hooks ───────────────────────
  const sim = simulationRef.current
  const drawPropsRef = useRef({
    agents: sim.agents,
    toolCalls: sim.toolCalls,
    discoveries: sim.discoveries,
    dimensions,
    selectedAgentId,
    pauseAutoFit,
    isDragging: false,
    onAgentClick,
    onAgentHover,
    onAgentDrag,
    onContextMenu,
    onToolCallClick,
    onDiscoveryClick,
  })

  // Sync React props into drawPropsRef every render
  drawPropsRef.current.selectedAgentId = selectedAgentId
  drawPropsRef.current.pauseAutoFit = pauseAutoFit
  drawPropsRef.current.dimensions = dimensions
  drawPropsRef.current.onAgentClick = onAgentClick
  drawPropsRef.current.onAgentHover = onAgentHover
  drawPropsRef.current.onAgentDrag = onAgentDrag
  drawPropsRef.current.onContextMenu = onContextMenu
  drawPropsRef.current.onToolCallClick = onToolCallClick
  drawPropsRef.current.onDiscoveryClick = onDiscoveryClick

  // ─── Camera ─────────────────────────────────────────────────────────────
  const {
    transformRef, userHasNavigatedRef, panVelocityRef,
    screenToCanvas, doZoomToFit, updateCamera,
  } = useCanvasCamera({
    mainCanvasRef, drawPropsRef, simTimeRef, dimensions,
    agentCount: sim.agents.size, zoomToFitTrigger, selectedAgentId,
    minZoomLevel,
  })

  // ─── Hit-detection adapter (Pixi path) ──────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hitTestAdapter = useMemo(
    () => createPixiHitTestAdapter(boundaryRef),
    [],
  )

  const {
    isDragging, handlers, updateDragLerp,
  } = useCanvasInteraction({
    drawPropsRef, transformRef, userHasNavigatedRef, panVelocityRef,
    simTimeRef, screenToCanvas, doZoomToFit, mainCanvasRef,
    hitTestAdapter,
  })

  // Keep drawPropsRef in sync with interaction state
  drawPropsRef.current.isDragging = isDragging

  // ─── Bootstrap ──────────────────────────────────────────────────────────

  const updateCameraRef = useRef(updateCamera)
  updateCameraRef.current = updateCamera
  const updateDragLerpRef = useRef(updateDragLerp)
  updateDragLerpRef.current = updateDragLerp

  // ─── Draw callback (registered with shared render loop) ─────────────
  // The render-loop registration reads through drawRef.current, so identity
  // stability isn't observed downstream — useCallback would be pure overhead.
  const drawRef = useRef<(timestamp: number) => void>(() => {})

  const pixiDraw = (timestamp: number) => {
    if (!readyRef.current) return

    // Skip rendering when the canvas is off-screen (IntersectionObserver).
    if (!visibleRef.current && !needsCatchUpRef.current) return
    needsCatchUpRef.current = false

    const dt = lastFrameRef.current
      ? (timestamp - lastFrameRef.current) / 1000
      : 0.016
    lastFrameRef.current = timestamp
    timeRef.current += dt

    // Read simulation state from ref
    const s = simulationRef.current
    const p = drawPropsRef.current
    p.agents = s.agents
    p.toolCalls = s.toolCalls
    p.discoveries = s.discoveries
    if (s.currentTime != null) simTimeRef.current = s.currentTime

    // Camera physics (inertia + auto-fit)
    updateCameraRef.current(p.isDragging, p.pauseAutoFit)

    // Floaty agent drag
    updateDragLerpRef.current(s.agents, p.onAgentDrag)

    const world = worldRef.current
    if (!world) return

    // Apply camera transform to the world container
    applyCameraTransform(world, transformRef.current)

    // Update layers
    backgroundLayerRef.current?.update(
      p.dimensions.width,
      p.dimensions.height,
      transformRef.current,
      dt,
      timeRef.current,
      showHexGrid,
      undefined,
      effects.backgroundParticles,
    )

    edgesLayerRef.current?.update(
      s.edges,
      s.particles,
      s.agents,
      s.toolCalls,
      timeRef.current,
    )

    toolCallsLayerRef.current?.update(
      s.toolCalls,
      timeRef.current,
      selectedToolCallId,
    )

    discoveriesLayerRef.current?.update(
      s.discoveries,
      s.agents,
      selectedDiscoveryId,
    )

    agentsLayerRef.current?.update(
      s.agents,
      selectedAgentId,
      hoveredAgentId,
      showStats,
      timeRef.current,
    )

    // Disabled-effect layers skip their update entirely and hide their
    // container — saves both the JS update cost and the GPU draw call.
    if (bubblesLayerRef.current) {
      bubblesLayerRef.current.container.visible = effects.bubbles
      if (effects.bubbles) {
        bubblesLayerRef.current.update(s.agents, timeRef.current)
      }
    }

    if (particlesLayerRef.current) {
      particlesLayerRef.current.container.visible = effects.particles
      if (effects.particles) {
        particlesLayerRef.current.update(
          s.particles,
          s.edges,
          s.agents,
          s.toolCalls,
          timeRef.current,
        )
      }
    }

    // Render this viewport via the shared renderer and blit to the visible canvas
    renderViewport(viewportId)
  }

  drawRef.current = pixiDraw

  // Register with the shared render loop.
  useEffect(() => {
    const callback = (timestamp: number) => drawRef.current(timestamp)
    return manager.registerRender(callback)
  }, [manager])

  // ─── Bootstrap (shared renderer + scene graph) ─────────────────────────

  useEffect(() => {
    const el = containerRef.current
    const canvas = visibleCanvasRef.current
    if (!el || !canvas) return

    let destroyed = false
    // Set true once boot passes the destroyed-check; from that point on
    // cleanup owns the matching releaseSharedRenderer() call. If cleanup
    // runs while acquired is still false, boot's own destroyed-check
    // releases — preventing a double-release on the refCount.
    let acquired = false

    const boot = async () => {
      // Acquire the shared renderer (creates the GL context on first call)
      await acquireSharedRenderer()

      if (destroyed) {
        releaseSharedRenderer()
        return
      }

      acquired = true

      // Register this component as a viewport
      const viewport = registerViewport(viewportId)
      viewportRef.current = viewport

      // Bind the visible canvas to the viewport
      const w = el.clientWidth || 800
      const h = el.clientHeight || 600
      bindViewportCanvas(viewportId, canvas, w, h)

      // ── Build scene graph within the viewport's stage ────────────
      const world = new Container()
      world.label = 'world'
      viewport.stage.addChild(world)
      worldRef.current = world

      // Set up EventBoundary for per-pixel hit-testing against the world
      setViewportBoundaryRoot(viewportId, world)
      boundaryRef.current = viewport.boundary

      backgroundLayerRef.current = new BackgroundLayer()
      world.addChild(backgroundLayerRef.current.container)

      edgesLayerRef.current = new EdgesLayer()
      world.addChild(edgesLayerRef.current.container)

      toolCallsLayerRef.current = new ToolCallsLayer()
      world.addChild(toolCallsLayerRef.current.container)

      discoveriesLayerRef.current = new DiscoveriesLayer()
      world.addChild(discoveriesLayerRef.current.container)

      agentsLayerRef.current = new AgentsLayer()
      world.addChild(agentsLayerRef.current.container)

      bubblesLayerRef.current = new BubblesLayer()
      world.addChild(bubblesLayerRef.current.container)

      particlesLayerRef.current = new ParticlesLayer()
      world.addChild(particlesLayerRef.current.container)

      // Bloom filter — per-viewport post-processing. Attached on demand by
      // the bloom-toggle effect below; we only construct it here.
      const bloomFilter = new PixiBloomFilter(0.6)
      bloomFilterRef.current = bloomFilter

      // Signal that the draw callback can start rendering.
      readyRef.current = true
      setBooted(true)
    }

    boot()

    return () => {
      destroyed = true
      readyRef.current = false
      setBooted(false)

      // Dispose layers (before deregisterViewport destroys the stage)
      if (backgroundLayerRef.current) {
        backgroundLayerRef.current.dispose()
        backgroundLayerRef.current = null
      }
      if (agentsLayerRef.current) {
        agentsLayerRef.current.dispose()
        agentsLayerRef.current = null
      }
      if (toolCallsLayerRef.current) {
        toolCallsLayerRef.current.dispose()
        toolCallsLayerRef.current = null
      }
      if (discoveriesLayerRef.current) {
        discoveriesLayerRef.current.dispose()
        discoveriesLayerRef.current = null
      }
      if (bubblesLayerRef.current) {
        bubblesLayerRef.current.dispose()
        bubblesLayerRef.current = null
      }
      if (edgesLayerRef.current) {
        edgesLayerRef.current.dispose()
        edgesLayerRef.current = null
      }
      if (particlesLayerRef.current) {
        particlesLayerRef.current.destroy()
        particlesLayerRef.current = null
      }
      if (bloomFilterRef.current) {
        bloomFilterRef.current.dispose()
        bloomFilterRef.current = null
      }
      worldRef.current = null
      viewportRef.current = null

      // Only deregister + release if boot reached the post-acquire phase.
      // Otherwise boot's own destroyed-check releases.
      if (acquired) {
        deregisterViewport(viewportId)
        releaseSharedRenderer()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, [viewportId])

  // ─── Bloom on/off ───────────────────────────────────────────────────────
  // Attach or detach the bloom post-processing filter as the user toggles
  // it. Skipping the filter entirely (vs. setting intensity to 0) avoids
  // the off-screen render-target pass.
  useEffect(() => {
    if (!booted) return
    const viewport = viewportRef.current
    const bloom = bloomFilterRef.current
    if (!viewport || !bloom) return
    viewport.stage.filters = effects.bloom ? [bloom.filter] : []
  }, [booted, effects.bloom])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      {...handlers}
    >
      <canvas
        ref={visibleCanvasRef}
        className="w-full h-full"
        style={{ width: dimensions.width, height: dimensions.height }}
      />
    </div>
  )
}
