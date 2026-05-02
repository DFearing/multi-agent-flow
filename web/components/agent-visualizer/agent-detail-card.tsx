'use client'

import { useState } from 'react'
import { type AgentState } from '@/lib/agent-types'
import { COLORS, getStateColor } from '@/lib/colors'
import { formatTokens } from '@/lib/utils'
import { ProgressBar } from './shared-ui'
import { FloatingPanel } from './floating-panel'
import { useAgentNames } from '@/hooks/use-agent-names'

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
  /** Session id the agent belongs to — name overrides are scoped per session. */
  sessionId: string
  onClose: () => void
}

export function AgentDetailCard({
  agent,
  sessionId,
  onClose,
}: AgentDetailCardProps) {
  const contextPercent = Math.round((agent.tokensUsed / agent.tokensMax) * 100)
  const stateColor = getStateColor(agent.state)
  const { getName, setName } = useAgentNames()
  const effectiveName = getName(sessionId, agent.id) ?? agent.name
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(effectiveName)

  const startEdit = () => { setDraft(effectiveName); setEditing(true) }
  const commit = () => { setName(sessionId, agent.id, draft); setEditing(false) }
  const cancel = () => setEditing(false)

  return (
    <FloatingPanel
      id="agent-detail"
      defaultRect={{ x: 12, y: 488, w: 240, h: 224 }}
      minW={200}
      minH={140}
      title={effectiveName}
      onClose={onClose}
      showHandle={false}
    >
      <div className="p-3">
        {/* Rename row */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] shrink-0" style={{ color: COLORS.textMuted }}>Name</span>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') cancel()
              }}
              onBlur={commit}
              className="flex-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
              style={{
                background: COLORS.holoBg05,
                border: `1px solid ${COLORS.holoBorder12}`,
                color: COLORS.textPrimary,
                outline: 'none',
              }}
            />
          ) : (
            <button
              onClick={startEdit}
              title="Click to rename"
              className="flex-1 text-left px-1.5 py-0.5 rounded text-[10px] font-mono truncate"
              style={{
                background: 'transparent',
                border: `1px dashed ${COLORS.holoBorder06}`,
                color: COLORS.textPrimary,
                cursor: 'text',
              }}
            >
              {effectiveName}
            </button>
          )}
        </div>

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
}
