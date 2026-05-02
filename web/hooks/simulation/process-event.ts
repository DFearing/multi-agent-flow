import {
  Agent,
  ToolCallNode,
  Edge,
  SimulationEvent,
  type TimelineEntry,
  type TimelineBlock,
} from '@/lib/agent-types'
import type { SimulationState, ConversationMessage } from './types'
import { handleAgentSpawn, handleAgentComplete, handleAgentIdle, handlePermissionRequested, handleModelDetected } from './handle-agent-events'
import { handleToolCallStart, handleToolCallEnd } from './handle-tool-events'
import { handleMessage, handleContextUpdate } from './handle-message-events'
import { handleSubagentDispatch, handleSubagentReturn } from './handle-subagent-events'

export interface ProcessEventContext {
  syncForceSimulation: (agents: Map<string, Agent>, edges: Edge[]) => void
  /** Coalesced replacement for setTimeout(syncForceSimulation, 0). Multiple
   *  calls within a single animation frame (e.g. burst replay of subagent
   *  spawns) collapse to one sync at end-of-frame. */
  markForceSyncDirty: () => void
  findToolSlot: (agent: Agent, agents: Map<string, Agent>, toolCalls: Map<string, ToolCallNode>, currentTime: number) => { x: number; y: number }
  getContextWindowSize: (modelId?: string) => number
  blockIdCounter: { current: number }
  skipForceSync: boolean
}

/** Mutable collections that handlers mutate in place during a single processEvent call. */
export interface MutableEventState {
  agents: Map<string, Agent>
  toolCalls: Map<string, ToolCallNode>
  particles: SimulationState['particles']
  edges: Edge[]
  discoveries: SimulationState['discoveries']
  fileAttention: SimulationState['fileAttention']
  timelineEntries: SimulationState['timelineEntries']
  conversations: Map<string, ConversationMessage[]>
}

/** Close the last open block on a timeline entry and push a new one. */
export function pushTimelineBlock(
  entry: TimelineEntry,
  currentTime: number,
  block: Pick<TimelineBlock, 'type' | 'label' | 'color'> & { endTime?: number },
  ctx: ProcessEventContext,
): void {
  const lastBlock = entry.blocks[entry.blocks.length - 1]
  if (lastBlock && !lastBlock.endTime) lastBlock.endTime = currentTime
  entry.blocks.push({
    id: `block-${ctx.blockIdCounter.current++}`,
    type: block.type,
    startTime: currentTime,
    endTime: block.endTime,
    label: block.label,
    color: block.color,
  })
}

/**
 * Per-event-type clone plan: only clone the collections that the handler actually mutates.
 * This eliminates unnecessary shallow copies + GC pressure for the majority of events.
 */
const CLONE_PLAN: Record<SimulationEvent['type'], readonly (keyof MutableEventState)[]> = {
  agent_spawn:          ['agents', 'edges', 'timelineEntries', 'conversations'],
  agent_complete:       ['agents', 'toolCalls', 'timelineEntries'],
  agent_idle:           ['agents'],
  model_detected:       ['agents'],
  tool_call_start:      ['agents', 'toolCalls', 'edges', 'particles', 'timelineEntries', 'fileAttention', 'conversations'],
  tool_call_end:        ['agents', 'toolCalls', 'particles', 'timelineEntries', 'fileAttention', 'conversations'],
  message:              ['agents', 'conversations'],
  context_update:       ['agents'],
  subagent_dispatch:    ['particles'],
  subagent_return:      ['particles'],
  permission_requested: ['agents', 'timelineEntries'],
}

export function processEvent(event: SimulationEvent, prev: SimulationState, ctx: ProcessEventContext): SimulationState {
      const plan = CLONE_PLAN[event.type]

      // Build state by cloning only the collections this event type touches.
      // Unmodified collections keep prev's reference identity.
      const state: MutableEventState = {
        agents: plan.includes('agents') ? new Map(prev.agents) : prev.agents,
        toolCalls: plan.includes('toolCalls') ? new Map(prev.toolCalls) : prev.toolCalls,
        particles: plan.includes('particles') ? [...prev.particles] : prev.particles,
        edges: plan.includes('edges') ? [...prev.edges] : prev.edges,
        discoveries: plan.includes('discoveries') ? [...prev.discoveries] : prev.discoveries,
        fileAttention: plan.includes('fileAttention') ? new Map(prev.fileAttention) : prev.fileAttention,
        timelineEntries: plan.includes('timelineEntries') ? new Map(prev.timelineEntries) : prev.timelineEntries,
        conversations: plan.includes('conversations') ? new Map(prev.conversations) : prev.conversations,
      }

      switch (event.type) {
        case 'agent_spawn':       handleAgentSpawn(event.payload, prev.currentTime, state, ctx); break
        case 'agent_complete':    handleAgentComplete(event.payload, prev.currentTime, state, ctx); break
        case 'agent_idle':        handleAgentIdle(event.payload, state); break
        case 'model_detected':    handleModelDetected(event.payload, state, ctx); break
        case 'tool_call_start':   handleToolCallStart(event.payload, prev.currentTime, state, ctx); break
        case 'tool_call_end':     handleToolCallEnd(event.payload, prev.currentTime, state, ctx); break
        case 'message':           handleMessage(event.payload, prev.currentTime, state); break
        case 'context_update':    handleContextUpdate(event.payload, state); break
        case 'subagent_dispatch': handleSubagentDispatch(event.payload, prev.currentTime, state); break
        case 'subagent_return':   handleSubagentReturn(event.payload, prev.currentTime, state); break
        case 'permission_requested': handlePermissionRequested(event.payload, prev.currentTime, state, ctx); break
      }

      // Return state collections directly. Collections in the clone plan are fresh
      // shallow copies (new reference) — handlers mutate entries in place, so we must
      // propagate the new container reference to trigger downstream re-renders.
      // Collections NOT in the clone plan already hold prev's reference (assigned above).
      return {
        ...prev,
        agents: state.agents,
        toolCalls: state.toolCalls,
        particles: state.particles,
        edges: state.edges,
        discoveries: state.discoveries,
        fileAttention: state.fileAttention,
        timelineEntries: state.timelineEntries,
        conversations: state.conversations,
      }
}
