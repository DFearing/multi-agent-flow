'use client'

/**
 * PixiCanvas -- WebGL-based sibling to AgentCanvas.
 *
 * Gated behind `?renderer=pixi`. Same prop contract as AgentCanvas so the
 * two are interchangeable in session-canvas-panel.tsx.
 *
 * All rendering layers are implemented:
 *   background -> edges -> tool-calls -> discoveries -> agents -> bubbles -> particles
 * Bloom post-processing is applied as a stage-level filter.
 * Effects layer (spawn/complete FX) is the only remaining TODO.
 */

import { useRef, useEffect, useState } from 'react'
import type { Application } from 'pixi.js'
import { Container } from 'pixi.js'
import type { SimulationState } from '@/hooks/simulation/types'
import { useCanvasCamera } from '@/hooks/use-canvas-camera'
import { useCanvasInteraction } from '@/hooks/use-canvas-interaction'
import { createPixiApp, disposeTextureCache } from './pixi-app'
import { BackgroundLayer } from './background-layer'
import { AgentsLayer } from './agents-layer'
import { EdgesLayer } from './edges-layer'
import { ToolCallsLayer } from './tool-calls-layer'
import { DiscoveriesLayer } from './discoveries-layer'
import { BubblesLayer } from './bubbles-layer'
import { ParticlesLayer } from './particles-layer'
import { PixiBloomFilter } from './bloom-filter'
import { applyCameraTransform } from './camera'

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
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const backgroundLayerRef = useRef<BackgroundLayer | null>(null)
  const agentsLayerRef = useRef<AgentsLayer | null>(null)
  const edgesLayerRef = useRef<EdgesLayer | null>(null)
  const toolCallsLayerRef = useRef<ToolCallsLayer | null>(null)
  const discoveriesLayerRef = useRef<DiscoveriesLayer | null>(null)
  const bubblesLayerRef = useRef<BubblesLayer | null>(null)
  const particlesLayerRef = useRef<ParticlesLayer | null>(null)
  const bloomFilterRef = useRef<PixiBloomFilter | null>(null)
  const worldRef = useRef<Container | null>(null)
  const animRef = useRef<number>(0)
  const timeRef = useRef(0)
  const lastFrameRef = useRef(0)

  // IntersectionObserver visibility gating
  const visibleRef = useRef(true)
  const needsCatchUpRef = useRef(false)

  // ─── Dimensions (mirrors Canvas2D path) ─────────────────────────────────
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ─── IntersectionObserver: pause render rAF when off-screen ─────────────
  useEffect(() => {
    if (!pauseWhenOffscreen) {
      visibleRef.current = true
      return
    }
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const wasVisible = visibleRef.current
          visibleRef.current = entry.isIntersecting
          if (!wasVisible && entry.isIntersecting) {
            needsCatchUpRef.current = true
          }
        }
      },
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [pauseWhenOffscreen])

  // ─── Canvas ref for camera/interaction hooks ────────────────────────────
  // useCanvasCamera and useCanvasInteraction expect a ref to an element for
  // bounding rect calculations and native wheel listener attachment. In the
  // Canvas2D path this is the <canvas> element; in the Pixi path the canvas
  // is created asynchronously by Pixi. We point mainCanvasRef at the
  // container div instead — it has the same bounding rect (Pixi's canvas
  // fills it via `resizeTo`), and it's available synchronously at mount so
  // useCanvasInteraction's wheel useEffect can attach immediately.
  //
  // The cast to HTMLCanvasElement is safe because the hooks only use
  // getBoundingClientRect() and addEventListener('wheel', ...), both of
  // which are on HTMLElement. If a future hook calls canvas-specific APIs
  // (getContext, toDataURL, etc.), this will need to change.
  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Populate mainCanvasRef from the container div on mount. The cast is safe
  // because the hooks only use getBoundingClientRect() and addEventListener(),
  // both inherited from HTMLElement. This effect runs before the hooks' effects
  // (React fires effects in registration order), so the wheel handler in
  // useCanvasInteraction will find the element on its first (and only) run.
  useEffect(() => {
    if (containerRef.current) {
      mainCanvasRef.current = containerRef.current as unknown as HTMLCanvasElement
    }
  }, [])

  // ─── Simulation time ref (written in draw loop) ─────────────────────────
  const simTimeRef = useRef(0)

  // ─── DrawProps ref for camera + interaction hooks ───────────────────────
  // Matches the contract expected by useCanvasCamera and useCanvasInteraction.
  // Updated at the top of each draw frame from simulationRef.
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

  // Sync React props into drawPropsRef every render (cheap — just ref writes)
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

  // ─── Interaction ────────────────────────────────────────────────────────
  const {
    isDragging, handlers, updateDragLerp,
  } = useCanvasInteraction({
    drawPropsRef, transformRef, userHasNavigatedRef, panVelocityRef,
    simTimeRef, screenToCanvas, doZoomToFit, mainCanvasRef,
  })

  // Keep drawPropsRef in sync with interaction state
  drawPropsRef.current.isDragging = isDragging

  // ─── Scene graph layers ─────────────────────────────────────────────────
  // Each layer is a Container added to the stage in z-order:
  // background -> edges -> tool-calls -> discoveries -> agents -> bubbles -> particles
  // Bloom filter applied at stage level.
  // TODO: effects-layer (spawn/complete FX)

  // ─── Bootstrap ──────────────────────────────────────────────────────────

  // Stable ref for the draw-loop closure so it always reads latest hook values
  const updateCameraRef = useRef(updateCamera)
  updateCameraRef.current = updateCamera
  const updateDragLerpRef = useRef(updateDragLerp)
  updateDragLerpRef.current = updateDragLerp

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let destroyed = false
    let localApp: Application | null = null

    const boot = async () => {
      const app = await createPixiApp({
        container: el,
        width: el.clientWidth,
        height: el.clientHeight,
      })
      if (destroyed) {
        app.destroy(true)
        return
      }

      localApp = app
      appRef.current = app

      // ── Build scene graph ──────────────────────────────────────────
      // World container — camera transform applied here.
      // Screen-space layers (HUD, perf overlay) should be added as
      // siblings of `world` on `app.stage`, NOT as children of `world`.
      const world = new Container()
      world.label = 'world'
      app.stage.addChild(world)
      worldRef.current = world

      // Background layer (behind everything)
      const backgroundLayer = new BackgroundLayer()
      world.addChild(backgroundLayer.container)
      backgroundLayerRef.current = backgroundLayer

      // Edges layer (behind tool calls in z-order, matching Canvas2D draw order)
      const edgesLayer = new EdgesLayer()
      world.addChild(edgesLayer.container)
      edgesLayerRef.current = edgesLayer

      // Tool calls layer (above edges, below discoveries)
      const toolCallsLayer = new ToolCallsLayer()
      world.addChild(toolCallsLayer.container)
      toolCallsLayerRef.current = toolCallsLayer

      // Discoveries layer (above tool calls, below agents)
      const discoveriesLayer = new DiscoveriesLayer()
      world.addChild(discoveriesLayer.container)
      discoveriesLayerRef.current = discoveriesLayer

      // Agents layer (above discoveries, below bubbles)
      const agentsLayer = new AgentsLayer()
      world.addChild(agentsLayer.container)
      agentsLayerRef.current = agentsLayer

      // Bubbles layer (above agents, below particles)
      const bubblesLayer = new BubblesLayer()
      world.addChild(bubblesLayer.container)
      bubblesLayerRef.current = bubblesLayer

      // Particles layer (topmost world-space layer)
      const particlesLayer = new ParticlesLayer()
      world.addChild(particlesLayer.container)
      particlesLayerRef.current = particlesLayer

      // Bloom filter — stage-level post-processing
      const bloomFilter = new PixiBloomFilter(0.6)
      app.stage.filters = [bloomFilter.filter]
      bloomFilterRef.current = bloomFilter

      // ── Animation loop ─────────────────────────────────────────────
      // Uses its own rAF for now. Follow-up PR will consolidate to the
      // shared app.ticker once all layers are migrated.
      const draw = (timestamp: number) => {
        if (destroyed) return
        animRef.current = requestAnimationFrame(draw)

        // Skip rendering when the canvas is off-screen (IntersectionObserver).
        if (!visibleRef.current && !needsCatchUpRef.current) return
        needsCatchUpRef.current = false

        const dt = lastFrameRef.current
          ? (timestamp - lastFrameRef.current) / 1000
          : 0.016
        lastFrameRef.current = timestamp
        timeRef.current += dt

        // Read simulation state from ref — no React re-render needed
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

        // Apply camera transform to the world container
        applyCameraTransform(world, transformRef.current)

        // Update background layer (behind everything)
        backgroundLayer.update(
          p.dimensions.width,
          p.dimensions.height,
          transformRef.current,
          dt,
          timeRef.current,
          showHexGrid,
        )

        // Update edges layer (drawn behind tool calls)
        edgesLayer.update(
          s.edges,
          s.particles,
          s.agents,
          s.toolCalls,
          timeRef.current,
        )

        // Update tool calls layer (above edges, below discoveries)
        toolCallsLayer.update(
          s.toolCalls,
          timeRef.current,
          selectedToolCallId,
        )

        // Update discoveries layer (above tool calls, below agents)
        discoveriesLayer.update(
          s.discoveries,
          s.agents,
          selectedDiscoveryId,
        )

        // Update agents layer (above discoveries, below bubbles)
        agentsLayer.update(
          s.agents,
          selectedAgentId,
          hoveredAgentId,
          showStats,
          timeRef.current,
        )

        // Update bubbles layer (above agents, below particles)
        bubblesLayer.update(s.agents, timeRef.current)

        // Update particles layer
        particlesLayer.update(
          s.particles,
          s.edges,
          s.agents,
          s.toolCalls,
          timeRef.current,
        )
      }

      animRef.current = requestAnimationFrame(draw)
    }

    boot()

    return () => {
      destroyed = true
      if (animRef.current) cancelAnimationFrame(animRef.current)
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
      if (localApp) {
        localApp.destroy(true)
      }
      appRef.current = null
      disposeTextureCache()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      {...handlers}
    />
  )
}
