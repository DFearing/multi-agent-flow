'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Particle, Edge, Discovery, DepthParticle } from '@/lib/agent-types'
import type { SimulationState } from '@/hooks/simulation/types'
import { getStateColor } from '@/lib/colors'
import { ANIM_SPEED, PERF_OVERLAY, PERF_OVERLAY_ENABLED, PERF_STRESS_MULTIPLIER } from '@/lib/canvas-constants'
import { BloomRenderer } from './bloom-renderer'
import { createDepthParticles, updateDepthParticles, drawBackground, createHexGridCache, type HexGridCache } from './background-layer'
import {
  type VisualEffect,
  drawTetherLine,
  drawEffects,
  drawAgents,
  drawMessageBubblesWorld,
  drawEdges, getActiveEdgeIds,
  drawParticles, buildEdgeMap,
  drawToolCalls,
  drawDiscoveries, drawDiscoveryConnections,
  drawCostLabels,
  detectStateChanges as detectStateChangesPure,
  computeViewBounds,
  pruneOverlayCache,
} from './canvas/'
import { useCanvasCamera } from '@/hooks/use-canvas-camera'
import { useCanvasInteraction } from '@/hooks/use-canvas-interaction'
import { useCanvasVisibility } from '@/hooks/use-canvas-visibility'
import { createCanvas2DHitTestAdapter } from '@/hooks/hit-test-adapters'
import { useSimulationManager } from './simulation-manager-provider'

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
  /** When false, the Canvas2D bloom post-processing pass is skipped entirely.
   *  Defaults to true to preserve existing visual appearance. */
  bloomEnabled?: boolean
  /** Run the bloom pass every Nth frame (1 = every frame). Intermediate frames
   *  reuse the cached bloom output. Defaults to 1. */
  bloomThrottle?: number
  /** Floor for the auto-fit scale. 0 (default) = no minimum. Manual wheel
   *  zoom is unaffected; this only constrains the auto-fit lerp. */
  minZoomLevel?: number
  /** Session id this canvas is rendering — currently unused but kept on the
   *  prop so callers can pass it without a type error; future per-session
   *  overlays (cost, badges) can read it. */
  sessionId?: string
  /** When true (default), pause the render rAF when the canvas scrolls
   *  off-screen. The simulation sub-state keeps ticking so stats panels
   *  still receive fresh data. */
  pauseWhenOffscreen?: boolean
}

