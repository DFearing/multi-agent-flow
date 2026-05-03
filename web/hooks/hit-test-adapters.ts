/**
 * Hit-test adapter factory for the Canvas2D renderer.
 *
 * Returns an object satisfying the HitTestAdapter interface expected by
 * useCanvasInteraction. The hook delegates all hit-detection calls through
 * the adapter, keeping the interaction logic renderer-agnostic.
 */

import type { MutableRefObject } from 'react'
import type { Agent, ToolCallNode, Discovery } from '@/lib/agent-types'
import {
  findAgentAt,
  findToolCallAt,
  findBubbleAgentAt,
  findDiscoveryAt,
} from '@/components/agent-visualizer/canvas/hit-detection'
import type { HitTestAdapter } from './use-canvas-interaction'

/**
 * Build a Canvas2D hit-test adapter that reads simulation data from a ref
 * and performs coordinate-math hit-detection against agent positions,
 * tool-call card bounds, bubble rects, and discovery card bounds.
 *
 * Uses world-space coords (camera transform already undone).
 */
export function createCanvas2DHitTestAdapter(
  drawPropsRef: MutableRefObject<{
    agents: Map<string, Agent>
    toolCalls: Map<string, ToolCallNode>
    discoveries: Discovery[]
  }>,
  simTimeRef: MutableRefObject<number>,
): HitTestAdapter {
  return {
    findAgentAt: (worldX, worldY) => findAgentAt(worldX, worldY, drawPropsRef.current.agents),
    findToolCallAt: (worldX, worldY) => findToolCallAt(worldX, worldY, drawPropsRef.current.toolCalls),
    findBubbleAgentAt: (worldX, worldY) => findBubbleAgentAt(worldX, worldY, drawPropsRef.current.agents, simTimeRef.current),
    findDiscoveryAt: (worldX, worldY) => findDiscoveryAt(worldX, worldY, drawPropsRef.current.discoveries),
  }
}

