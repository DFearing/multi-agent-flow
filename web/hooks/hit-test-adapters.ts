/**
 * Hit-test adapter factories for Canvas2D and Pixi renderers.
 *
 * Each factory returns an object satisfying the HitTestAdapter interface
 * expected by useCanvasInteraction. The hook delegates all hit-detection
 * calls through the adapter, keeping the interaction logic renderer-agnostic.
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
    findAgentAt: (x, y) => findAgentAt(x, y, drawPropsRef.current.agents),
    findToolCallAt: (x, y) => findToolCallAt(x, y, drawPropsRef.current.toolCalls),
    findBubbleAgentAt: (x, y) => findBubbleAgentAt(x, y, drawPropsRef.current.agents, simTimeRef.current),
    findDiscoveryAt: (x, y) => findDiscoveryAt(x, y, drawPropsRef.current.discoveries),
  }
}

/**
 * Build a Pixi-aware hit-test adapter. In v1 this re-uses the same
 * coordinate-math functions as Canvas2D, since both renderers share the
 * same world-space data model. The Pixi display objects have
 * `eventMode='static'` set but pointer events are handled at the hook
 * level, not at the Pixi event level, to maintain a single interaction
 * code path.
 *
 * In a future iteration this can be upgraded to use
 * `app.renderer.events.rootBoundary.hitTest(point)` for per-pixel
 * accuracy on irregular Pixi display objects.
 */
export function createPixiHitTestAdapter(
  drawPropsRef: MutableRefObject<{
    agents: Map<string, Agent>
    toolCalls: Map<string, ToolCallNode>
    discoveries: Discovery[]
  }>,
  simTimeRef: MutableRefObject<number>,
): HitTestAdapter {
  return {
    findAgentAt: (x, y) => findAgentAt(x, y, drawPropsRef.current.agents),
    findToolCallAt: (x, y) => findToolCallAt(x, y, drawPropsRef.current.toolCalls),
    findBubbleAgentAt: (x, y) => findBubbleAgentAt(x, y, drawPropsRef.current.agents, simTimeRef.current),
    findDiscoveryAt: (x, y) => findDiscoveryAt(x, y, drawPropsRef.current.discoveries),
  }
}