export function AgentCanvas({
  simulationRef,
  selectedAgentId, hoveredAgentId, showStats, showHexGrid, zoomToFitTrigger, pauseAutoFit,
  onAgentClick, onAgentHover, onAgentDrag, onContextMenu, onToolCallClick, selectedToolCallId, onDiscoveryClick, selectedDiscoveryId, showCostOverlay,
  bloomEnabled = true, bloomThrottle = 1, minZoomLevel, pauseWhenOffscreen = true,
}: CanvasProps) {
  const manager = useSimulationManager()
  const containerRef = useRef<HTMLDivElement>(null)
  const mainCanvasRef = useRef<HTMLCanvasElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const dimensionsRef = useRef(dimensions)
  dimensionsRef.current = dimensions
  const timeRef = useRef(0)
  const simTimeRef = useRef(0)
  const bloomRef = useRef<BloomRenderer | null>(null)
  const bloomFrameCounterRef = useRef(0)
  const bloomThrottleRef = useRef(bloomThrottle)
  bloomThrottleRef.current = bloomThrottle
  const depthParticlesRef = useRef<DepthParticle[]>([])
  const lastFrameTimeRef = useRef(0)
  const dprRef = useRef(1)
  const hexGridCacheRef = useRef<HexGridCache>(createHexGridCache())

  // Effects system. `agentStatesA/B` and `toolStatesA/B` are alternating
  // snapshot pairs that detectStateChanges ping-pongs between — we hold them
  // in refs and just .clear() one of each pair per frame, instead of letting
  // the detector allocate a fresh Map every time.
  const effectsRef = useRef<VisualEffect[]>([])
  const agentStatesARef = useRef<Map<string, string>>(new Map())
  const agentStatesBRef = useRef<Map<string, string>>(new Map())
  const toolStatesARef = useRef<Map<string, string>>(new Map())
  const toolStatesBRef = useRef<Map<string, string>>(new Map())
  const stateMapsUseARef = useRef(true)

  // Visibility gating: IntersectionObserver + document.visibilityState
  const { visibleRef, needsCatchUpRef } = useCanvasVisibility(containerRef, pauseWhenOffscreen)

  // Rate-limited error logging for the draw loop (avoid flooding console)
  const lastDrawErrorRef = useRef(0)

  // Performance overlay state
  const perfRef = useRef({
    frames: 0,
    lastFpsUpdate: 0,
    fps: 0,
    frameTimeMs: 0,
    frameTimes: [] as number[],
    p95: 0,
  })

  // Caches for per-frame lookups — avoid rebuilding Set/Map every ~16ms
  const edgeLookupCacheRef = useRef<{
    particles: Particle[]
    edges: Edge[]
    activeEdgeIds: Set<string>
    edgeMap: Map<string, Edge>
  }>({ particles: [], edges: [], activeEdgeIds: new Set(), edgeMap: new Map() })

  // ─── Stable refs for animation loop & event handlers ────────────────────
  // Simulation data (agents, particles, etc.) is synced from simulationRef
  // at the top of each draw frame, so it's always fresh even without re-renders.
  // The drawProps object itself is allocated ONCE — every subsequent render
  // mutates fields in place rather than reallocating. Parents re-render at
  // ~4 Hz (UI cadence) plus drag/resize, so the closure + spread cost adds
  // up; mirroring the Pixi twin (`pixi-canvas.tsx`) keeps both paths uniform.
  const sim = simulationRef.current
  const drawPropsRef = useRef({
    agents: sim.agents, toolCalls: sim.toolCalls,
    particles: sim.particles, edges: sim.edges, discoveries: sim.discoveries,
    selectedAgentId, hoveredAgentId, showStats, showHexGrid,
    showCostOverlay, selectedToolCallId, selectedDiscoveryId,
    simTime: sim.currentTime, pauseAutoFit, dimensions,
    onAgentDrag, onAgentClick, onAgentHover, onContextMenu,
    onToolCallClick, onDiscoveryClick,
    isDragging: false,
  })

  // Sync React-driven props into the existing ref each render. Simulation
  // data (agents/edges/etc.) is intentionally NOT updated here — the draw
  // loop overwrites those each frame from `simulationRef.current` so this
  // hot path stays a tiny field-assignment block.
  {
    const p = drawPropsRef.current
    p.selectedAgentId = selectedAgentId
    p.hoveredAgentId = hoveredAgentId
    p.showStats = showStats
    p.showHexGrid = showHexGrid
    p.showCostOverlay = showCostOverlay
    p.selectedToolCallId = selectedToolCallId
    p.selectedDiscoveryId = selectedDiscoveryId
    p.pauseAutoFit = pauseAutoFit
    p.dimensions = dimensions
    p.onAgentDrag = onAgentDrag
    p.onAgentClick = onAgentClick
    p.onAgentHover = onAgentHover
    p.onContextMenu = onContextMenu
    p.onToolCallClick = onToolCallClick
    p.onDiscoveryClick = onDiscoveryClick
  }

  // ─── Camera ─────────────────────────────────────────────────────────────
  const {
    transformRef, userHasNavigatedRef, panVelocityRef,
    screenToCanvas, doZoomToFit, updateCamera,
  } = useCanvasCamera({
    mainCanvasRef, drawPropsRef, simTimeRef, dimensions,
    agentCount: sim.agents.size, zoomToFitTrigger, selectedAgentId,
    minZoomLevel,
  })

  // ─── Hit-detection adapter (Canvas2D path) ──────────────────────────────
  // Stable across renders — the adapter closes over refs, not values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hitTestAdapter = useMemo(
    () => createCanvas2DHitTestAdapter(drawPropsRef, simTimeRef),
    [],
  )

  // ─── Interaction ────────────────────────────────────────────────────────
  const {
    isDragging, handlers, updateDragLerp,
  } = useCanvasInteraction({
    drawPropsRef, transformRef, userHasNavigatedRef, panVelocityRef,
    simTimeRef, screenToCanvas, doZoomToFit, mainCanvasRef,
    hitTestAdapter,
  })

  // Keep drawPropsRef in sync with interaction state
  drawPropsRef.current.isDragging = isDragging

  // ─── Setup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (bloomEnabled) {
      const bloom = new BloomRenderer(0.5)
      // Fix: immediately resize so bloom works before the next ResizeObserver
      // fires. Without this, the internal canvas stays 0x0 and apply() early-
      // returns after toggling bloom off then back on.
      const dpr = dprRef.current
      const w = dimensionsRef.current.width
      const h = dimensionsRef.current.height
      if (w > 0 && h > 0) bloom.resize(w * dpr, h * dpr)
      bloomRef.current = bloom
      bloomFrameCounterRef.current = 0
    } else {
      bloomRef.current = null
    }
    depthParticlesRef.current = createDepthParticles(dimensionsRef.current.width, dimensionsRef.current.height)
    return () => { bloomRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- particles created once, resized by draw loop
  }, [bloomEnabled])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      // Re-read DPR each resize: dragging the window between monitors with
      // different pixel densities triggers a resize without firing our
      // matchMedia listener for the OLD DPR (it only fires once when the
      // current density boundary is crossed). Refreshing here keeps the
      // backing store correctly sized regardless of which event fires first.
      const dpr = window.devicePixelRatio || 1
      dprRef.current = dpr
      for (const entry of entries) {
        const w = entry.contentRect.width
        const h = entry.contentRect.height
        setDimensions({ width: w, height: h })
        bloomRef.current?.resize(w * dpr, h * dpr)
      }
    })
    observer.observe(container)

    // matchMedia for the current resolution fires when DPR crosses any
    // boundary (zoom, monitor swap on browsers that don't trigger resize).
    // After a change we must re-subscribe at the new DPR — the previous
    // query no longer matches and won't fire again.
    let mql: MediaQueryList | null = null
    let onChange: (() => void) | null = null
    const subscribeDpr = () => {
      const dpr = window.devicePixelRatio || 1
      dprRef.current = dpr
      mql = window.matchMedia(`(resolution: ${dpr}dppx)`)
      onChange = () => {
        const newDpr = window.devicePixelRatio || 1
        dprRef.current = newDpr
        const w = dimensionsRef.current.width
        const h = dimensionsRef.current.height
        if (w > 0 && h > 0) bloomRef.current?.resize(w * newDpr, h * newDpr)
        if (mql && onChange) mql.removeEventListener('change', onChange)
        subscribeDpr()
      }
      mql.addEventListener('change', onChange)
    }
    subscribeDpr()

    return () => {
      observer.disconnect()
      if (mql && onChange) mql.removeEventListener('change', onChange)
    }
  }, [])


  // ─── Detect state changes → spawn effects ──────────────────────────────

  const detectStateChanges = useCallback(() => {
    const { agents, toolCalls } = drawPropsRef.current
    const useA = stateMapsUseARef.current
    const prevAgents = useA ? agentStatesARef.current : agentStatesBRef.current
    const outAgents = useA ? agentStatesBRef.current : agentStatesARef.current
    const prevTools  = useA ? toolStatesARef.current  : toolStatesBRef.current
    const outTools   = useA ? toolStatesBRef.current  : toolStatesARef.current
    const { effects } = detectStateChangesPure(
      agents, toolCalls,
      prevAgents, prevTools,
      outAgents, outTools,
    )
    effectsRef.current.push(...effects)
    stateMapsUseARef.current = !useA
  }, [])

  // ─── Main draw loop ────────────────────────────────────────────────────

  // Stable ref so the rAF loop always calls the latest draw without
  // re-subscribing when the callback identity changes.
  const drawRef = useRef<(timestamp: number) => void>(() => {})

  const draw = useCallback((timestamp: number) => {
    // Skip rendering when the canvas is off-screen (IntersectionObserver).
    // The simulation sub-state keeps ticking via the shared manager.
    if (!visibleRef.current && !needsCatchUpRef.current) return
    needsCatchUpRef.current = false

    const canvas = mainCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      // Sync simulation data from ref — always fresh, independent of React renders.
      {
        const s = simulationRef.current
        const p = drawPropsRef.current
        p.agents = s.agents
        p.toolCalls = s.toolCalls
        p.particles = s.particles
        p.edges = s.edges
        p.discoveries = s.discoveries
        p.simTime = s.currentTime
      }

      const {
        agents, toolCalls, particles, edges, discoveries,
        selectedAgentId, hoveredAgentId, showStats, showHexGrid,
        showCostOverlay, selectedToolCallId, selectedDiscoveryId,
        simTime, pauseAutoFit, dimensions, onAgentDrag,
        isDragging,
      } = drawPropsRef.current
      const transform = transformRef.current

      const deltaTime = lastFrameTimeRef.current ? (timestamp - lastFrameTimeRef.current) / 1000 : ANIM_SPEED.defaultDeltaTime
      lastFrameTimeRef.current = timestamp
      timeRef.current += deltaTime
      if (simTime != null) simTimeRef.current = simTime

      const dpr = dprRef.current
      const w = dimensions.width
      const h = dimensions.height

      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)
      }

      // Camera physics (inertia + auto-fit)
      updateCamera(isDragging, pauseAutoFit)

      // Floaty agent drag
      updateDragLerp(agents, onAgentDrag)

      // Detect state changes → visual effects
      detectStateChanges()

      // Update effects (mutate in place to avoid GC pressure)
      {
        const effects = effectsRef.current
        let writeIdx = 0
        for (let i = 0; i < effects.length; i++) {
          effects[i].age += deltaTime
          if (effects[i].age < effects[i].duration) {
            if (writeIdx !== i) effects[writeIdx] = effects[i]
            writeIdx++
          }
        }
        effects.length = writeIdx
      }

      ctx.clearRect(0, 0, w, h)
      updateDepthParticles(depthParticlesRef.current, deltaTime, w, h)

      let activeAgentPos: { x: number; y: number; color: string } | undefined
      for (const [, agent] of agents) {
        if (agent.state === 'thinking' || agent.state === 'tool_calling' || agent.state === 'waiting_permission') {
          activeAgentPos = { x: agent.x, y: agent.y, color: getStateColor(agent.state) }
          break
        }
      }

      drawBackground(ctx, w, h, depthParticlesRef.current, transform, showHexGrid, timeRef.current, activeAgentPos, dpr, hexGridCacheRef.current)

      ctx.save()
      ctx.translate(transform.x, transform.y)
      ctx.scale(transform.scale, transform.scale)

      // Pre-compute shared lookup structures — cached across frames when inputs are unchanged
      const elCache = edgeLookupCacheRef.current
      let activeEdgeIds: Set<string>
      let edgeMap: Map<string, Edge>
      if (elCache.particles === particles && elCache.edges === edges) {
        activeEdgeIds = elCache.activeEdgeIds
        edgeMap = elCache.edgeMap
      } else {
        activeEdgeIds = getActiveEdgeIds(particles)
        edgeMap = buildEdgeMap(edges)
        edgeLookupCacheRef.current = { particles, edges, activeEdgeIds, edgeMap }
      }

      // World-space viewport bounds — recomputed every frame; draw functions
      // skip entities whose bounding box doesn't overlap, which is a big win
      // when zoomed in or with many agents/edges off-screen.
      const viewBounds = computeViewBounds(w, h, transform)

      // Stress-test multiplier (debug-only, gated by `?stress=N`). Repeats
      // the world-render block N times against the SAME backing store so we
      // pay N× the scripting/render cost without changing the simulation
      // shape. At 1× this is a single-iteration loop with no overhead;
      // PERF_STRESS_MULTIPLIER is module-scope and clamped to [1, 64].
      for (let stressIter = 0; stressIter < PERF_STRESS_MULTIPLIER; stressIter++) {
        drawDiscoveryConnections(ctx, discoveries, agents, viewBounds)
        drawEdges(ctx, edges, agents, toolCalls, activeEdgeIds, timeRef.current, viewBounds)
        drawToolCalls(ctx, toolCalls, timeRef.current, selectedToolCallId, viewBounds)
        drawDiscoveries(ctx, discoveries, agents, selectedDiscoveryId, viewBounds)
        drawAgents(ctx, agents, selectedAgentId, hoveredAgentId, showStats, timeRef.current)
        drawMessageBubblesWorld(ctx, agents, simTimeRef.current)
        if (showCostOverlay) drawCostLabels(ctx, agents, toolCalls)
        drawParticles(ctx, particles, edgeMap, agents, toolCalls, timeRef.current, viewBounds)
        drawEffects(ctx, effectsRef.current)
      }

      if (selectedAgentId) {
        const agent = agents.get(selectedAgentId)
        if (agent) drawTetherLine(ctx, agent, transform, h)
      }

      ctx.restore()

      // Evict overlay cache entries for agents that completed / despawned.
      // Uses a Set view of the current agent ids — cheap compared to the draw pass.
      pruneOverlayCache(new Set(agents.keys()))

      // Bloom post-processing — throttled when bloomThrottle > 1.
      // On "render" frames we run the full blur+composite pipeline.
      // On "skip" frames we re-composite the last blur result via applyCache
      // (same additive blend, no blur work) so the glow doesn't flicker.
      if (bloomRef.current) {
        const throttle = bloomThrottleRef.current
        const frame = bloomFrameCounterRef.current
        bloomFrameCounterRef.current = frame + 1

        if (throttle <= 1 || frame % throttle === 0) {
          bloomRef.current.apply(canvas, ctx)
        } else {
          bloomRef.current.applyCache(canvas, ctx)
        }
      }

      // ─── Performance overlay (enabled via ?perf or ?stress) ──────────
      if (PERF_OVERLAY_ENABLED) {
        const perf = perfRef.current
        const frameEnd = performance.now()
        const frameMs = frameEnd - (timestamp || frameEnd)
        perf.frameTimes.push(frameMs)
        if (perf.frameTimes.length > PERF_OVERLAY.maxFrameSamples) perf.frameTimes.shift()
        perf.frames++
        perf.frameTimeMs = frameMs
        if (frameEnd - perf.lastFpsUpdate >= PERF_OVERLAY.updateIntervalMs) {
          perf.fps = perf.frames
          perf.frames = 0
          perf.lastFpsUpdate = frameEnd
          const sorted = [...perf.frameTimes].sort((a, b) => a - b)
          perf.p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
        }

        // Estimate the display's vsync interval as 1000 / observed FPS.
        // When work fits the budget, rAF callbacks arrive at the display
        // refresh rate, so observed FPS settles at the cap (60/120/144/etc).
        // The first second after mount has perf.fps == 0 — fall back to a
        // 60Hz default so we don't divide by zero or print Infinity.
        const vsyncMs = perf.fps > 0 ? 1000 / perf.fps : 16.67
        const headroomPct = Math.max(0, Math.min(100, ((vsyncMs - frameMs) / vsyncMs) * 100))

        const po = PERF_OVERLAY
        const textX = po.x + po.padding
        let textY = po.y + po.lineHeight + 2
        ctx.save()
        ctx.fillStyle = po.bgColor
        ctx.fillRect(po.x, po.y, po.width, po.height)
        ctx.font = po.font
        ctx.fillStyle = perf.fps < po.fpsWarning ? po.fpsWarningColor : perf.fps < po.fpsCaution ? po.fpsCautionColor : po.fpsGoodColor
        const stressTag = PERF_STRESS_MULTIPLIER > 1 ? `  ×${PERF_STRESS_MULTIPLIER}` : ''
        ctx.fillText(`FPS: ${perf.fps}${stressTag}`, textX, textY); textY += po.lineHeight
        ctx.fillStyle = po.textColor
        ctx.fillText(`Frame: ${frameMs.toFixed(1)}ms  P95: ${perf.p95.toFixed(1)}ms`, textX, textY); textY += po.lineHeight
        // Headroom: fraction of the vsync budget left after JS work. Useful
        // when FPS is pinned at the display cap and improvements are hidden.
        ctx.fillText(`Headroom: ${frameMs.toFixed(1)} / ${vsyncMs.toFixed(2)}ms (${headroomPct.toFixed(0)}% free)`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Agents: ${agents.size}`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Tool calls: ${toolCalls.size}`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Particles: ${particles.length}`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Edges: ${edges.length}`, textX, textY); textY += po.lineHeight
        ctx.fillText(`Discoveries: ${discoveries.length}`, textX, textY)
        ctx.restore()
      }

    } catch (err) {
      // Log at most once every 5s to avoid flooding the console
      const now = Date.now()
      if (now - lastDrawErrorRef.current > 5000) {
        lastDrawErrorRef.current = now
        console.warn('[AgentCanvas] draw error:', err)
      }
    }
  }, [detectStateChanges, updateCamera, updateDragLerp, transformRef])

  drawRef.current = draw

  // Register with the shared render loop instead of running our own rAF.
  useEffect(() => {
    const callback = (timestamp: number) => drawRef.current(timestamp)
    return manager.registerRender(callback)
  }, [manager])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" style={{ cursor: isDragging ? 'grabbing' : 'grab' }}>
      <canvas
        ref={mainCanvasRef}
        style={{ width: dimensions.width, height: dimensions.height }}
        {...handlers}
        className="w-full h-full"
      />
    </div>
  )
}
