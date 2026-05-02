'use client'

import { useMemo, useState } from 'react'
import { COLORS } from '@/lib/colors'
import { formatTokens } from '@/lib/utils'
import { agentCost } from './canvas/draw-cost'
import { FloatingPanel } from './floating-panel'
import { useSessionStats } from './session-stats-provider'

interface CostSummaryPanelProps {
  visible: boolean
  onClose: () => void
}

export function CostSummaryPanel({ visible, onClose }: CostSummaryPanelProps) {
  const { perSession } = useSessionStats()

  const summary = useMemo(() => {
    let totalTokens = 0
    const agents: { name: string; tokens: number; cost: number }[] = []
    const toolBreakdown = new Map<string, number>()
    for (const [, stats] of perSession) {
      for (const [, agent] of stats.agents) {
        if (agent.tokensUsed > 0) {
          totalTokens += agent.tokensUsed
          agents.push({ name: agent.name, tokens: agent.tokensUsed, cost: agentCost(agent.tokensUsed) })
        }
      }
      for (const [, tc] of stats.toolCalls) {
        if (tc.tokenCost) {
          toolBreakdown.set(tc.toolName, (toolBreakdown.get(tc.toolName) || 0) + tc.tokenCost)
        }
      }
    }
    agents.sort((a, b) => b.cost - a.cost)
    const tools = Array.from(toolBreakdown.entries())
      .map(([name, tokens]) => ({ name, tokens, cost: agentCost(tokens) }))
      .sort((a, b) => b.cost - a.cost)
    return { totalTokens, totalCost: agentCost(totalTokens), agents, tools }
  }, [perSession])

  const [defaultRect] = useState(() => {
    if (typeof window === 'undefined') return { x: 800, y: 80, w: 280, h: 360 }
    return { x: window.innerWidth - 280 - 12, y: 80, w: 280, h: 360 }
  })

  if (!visible) return null

  return (
    <FloatingPanel
      id="cost-summary"
      defaultRect={defaultRect}
      minW={220}
      minH={180}
      visible={visible}
      title="$ COST SUMMARY"
      onClose={onClose}
    >
      <div className="flex flex-col h-full p-3 font-mono text-[10px] overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: `${COLORS.scrollbarThumb} transparent` }}>
        {/* Total */}
        <div className="flex items-center justify-between mb-2 pb-2" style={{ borderBottom: `1px solid ${COLORS.holoBorder06}` }}>
          <span style={{ color: COLORS.textMuted }}>Total</span>
          <span>
            <span style={{ color: COLORS.textPrimary }}>{formatTokens(summary.totalTokens)} tok</span>
            <span style={{ color: COLORS.complete, marginLeft: 6 }}>~${summary.totalCost.toFixed(2)}</span>
          </span>
        </div>

        {/* Per-agent */}
        {summary.agents.length > 0 && (
          <div className="mb-3">
            <div className="mb-1" style={{ color: COLORS.textMuted, letterSpacing: '0.06em' }}>BY AGENT</div>
            {summary.agents.map((a, i) => (
              <div key={`${a.name}-${i}`} className="flex items-center justify-between py-0.5">
                <span className="truncate pr-2" style={{ color: COLORS.textPrimary }}>{a.name}</span>
                <span style={{ color: COLORS.textDim }}>
                  {formatTokens(a.tokens)}
                  <span style={{ color: COLORS.complete + 'b0', marginLeft: 6 }}>~${a.cost.toFixed(2)}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Per-tool */}
        {summary.tools.length > 0 && (
          <div>
            <div className="mb-1" style={{ color: COLORS.textMuted, letterSpacing: '0.06em' }}>BY TOOL</div>
            {summary.tools.map(t => (
              <div key={t.name} className="flex items-center justify-between py-0.5">
                <span className="truncate pr-2" style={{ color: COLORS.textPrimary }}>{t.name}</span>
                <span style={{ color: COLORS.textDim }}>
                  {formatTokens(t.tokens)}
                  <span style={{ color: COLORS.complete + 'b0', marginLeft: 6 }}>~${t.cost.toFixed(2)}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {summary.agents.length === 0 && (
          <div className="flex items-center justify-center flex-1" style={{ color: COLORS.textMuted }}>
            No token usage yet.
          </div>
        )}
      </div>
    </FloatingPanel>
  )
}
