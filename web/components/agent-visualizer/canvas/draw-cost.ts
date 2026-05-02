import { Agent, ToolCallNode, NODE } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { COST_RATE, COST_DRAW, COST_PANEL, MIN_VISIBLE_OPACITY } from '@/lib/canvas-constants'
import { formatTokens } from '@/lib/utils'
import { truncateText } from './draw-misc'
import { getTextSprite, drawTextSprite, measureTextCached, getOverlaySprite, drawOverlaySprite, overlayKey } from './render-cache'

export function agentCost(tokensUsed: number): number {
  return (tokensUsed / 1_000_000) * COST_RATE
}

/** Tool name -> color for mini cost bar */
export function toolTypeColor(toolName: string): string {
  const n = toolName.toLowerCase()
  if (n.includes('read') || n.includes('glob') || n.includes('grep')) return COLORS.contextUser
  if (n.includes('edit') || n.includes('write')) return COLORS.contextReasoning
  if (n.includes('bash')) return COLORS.tool
  return COLORS.contextSubagent
}

/** Pre-group tool calls by agentId to avoid O(agents * toolCalls) per frame */
function groupToolsByAgent(toolCalls: Map<string, ToolCallNode>): Map<string, ToolCallNode[]> {
  const grouped = new Map<string, ToolCallNode[]>()
  for (const tc of toolCalls.values()) {
    if (!tc.tokenCost) continue
    let list = grouped.get(tc.agentId)
    if (!list) { list = []; grouped.set(tc.agentId, list) }
    list.push(tc)
  }
  return grouped
}

export function drawCostLabels(
  ctx: CanvasRenderingContext2D,
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
) {
  const toolsByAgent = groupToolsByAgent(toolCalls)

  for (const [, agent] of agents) {
    if (agent.opacity < MIN_VISIBLE_OPACITY) continue
    const cost = agentCost(agent.tokensUsed)
    if (cost < COST_DRAW.minDisplayCost) continue

    const r = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const pillY = agent.y - r - COST_DRAW.pillYOffset

    // Floating cost pill
    const label = `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`
    ctx.font = 'bold 9px monospace'
    const labelW = measureTextCached(ctx, label)
    const pillW = labelW + COST_DRAW.pillPadding
    const pillH = COST_DRAW.pillHeight

    // Build a hash for the overlay cache: cost label + tool breakdown
    const agentTools = toolsByAgent.get(agent.id)
    let toolHash = ''
    if (agentTools && agentTools.length > 0) {
      const byType = new Map<string, number>()
      for (const tc of agentTools) {
        const tokens = tc.tokenCost || 0
        byType.set(tc.toolName, (byType.get(tc.toolName) || 0) + tokens)
      }
      // Quantize to nearest 100 tokens to reduce invalidation frequency
      toolHash = Array.from(byType.entries())
        .map(([n, t]) => `${n}:${Math.round(t / 100)}`)
        .join(',')
    }
    const dataHash = `cost|${label}|${toolHash}`

    // Total overlay height includes pill + optional mini bar
    const hasBar = agentTools && agentTools.length > 0
    const overlayH = pillH + (hasBar ? COST_DRAW.miniBarGap + COST_DRAW.miniBarHeight : 0)
    const barW = Math.min(pillW + COST_DRAW.miniBarMaxExtra, COST_DRAW.miniBarMax)
    const overlayW = Math.max(pillW, hasBar ? barW : 0) + 2 // 2px margin for stroke

    const sprite = getOverlaySprite(
      overlayKey('cost', agent.id), dataHash, overlayW, overlayH + 2, undefined,
      (offCtx) => {
        const oPillX = (overlayW - pillW) / 2

        // Pill background
        offCtx.fillStyle = COLORS.costPillBg
        offCtx.strokeStyle = COLORS.costPillStroke
        offCtx.lineWidth = 1
        offCtx.beginPath()
        offCtx.roundRect(oPillX, 1, pillW, pillH, COST_DRAW.pillRadius)
        offCtx.fill()
        offCtx.stroke()

        // Cost text
        offCtx.fillStyle = COLORS.costText
        offCtx.font = 'bold 9px monospace'
        offCtx.textAlign = 'center'
        offCtx.textBaseline = 'middle'
        offCtx.fillText(label, overlayW / 2, 1 + pillH / 2)

        // Mini tool-type cost bar
        if (agentTools && agentTools.length > 0) {
          const byType = new Map<string, number>()
          let totalToolTokens = 0
          for (const tc of agentTools) {
            const tokens = tc.tokenCost || 0
            byType.set(tc.toolName, (byType.get(tc.toolName) || 0) + tokens)
            totalToolTokens += tokens
          }
          if (totalToolTokens > 0) {
            const miniBarH = COST_DRAW.miniBarHeight
            const miniBarX = (overlayW - barW) / 2
            const miniBarY = pillH + COST_DRAW.miniBarGap + 1

            offCtx.fillStyle = COLORS.holoBorder06
            offCtx.beginPath()
            offCtx.roundRect(miniBarX, miniBarY, barW, miniBarH, COST_DRAW.miniBarRadius)
            offCtx.fill()

            let segX = miniBarX
            for (const [toolName, tokens] of byType) {
              const segW = (tokens / totalToolTokens) * barW
              if (segW < 1) continue
              offCtx.fillStyle = toolTypeColor(toolName)
              offCtx.globalAlpha = 0.7
              offCtx.beginPath()
              offCtx.roundRect(segX, miniBarY, segW, miniBarH, COST_DRAW.miniBarRadius)
              offCtx.fill()
              offCtx.globalAlpha = 1
              segX += segW
            }
          }
        }
      },
    )

    ctx.save()
    ctx.globalAlpha = agent.opacity * 0.9
    drawOverlaySprite(ctx, sprite, agent.x - overlayW / 2, pillY - 1)
    ctx.restore()
  }
}

