import { Agent, Discovery } from '@/lib/agent-types'
import { COLORS, getDiscoveryTypeColor } from '@/lib/colors'
import { getDiscoveryCardDimensions } from '@/lib/canvas-constants'
import { truncateText } from './draw-misc'
import { getTextSprite, drawTextSprite } from './render-cache'
import { type ViewBounds, isPointVisible, isRectVisible } from './viewport'

// Reused dash array for discovery connection lines — setLineDash always
// copies the input, but reusing the source avoids one allocation per call.
const DISCOVERY_DASH: readonly number[] = [3, 5]

export function drawDiscoveryConnections(
  ctx: CanvasRenderingContext2D, discoveries: Discovery[], agents: Map<string, Agent>,
  bounds?: ViewBounds,
) {
  // Stroke style and dash are constant across the loop — set them once and
  // restore at the end so each iteration only modulates globalAlpha + stroke.
  let opened = false
  for (const disc of discoveries) {
    const agent = agents.get(disc.agentId)
    if (!agent || disc.opacity < 0.1) continue

    // Skip if both endpoints are outside the viewport — the connection line
    // is short and dashed, so we don't bother with a tighter check.
    if (bounds && !isPointVisible(agent.x, agent.y, bounds, 32) && !isPointVisible(disc.x, disc.y, bounds, 32)) continue

    if (!opened) {
      ctx.save()
      ctx.strokeStyle = COLORS.holoBase + '30'
      ctx.lineWidth = 0.5
      ctx.setLineDash(DISCOVERY_DASH as number[])
      opened = true
    }

    ctx.globalAlpha = disc.opacity * 0.3
    ctx.beginPath()
    ctx.moveTo(agent.x, agent.y)
    ctx.lineTo(disc.x, disc.y)
    ctx.stroke()
  }

  if (opened) ctx.restore()
}

export function drawDiscoveries(
  ctx: CanvasRenderingContext2D, discoveries: Discovery[], agents: Map<string, Agent>,
  selectedDiscoveryId?: string | null,
  bounds?: ViewBounds,
) {
  for (const disc of discoveries) {
    if (disc.opacity < 0.05) continue

    const lines = disc.content.split('\n')
    const { cardW, cardH } = getDiscoveryCardDimensions(disc.label, lines)
    const cardX = disc.x - cardW / 2
    const cardY = disc.y - cardH / 2

    // Skip cards entirely outside the viewport. Margin covers selection glow.
    if (bounds && !isRectVisible(cardX - 12, cardY - 12, cardW + 24, cardH + 24, bounds)) continue

    ctx.save()
    ctx.globalAlpha = disc.opacity

    const isSelected = disc.id === selectedDiscoveryId

    ctx.beginPath()
    ctx.roundRect(cardX, cardY, cardW, cardH, 3)
    ctx.fillStyle = isSelected ? COLORS.cardBgSelected : COLORS.cardBg
    ctx.fill()

    const typeColor = getDiscoveryTypeColor(disc.type)

    // Selection glow
    if (isSelected) {
      ctx.shadowColor = typeColor
      ctx.shadowBlur = 12
      ctx.strokeStyle = typeColor + '80'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    ctx.fillStyle = typeColor + '60'
    ctx.fillRect(cardX, cardY, 2, cardH)

    if (!isSelected) {
      ctx.strokeStyle = typeColor + '30'
      ctx.lineWidth = 0.5
      ctx.stroke()
    }

    ctx.font = 'bold 8px monospace'
    const discLabel = truncateText(ctx, disc.label, cardW - 10)
    const labelSp = getTextSprite(discLabel, 'bold 8px monospace', typeColor, 'left', 'top')
    drawTextSprite(ctx, labelSp, cardX + 6, cardY + 3, 'left', 'top')

    ctx.font = '7px monospace'
    for (let i = 0; i < lines.length; i++) {
      const lineText = truncateText(ctx, lines[i], cardW - 10)
      const lineSp = getTextSprite(lineText, '7px monospace', COLORS.textMuted, 'left', 'top')
      drawTextSprite(ctx, lineSp, cardX + 6, cardY + 14 + i * 11, 'left', 'top')
    }

    ctx.restore()
  }
}
