'use client'

/**
 * PixiCanvas — WebGL-based sibling to AgentCanvas.
 *
 * Gated behind `?renderer=pixi`. Same prop contract as AgentCanvas so the
 * two are interchangeable in session-canvas-panel.tsx.
 *
 * This spike PR implements only the **particles** layer at visual parity.
 * All other layers (edges, agents, tool calls, discoveries, bubbles, bloom,
 * depth particles, hex grid) are stubbed as TODOs.
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import type { Application } from 'pixi.js'
import { Container } from 'pixi.js'
import type { SimulationState } from '@/hooks/simulation/types'
import { createPixiApp, disposeTextureCache } from './pixi-app'
import { ParticlesLayer } from './particles-layer'

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
}

export function PixiCanvas({
  simulationRef,
  // Props consumed by stubbed layers — destructured to satisfy the contract
  // but unused until those layers are implemented in follow-up PRs.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  selectedAgentId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  hoveredAgentId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showStats,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showHexGrid,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  zoomToFitTrigger,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pauseAutoFit,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onAgentClick,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onAgentHover,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onAgentDrag,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onContextMenu,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onToolCallClick,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  selectedToolCallId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onDiscoveryClick,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  selectedDiscoveryId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showCostOverlay,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  minZoomLevel,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const particlesLayerRef = useRef<ParticlesLayer | null>(null)
  const animRef = useRef<number>(0)
  const timeRef = useRef(0)
  const lastFrameRef = useRef(0)

  // ─── Scene graph layers (stubs marked with TODO) ────────────────────────
  // Each layer is a Container added to the stage in z-order.
  // Only the particles layer is functional in this spike.

  // TODO: background-layer (depth particles + hex grid)
  // TODO: edges-layer (MeshRope or batched line geometry)
  // TODO: agents-layer (sprite + text)
  // TODO: tool-calls-layer (sprite + text)
  // TODO: discoveries-layer (sprite + text)
  // TODO: bubbles-layer (message bubbles)
  // TODO: effects-layer (spawn/complete FX)
  // TODO: bloom pass (full-screen shader)

  // ─── Bootstrap ──────────────────────────────────────────────────────────

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
      // World container — camera transform applied here
      const world = new Container()
      world.label = 'world'
      app.stage.addChild(world)

      // Particles layer (functional)
      const particlesLayer = new ParticlesLayer()
      world.addChild(particlesLayer.container)
      particlesLayerRef.current = particlesLayer

      // ── Animation loop ─────────────────────────────────────────────
      // Uses its own rAF for now. Follow-up PR will consolidate to the
      // shared app.ticker once all layers are migrated.
      const draw = (timestamp: number) => {
        if (destroyed) return
        animRef.current = requestAnimationFrame(draw)

        const dt = lastFrameRef.current
          ? (timestamp - lastFrameRef.current) / 1000
          : 0.016
        lastFrameRef.current = timestamp
        timeRef.current += dt

        // Read simulation state from ref — no React re-render needed
        const sim = simulationRef.current

        // Update particles layer
        particlesLayer.update(
          sim.particles,
          sim.edges,
          sim.agents,
          sim.toolCalls,
          timeRef.current,
        )
      }

      animRef.current = requestAnimationFrame(draw)
    }

    boot()

    return () => {
      destroyed = true
      if (animRef.current) cancelAnimationFrame(animRef.current)
      if (particlesLayerRef.current) {
        particlesLayerRef.current.destroy()
        particlesLayerRef.current = null
      }
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
      style={{ cursor: 'grab' }}
    />
  )
}