export function drawCostSummaryPanel(
  ctx: CanvasRenderingContext2D,
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
) {
  const agentList = Array.from(agents.values()).filter(a => a.tokensUsed > 0)
  if (agentList.length === 0) return

  // Compute totals
  const totalTokens = agentList.reduce((s, a) => s + a.tokensUsed, 0)
  const totalCost = agentCost(totalTokens)

  // Per-agent breakdown sorted by cost desc
  const agentBreakdown = agentList
    .map(a => ({ name: a.name, tokens: a.tokensUsed, cost: agentCost(a.tokensUsed) }))
    .sort((a, b) => b.cost - a.cost)

  // Per-tool-type breakdown
  const toolBreakdown = new Map<string, number>()
  for (const [, tc] of toolCalls) {
    if (tc.tokenCost) {
      const key = tc.toolName
      toolBreakdown.set(key, (toolBreakdown.get(key) || 0) + tc.tokenCost)
    }
  }
  const toolList = Array.from(toolBreakdown.entries())
    .map(([name, tokens]) => ({ name, tokens, cost: agentCost(tokens) }))
    .sort((a, b) => b.cost - a.cost)

  // Panel dimensions — positioned top-right
  const dpr = ctx.canvas.width / ctx.canvas.offsetWidth
  const canvasW = ctx.canvas.width / dpr
  const panelW = COST_PANEL.width
  const panelX = canvasW - panelW - COST_PANEL.xMargin
  const panelY = COST_PANEL.yStart
  const lineH = COST_PANEL.lineHeight
  const headerH = COST_PANEL.headerHeight
  const sectionGap = COST_PANEL.sectionGap
  const agentRows = Math.min(agentBreakdown.length, COST_PANEL.maxRows)
  const toolRows = Math.min(toolList.length, COST_PANEL.maxRows)
  const panelH = headerH + (agentRows * lineH) + sectionGap + (toolRows > 0 ? 14 + toolRows * lineH : 0) + 12

  ctx.save()

  // Panel background
  ctx.fillStyle = COLORS.panelBg
  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(panelX, panelY, panelW, panelH, COST_PANEL.borderRadius)
  ctx.fill()
  ctx.stroke()

  let y = panelY + 8

  // Header: total cost — cached text sprites
  const costStr = `$${totalCost.toFixed(3)}`
  const costSp = getTextSprite(costStr, 'bold 11px monospace', COLORS.costText, 'left', 'top')
  drawTextSprite(ctx, costSp, panelX + COST_PANEL.contentPadding, y, 'left', 'top')

  ctx.font = 'bold 11px monospace'
  const costStrW = measureTextCached(ctx, costStr)
  const tokenStr = `${formatTokens(totalTokens)} tokens`
  const tokenSp = getTextSprite(tokenStr, '9px monospace', COLORS.textMuted, 'left', 'top')
  drawTextSprite(ctx, tokenSp, panelX + COST_PANEL.contentPadding + costStrW + 14, y + 2, 'left', 'top')

  y += headerH

  // Per-agent breakdown
  const barW = panelW - COST_PANEL.contentPadding * 2
  for (let i = 0; i < agentRows; i++) {
    const a = agentBreakdown[i]

    // Mini bar background
    const ratio = totalCost > 0 ? a.cost / totalCost : 0
    ctx.fillStyle = COLORS.holoBorder06
    ctx.beginPath()
    ctx.roundRect(panelX + COST_PANEL.contentPadding, y + 1, barW, lineH - 3, COST_PANEL.barRadius)
    ctx.fill()

    // Bar fill
    ctx.fillStyle = a.name.includes('main') || agentBreakdown.length === 1
      ? COLORS.barFillMain
      : COLORS.barFillSub
    ctx.beginPath()
    ctx.roundRect(panelX + COST_PANEL.contentPadding, y + 1, barW * ratio, lineH - 3, COST_PANEL.barRadius)
    ctx.fill()

    // Agent name — cached text sprite
    ctx.font = '8px monospace'
    const agentName = truncateText(ctx, a.name, barW - 50)
    const nameSp = getTextSprite(agentName, '8px monospace', COLORS.textPrimary, 'left', 'top')
    drawTextSprite(ctx, nameSp, panelX + COST_PANEL.contentPadding + COST_PANEL.barInset, y + 3, 'left', 'top')

    // Cost — cached text sprite
    const costLabel = `$${a.cost.toFixed(3)}`
    const costLabelSp = getTextSprite(costLabel, '8px monospace', COLORS.costText, 'right', 'top')
    drawTextSprite(ctx, costLabelSp, panelX + COST_PANEL.contentPadding + barW - COST_PANEL.barInset, y + 3, 'right', 'top')

    y += lineH
  }

  // Per-tool-type breakdown
  if (toolList.length > 0) {
    y += sectionGap

    const byToolSp = getTextSprite('BY TOOL', '8px monospace', COLORS.textMuted, 'left', 'top')
    drawTextSprite(ctx, byToolSp, panelX + COST_PANEL.contentPadding, y, 'left', 'top')
    y += 14

    for (let i = 0; i < toolRows; i++) {
      const t = toolList[i]
      const ratio = totalCost > 0 ? t.cost / totalCost : 0

      // Background
      ctx.fillStyle = COLORS.panelSeparator
      ctx.beginPath()
      ctx.roundRect(panelX + COST_PANEL.contentPadding, y + 1, barW, lineH - 3, COST_PANEL.barRadius)
      ctx.fill()

      // Fill
      ctx.fillStyle = toolTypeColor(t.name)
      ctx.globalAlpha = 0.2
      ctx.beginPath()
      ctx.roundRect(panelX + COST_PANEL.contentPadding, y + 1, barW * ratio, lineH - 3, COST_PANEL.barRadius)
      ctx.fill()
      ctx.globalAlpha = 1

      // Tool name — cached text sprite
      ctx.font = '8px monospace'
      const tName = truncateText(ctx, t.name, barW - 50)
      const tNameSp = getTextSprite(tName, '8px monospace', toolTypeColor(t.name), 'left', 'top')
      drawTextSprite(ctx, tNameSp, panelX + COST_PANEL.contentPadding + COST_PANEL.barInset, y + 3, 'left', 'top')

      // Cost — cached text sprite
      const tCostLabel = `$${t.cost.toFixed(3)}`
      const tCostSp = getTextSprite(tCostLabel, '8px monospace', COLORS.costTextDim, 'right', 'top')
      drawTextSprite(ctx, tCostSp, panelX + COST_PANEL.contentPadding + barW - COST_PANEL.barInset, y + 3, 'right', 'top')

      y += lineH
    }
  }

  ctx.restore()
}
