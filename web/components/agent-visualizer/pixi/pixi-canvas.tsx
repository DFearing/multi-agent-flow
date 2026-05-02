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

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type { Application } from 'pixi.js'
import { Container } from 'pixi.js'
import type { SimulationState } from '@/hooks/simulation/types'
import { useCanvasCamera } from '@/hooks/use-canvas-camera'
import { useCanvasInteraction } from '@/hooks/use-canvas-interaction'
import { createPixiHitTestAdapter } from '@/hooks/hit-test-adapters'
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
import { useSimulationManager } from '../simulation-manager-provider'

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
  const manager = useSimulationManager()
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
  /** Set to true once boot() completes and layers are ready. */
  const readyRef = useRef(false)
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

  // ─── Element ref for camera/interaction hooks ───────────────────────────
  // useCanvasCamera and useCanvasInteraction accept RefObject<HTMLElement>.
  // In the Pixi path the canvas is created asynchronously by Pixi, so we
  // point mainCanvasRef at the container div instead — it has the same
  // bounding rect (Pixi's canvas fills it via `resizeTo`), and it's
  // available synchronously at mount so useCanvasInteraction's wheel
  // useEffect can attach immediately.
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
  // ─── Hit-detection adapter (Pixi path) ──────────────────────────────────
  // Stable across renders — the adapter closes over refs, not values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hitTestAdapter = useMemo(
    () => createPixiHitTestAdapter(drawPropsRef, simTimeRef),
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

  // ─── Draw callback (registered with shared render loop) ─────────────
  // Defined at component scope using refs so it doesn't depend on the
  // async boot closure. readyRef gates execution until layers are built.
  const drawRef = useRef<(timestamp: number) => void>(() => {})

  const pixiDraw = useCallback((timestamp: number) => {
    if (!readyRef.current) return

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

    const world = worldRef.current
    if (!world) return

    // Apply camera transform to the world container
    applyCameraTransform(world, transformRef.current)

    // Update layers — all refs are populated after boot
    backgroundLayerRef.current?.update(
      p.dimensions.width,
      p.dimensions.height,
      transformRef.current,
      dt,
      timeRef.current,
      showHexGrid,
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

    bubblesLayerRef.current?.update(s.agents, timeRef.current)

    particlesLayerRef.current?.update(
      s.particles,
      s.edges,
      s.agents,
      s.toolCalls,
      timeRef.current,
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps -- layer refs are stable; hook refs kept in sync above
  }, [simulationRef, transformRef, showHexGrid, selectedToolCallId, selectedDiscoveryId, selectedAgentId, hoveredAgentId, showStats])

  drawRef.current = pixiDraw

  // Register with the shared render loop.
  useEffect(() => {
    const callback = (timestamp: number) => drawRef.current(timestamp)
    return manager.registerRender(callback)
  }, [manager])

  // ─── Bootstrap (scene graph only — no rAF) ─────────────────────────────

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
      const world = new Container()
      world.label = 'world'
      app.stage.addChild(world)
      worldRef.current = world

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

      // Bloom filter — stage-level post-processing
      const bloomFilter = new PixiBloomFilter(0.6)
      app.stage.filters = [bloomFilter.filter]
      bloomFilterRef.current = bloomFilter

      // Signal that the draw callback can start rendering.
      readyRef.current = true
    }

    boot()

    return () => {
      destroyed = true
      readyRef.current = false
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
