'use client'

import { memo } from 'react'
import { type AgentState } from '@/lib/agent-types'
import { COLORS, getStateColor } from '@/lib/colors'
import { formatTokens } from '@/lib/utils'
import { ProgressBar } from './shared-ui'
import { FloatingPanel } from './floating-panel'

interface AgentDetailCardProps {
  agent: {
    id: string
    name: string
    state: AgentState
    tokensUsed: number
    tokensMax: number
    toolCalls: number
    timeAlive: number
    currentTool?: string
  }
  onClose: () => void
}

function agentDetailCardEqual(
  prev: AgentDetailCardProps,
  next: AgentDetailCardProps,
): boolean {
  if (prev.onClose !== next.onClose) return false
  const a = prev.agent
  const b = next.agent
  return (
    a.name === b.name &&
    a.state === b.state &&
    a.tokensUsed === b.tokensUsed &&
    a.tokensMax === b.tokensMax &&
    a.toolCalls === b.toolCalls &&
    a.timeAlive === b.timeAlive &&
    a.currentTool === b.currentTool
  )
}

export const AgentDetailCard = memo(function AgentDetailCard({
  agent,
  onClose,
}: AgentDetailCardProps) {
  const contextPercent = Math.round((agent.tokensUsed / agent.tokensMax) * 100)
  const stateColor = getStateColor(agent.state)

  return (
    <FloatingPanel
      id="agent-detail"
      defaultRect={{ x: 12, y: 488, w: 240, h: 224 }}
      minW={200}
      minH={140}
      title={agent.name}
      onClose={onClose}
      showHandle={false}
    >
      <div className="p-3">
        {/* State indicator */}
        <div className="flex items-center gap-2 mb-3">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: stateColor, boxShadow: `0 0 8px ${stateColor}` }}
          />
          <span className="text-[10px] font-mono capitalize" style={{ color: stateColor }}>
            {agent.state}
          </span>
        </div>

        {/* Context bar */}
        <div className="mb-3">
          <div className="flex justify-between mb-1">
            <span className="text-[10px]" style={{ color: COLORS.textMuted }}>Context</span>
            <span className="text-[10px] font-mono" style={{ color: COLORS.textDim }}>
              {formatTokens(agent.tokensUsed)} / {formatTokens(agent.tokensMax)} ({contextPercent}%)
            </span>
          </div>
          <ProgressBar percent={contextPercent} color={stateColor} />
        </div>

        {/* Stats row */}
        <div className="flex gap-3 mb-3 text-[10px] font-mono" style={{ color: COLORS.textDim }}>
          <span>{agent.toolCalls} tools</span>
          <span>{agent.timeAlive.toFixed(1)}s alive</span>
        </div>

        {/* Current tool */}
        {agent.currentTool && (
          <div
            className="mb-3 px-2 py-1.5 rounded text-[10px] font-mono flex items-center gap-2"
            style={{
              background: COLORS.toolIndicatorBg,
              border: `1px solid ${COLORS.toolIndicatorBorder}`,
              color: COLORS.toolIndicatorText,
            }}
          >
            <span className="animate-spin inline-block">⚙</span>
            {agent.currentTool}
          </div>
        )}
      </div>
    </FloatingPanel>
  )
}, agentDetailCardEqual)
