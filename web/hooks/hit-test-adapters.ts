/**
 * Hit-test adapter factories for Canvas2D and Pixi renderers.
 *
 * Each factory returns an object satisfying the HitTestAdapter interface
 * expected by useCanvasInteraction. The hook delegates all hit-detection
 * calls through the adapter, keeping the interaction logic renderer-agnostic.
 */

import type { MutableRefObject } from 'react'
import type { Container, EventBoundary } from 'pixi.js'
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
 * Walk up the display-object tree from a hit target looking for a container
 * whose label matches a given prefix. Returns the suffix (entity ID) or null.
 * Caps the walk at 5 levels to avoid pathological loops.
 */
function findLabelWithPrefix(
  hit: Container | null,
  prefix: string,
): string | null {
  let current: Container | null = hit
  for (let i = 0; i < 5 && current; i++) {
    const label = current.label
    if (typeof label === 'string' && label.startsWith(prefix)) {
      return label.slice(prefix.length)
    }
    current = current.parent as Container | null
  }
  return null
}

/**
 * Build a Pixi-aware hit-test adapter using EventBoundary.hitTest() for
 * per-pixel accuracy against the viewport's world container. The boundary
 * ref is populated by pixi-canvas.tsx after registerViewport + world setup.
 *
 * When the boundaryRef is null (boundary not yet created), all methods
 * return null — the next frame's adapter call will succeed once boot
 * completes.
 */
export function createPixiHitTestAdapter(
  _drawPropsRef: MutableRefObject<{
    agents: Map<string, Agent>
    toolCalls: Map<string, ToolCallNode>
    discoveries: Discovery[]
  }>,
  _simTimeRef: MutableRefObject<number>,
  boundaryRef: MutableRefObject<EventBoundary | null>,
): HitTestAdapter {
  return {
    findAgentAt: (x, y) => {
      const hit = boundaryRef.current?.hitTest(x, y) as Container | null ?? null
      return findLabelWithPrefix(hit, 'agent-')
    },
    findToolCallAt: (x, y) => {
      const hit = boundaryRef.current?.hitTest(x, y) as Container | null ?? null
      return findLabelWithPrefix(hit, 'tool-')
    },
    findBubbleAgentAt: (x, y) => {
      const hit = boundaryRef.current?.hitTest(x, y) as Container | null ?? null
      return findLabelWithPrefix(hit, 'bubble-')
    },
    findDiscoveryAt: (x, y) => {
      const hit = boundaryRef.current?.hitTest(x, y) as Container | null ?? null
      return findLabelWithPrefix(hit, 'discovery-')
    },
  }
}
