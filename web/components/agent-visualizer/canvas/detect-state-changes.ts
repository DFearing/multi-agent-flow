import type { Agent, ToolCallNode } from '@/lib/agent-types'
import { FX } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import type { VisualEffect } from './draw-effects'

/** A semantic state transition detected between frames. */
export type StateTransition =
  | { kind: 'agent_spawn' }
  | { kind: 'agent_complete' }
  | { kind: 'tool_start' }
  | { kind: 'tool_complete' }
  | { kind: 'tool_error' }

/**
 * Compare previous and current agent/tool states and return both visual effects
 * and semantic transitions.
 *
 * The caller owns two pairs of state Maps and ping-pongs them across frames:
 * `prev*` is the read-only snapshot from last frame and `out*` is cleared and
 * repopulated here as the new snapshot. This avoids allocating two fresh Maps
 * every frame in the per-canvas draw loop.
 *
 * Both the canvas (for visuals) and the audio system (for sounds) consume
 * these results, keeping detection logic in a single place.
 */
export function detectStateChanges(
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
  prevAgentStates: Map<string, string>,
  prevToolStates: Map<string, string>,
  outAgentStates: Map<string, string>,
  outToolStates: Map<string, string>,
): {
  effects: VisualEffect[]
  transitions: StateTransition[]
} {
  const effects: VisualEffect[] = []
  const transitions: StateTransition[] = []
  outAgentStates.clear()
  outToolStates.clear()

  for (const [id, agent] of agents) {
    outAgentStates.set(id, agent.state)
    const oldState = prevAgentStates.get(id)

    // Spawn: new agent (wasn't in prev)
    if (!oldState) {
      transitions.push({ kind: 'agent_spawn' })
      if (agent.opacity < 0.5) {
        effects.push({
          type: 'spawn', x: agent.x, y: agent.y,
          color: COLORS.holoBase, age: 0, duration: FX.spawnDuration,
        })
      }
    }

    // Complete: just became complete
    if (oldState && oldState !== 'complete' && agent.state === 'complete') {
      transitions.push({ kind: 'agent_complete' })
      effects.push({
        type: 'complete', x: agent.x, y: agent.y,
        color: COLORS.complete, age: 0, duration: FX.completeDuration,
      })
    }
  }

  for (const [id, tool] of toolCalls) {
    outToolStates.set(id, tool.state)
    const oldState = prevToolStates.get(id)

    // Tool just started running
    if (!oldState && tool.state === 'running') {
      transitions.push({ kind: 'tool_start' })
    }

    // Tool just completed
    if (oldState === 'running' && tool.state === 'complete') {
      transitions.push({ kind: 'tool_complete' })
      const particleData: VisualEffect['particles'] = []
      for (let i = 0; i < FX.shatterCount; i++) {
        particleData.push({
          angle: (i / FX.shatterCount) * Math.PI * 2 + Math.random() * 0.5,
          speed: FX.shatterSpeed.min + Math.random() * FX.shatterSpeed.range,
          size: FX.shatterSize.min + Math.random() * FX.shatterSize.range,
        })
      }
      effects.push({
        type: 'shatter', x: tool.x, y: tool.y,
        color: COLORS.return, age: 0, duration: FX.shatterDuration,
        particles: particleData,
      })
    }

    // Tool errored
    if (oldState === 'running' && tool.state === 'error') {
      transitions.push({ kind: 'tool_error' })
    }
  }

  return { effects, transitions }
}
