import { Agent, NODE, ANIM } from '@/lib/agent-types'
import { COLORS, getStateColor, contextSegments } from '@/lib/colors'
import {
  AGENT_DRAW, CONTEXT_BAR, CONTEXT_RING, STATS_OVERLAY,
} from '@/lib/canvas-constants'
import { alphaHex, formatTokens } from '@/lib/utils'
import { truncateText, drawHexagon, CLAUDE_SPARK_D, OPENAI_LOGO_D, OPENAI_LOGO_VIEWBOX } from './draw-misc'
import { getAgentGlowSprite, getScanlineSprite, getTextSprite, drawTextSprite, getOverlaySprite, drawOverlaySprite, overlayKey } from './render-cache'

let _claudeSparkPath: Path2D | null = null
export function getClaudeSparkPath() {
  if (!_claudeSparkPath) _claudeSparkPath = new Path2D(CLAUDE_SPARK_D)
  return _claudeSparkPath
}

let _openaiLogoPath: Path2D | null = null
function getOpenAILogoPath() {
  if (!_openaiLogoPath) _openaiLogoPath = new Path2D(OPENAI_LOGO_D)
  return _openaiLogoPath
}

// Pre-baked brand-spark sprite cache. shadowBlur on a per-frame fill is
// among the slowest Canvas2D paths (Chrome forces an off-screen render
// pass), so we render the spark + glow once into an off-screen canvas and
// blit it via drawImage on subsequent frames. Cache key includes radius
// (rounded to integer logical px) so the sprite stays crisp for the
// agent's actual size; breathe / scale variation reuses ~1 entry per agent.
const SPARK_BLUR_MARGIN = 12

interface BrandSparkSprite {
  canvas: HTMLCanvasElement
  /** Logical (CSS-px) edge length of the rendered sprite. */
  size: number
}

const brandSparkCache = new Map<string, BrandSparkSprite>()

function getBrandSparkSprite(
  brand: 'claude' | 'openai',
  color: string,
  r: number,
  dpr: number,
): BrandSparkSprite {
  const rQ = Math.max(1, Math.round(r))
  const key = `${brand}|${color}|${rQ}|${dpr}`
  const cached = brandSparkCache.get(key)
  if (cached) return cached

  // Sprite covers the spark (visual extent ~ rQ * sparkScale * 2) plus a
  // blur margin on every side so the glow doesn't clip at sprite edges.
  const size = Math.ceil(rQ * AGENT_DRAW.sparkScale * 2 + SPARK_BLUR_MARGIN * 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(size * dpr)
  canvas.height = Math.ceil(size * dpr)
  const sctx = canvas.getContext('2d')!
  sctx.scale(dpr, dpr)
  sctx.translate(size / 2, size / 2)

  if (brand === 'claude') {
    const scale = (rQ * AGENT_DRAW.sparkScale) / AGENT_DRAW.sparkViewBox
    sctx.scale(scale, scale)
    sctx.translate(-AGENT_DRAW.sparkViewBox, -AGENT_DRAW.sparkViewBox + 1)
    sctx.fillStyle = color
    sctx.shadowColor = color
    sctx.shadowBlur = 6 / scale
    sctx.fill(getClaudeSparkPath())
  } else {
    const scale = (rQ * AGENT_DRAW.sparkScale) / OPENAI_LOGO_VIEWBOX
    sctx.scale(scale, scale)
    sctx.translate(-OPENAI_LOGO_VIEWBOX / 2, -OPENAI_LOGO_VIEWBOX / 2)
    sctx.fillStyle = color
    sctx.shadowColor = color
    sctx.shadowBlur = 6 / scale
    sctx.fill(getOpenAILogoPath())
  }

  const sprite: BrandSparkSprite = { canvas, size }
  brandSparkCache.set(key, sprite)
  return sprite
}

function getSpriteDpr(): number {
  return typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
}

export function drawClaudeSpark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const sprite = getBrandSparkSprite('claude', color, r, getSpriteDpr())
  ctx.drawImage(sprite.canvas, cx - sprite.size / 2, cy - sprite.size / 2, sprite.size, sprite.size)
}

export function drawOpenAILogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const sprite = getBrandSparkSprite('openai', color, r, getSpriteDpr())
  ctx.drawImage(sprite.canvas, cx - sprite.size / 2, cy - sprite.size / 2, sprite.size, sprite.size)
}

/** Pick the brand logo for the agent's runtime. Defaults to Claude. */
export function drawAgentBrand(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, color: string,
  runtime: Agent['runtime'],
) {
  if (runtime === 'codex') drawOpenAILogo(ctx, cx, cy, r, color)
  else drawClaudeSpark(ctx, cx, cy, r, color)
}

export function drawContextComposition(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  radius: number,
) {
  const bd = agent.contextBreakdown
  const total = agent.tokensUsed
  if (total <= 0) return

  const barWidth = Math.max(CONTEXT_BAR.minWidth, radius * CONTEXT_BAR.widthMultiplier)
  const barHeight = CONTEXT_BAR.barHeight
  const barX = agent.x - barWidth / 2
  const barY = agent.y + radius + CONTEXT_BAR.yOffset

  // Background
  ctx.fillStyle = COLORS.cardBgDark
  ctx.beginPath()
  ctx.roundRect(barX - 2, barY - 2, barWidth + 4, barHeight + 14, CONTEXT_BAR.borderRadius)
  ctx.fill()

  // Label — cached text sprite to avoid per-frame fillText rasterization
  const barFont = `${CONTEXT_BAR.fontSize}px monospace`
  const pct = Math.round((total / agent.tokensMax) * 100)
  const barLabel = `${formatTokens(total)} / ${formatTokens(agent.tokensMax)} · ${pct}%`
  const barSprite = getTextSprite(barLabel, barFont, COLORS.textMuted, 'center', 'top')
  drawTextSprite(ctx, barSprite, agent.x, barY + barHeight + CONTEXT_BAR.labelPadding, 'center', 'top')

  // Segments
  const segments = contextSegments(bd)

  let x = barX
  const maxWidth = barWidth * (total / agent.tokensMax)

  for (const seg of segments) {
    if (seg.value <= 0) continue
    const segWidth = (seg.value / total) * maxWidth
    ctx.fillStyle = seg.color
    ctx.fillRect(x, barY, segWidth, barHeight)
    x += segWidth
  }

  // Remaining capacity
  if (x < barX + barWidth) {
    ctx.fillStyle = COLORS.holoBg05
    ctx.fillRect(x, barY, barX + barWidth - x, barHeight)
  }

  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 0.5
  ctx.strokeRect(barX, barY, barWidth, barHeight)
}

export function drawContextRing(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  radius: number,
  time: number,
) {
  const bd = agent.contextBreakdown
  const total = agent.tokensUsed
  if (total <= 0) return

  const usage = total / agent.tokensMax
  const ringR = radius + CONTEXT_RING.ringOffset
  const ringW = CONTEXT_RING.ringWidth
  const startAngle = -Math.PI / 2

  // Background ring (empty capacity)
  ctx.beginPath()
  ctx.arc(agent.x, agent.y, ringR, 0, Math.PI * 2)
  ctx.strokeStyle = COLORS.holoBorder06
  ctx.lineWidth = ringW
  ctx.stroke()

  // Filled segments
  const segments = contextSegments(bd)

  let currentAngle = startAngle
  for (const seg of segments) {
    if (seg.value <= 0) continue
    const sweep = (seg.value / agent.tokensMax) * Math.PI * 2
    ctx.beginPath()
    ctx.arc(agent.x, agent.y, ringR, currentAngle, currentAngle + sweep)
    ctx.strokeStyle = seg.color
    ctx.lineWidth = ringW
    ctx.stroke()
    currentAngle += sweep
  }

  // Warning glow at high usage
  if (usage > CONTEXT_RING.warningThreshold) {
    const warningColor = usage > CONTEXT_RING.criticalThreshold ? COLORS.error : COLORS.tool
    const intensity = usage > CONTEXT_RING.criticalThreshold
      ? 0.35 + Math.sin(time * 6) * 0.2
      : 0.15 + Math.sin(time * 3) * 0.1

    ctx.save()
    ctx.beginPath()
    ctx.arc(agent.x, agent.y, ringR + CONTEXT_RING.glowPadding, 0, Math.PI * 2)
    ctx.strokeStyle = warningColor
    ctx.lineWidth = CONTEXT_RING.glowLineWidth
    ctx.globalAlpha = intensity
    ctx.shadowColor = warningColor
    ctx.shadowBlur = CONTEXT_RING.glowBlur
    ctx.stroke()
    ctx.restore()
  }

  // Percentage label when usage is high — cached text sprite
  if (usage > CONTEXT_RING.percentLabelThreshold) {
    const pctFont = `${CONTEXT_BAR.fontSize}px monospace`
    const pctColor = usage > CONTEXT_RING.criticalThreshold ? COLORS.error : usage > CONTEXT_RING.warningThreshold ? COLORS.tool : COLORS.textDim
    const pctText = `${Math.floor(usage * 100)}%`
    const pctSprite = getTextSprite(pctText, pctFont, pctColor, 'center', 'top')
    drawTextSprite(ctx, pctSprite, agent.x, agent.y - radius - CONTEXT_RING.percentYOffset - pctSprite.height, 'center', 'top')
  }
}

function drawDepthShadow(ctx: CanvasRenderingContext2D, agent: Agent, r: number) {
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = AGENT_DRAW.shadowBlur
  ctx.shadowOffsetX = AGENT_DRAW.shadowOffsetX
  ctx.shadowOffsetY = AGENT_DRAW.shadowOffsetY
  drawHexagon(ctx, agent.x, agent.y, r * 0.9)
  ctx.fillStyle = COLORS.cardBgFaintOverlay
  ctx.fill()
  ctx.restore()
}

function drawAgentGlow(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, isHovered: boolean, isSelected: boolean, isWaiting: boolean) {
  const glowR = r + AGENT_DRAW.glowPadding
  const glowAlpha = isHovered || isSelected ? 0.35 : isWaiting ? 0.3 : agent.state === 'thinking' ? 0.2 : 0.1
  // Pre-rendered glow sprite instead of per-frame gradient creation
  const sprite = getAgentGlowSprite(color, Math.round(r * 0.5), Math.ceil(glowR), alphaHex(glowAlpha))
  ctx.drawImage(sprite, agent.x - Math.ceil(glowR), agent.y - Math.ceil(glowR))

  // Ambient outer hex ring
  drawHexagon(ctx, agent.x, agent.y, r + AGENT_DRAW.outerRingOffset)
  ctx.strokeStyle = color + '25'
  ctx.lineWidth = 1
  ctx.stroke()

  // Inner hex fill
  drawHexagon(ctx, agent.x, agent.y, r)
  ctx.fillStyle = COLORS.nodeInterior
  ctx.fill()
}

function drawScanline(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, isHovered: boolean, isWaiting: boolean, time: number) {
  const scanSpeed = agent.state === 'thinking' || isHovered || isWaiting ? ANIM.scanline.thinking : ANIM.scanline.normal
  const scanY = agent.y - r + ((time * scanSpeed) % (r * 2))
  ctx.save()
  drawHexagon(ctx, agent.x, agent.y, r)
  ctx.clip()
  const scanAlpha = isHovered ? '35' : '20'
  // Pre-rendered vertical fade strip — avoids a createLinearGradient + 3
  // addColorStop calls per agent per frame.
  const sprite = getScanlineSprite(color, scanAlpha, AGENT_DRAW.scanlineWidth)
  ctx.drawImage(sprite, agent.x - r, scanY - AGENT_DRAW.scanlineHalfH, r * 2, AGENT_DRAW.scanlineWidth)
  ctx.restore()
}

function drawStateRing(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, isHovered: boolean, isSelected: boolean, isWaiting: boolean, time: number) {
  drawHexagon(ctx, agent.x, agent.y, r)
  ctx.strokeStyle = color
  ctx.lineWidth = (isSelected || isHovered) ? 2.5 : 2
  if (agent.state === 'complete') {
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = color + '60'
  } else if (isWaiting) {
    ctx.setLineDash([6, 4])
    ctx.lineDashOffset = -time * AGENT_DRAW.waitingDashSpeed
    ctx.lineWidth = 2.5
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
}

function drawCenterIcon(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, isWaiting: boolean) {
  if (isWaiting) {
    // Geometric lock icon — fits the holographic style
    const s = r * 0.3
    ctx.save()
    ctx.strokeStyle = color + '90'
    ctx.fillStyle = color + '90'
    ctx.lineWidth = 1.5
    // Lock body (rounded rect)
    ctx.beginPath()
    ctx.roundRect(agent.x - s * 0.6, agent.y - s * 0.1, s * 1.2, s * 1.0, 2)
    ctx.fill()
    // Lock shackle (arc)
    ctx.beginPath()
    ctx.arc(agent.x, agent.y - s * 0.15, s * 0.4, Math.PI, 0)
    ctx.stroke()
    ctx.restore()
  } else if (agent.isMain) {
    drawAgentBrand(ctx, agent.x, agent.y, r, color + '90', agent.runtime)
  } else {
    ctx.fillStyle = color + '90'
    ctx.font = `${r * AGENT_DRAW.subIconScale}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(agent.state === 'tool_calling' ? '\u2699' : '\u25C7', agent.x, agent.y)
  }
}

function drawOrbitingParticles(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, time: number) {
  for (let i = 0; i < 4; i++) {
    const angle = time * ANIM.orbitSpeed + (i / 4) * Math.PI * 2
    ctx.beginPath()
    ctx.fillStyle = color + '80'
    ctx.arc(
      agent.x + Math.cos(angle) * (r + AGENT_DRAW.orbitParticleOffset),
      agent.y + Math.sin(angle) * (r + AGENT_DRAW.orbitParticleOffset),
      AGENT_DRAW.orbitParticleSize, 0, Math.PI * 2,
    )
    ctx.fill()
  }
}

function drawWaitingRipples(ctx: CanvasRenderingContext2D, agent: Agent, r: number, color: string, time: number) {
  // Radar ripples — 2 concentric rings expanding outward, staggered
  for (let i = 0; i < 2; i++) {
    const ripplePhase = ((time * 0.65 + i * 0.5) % 1.0)
    const rippleR = r + AGENT_DRAW.rippleInnerOffset + ripplePhase * AGENT_DRAW.rippleMaxExpand
    const rippleAlpha = (1 - ripplePhase) * AGENT_DRAW.rippleMaxAlpha
    ctx.beginPath()
    drawHexagon(ctx, agent.x, agent.y, rippleR)
    ctx.strokeStyle = color + alphaHex(rippleAlpha)
    ctx.lineWidth = 1.5 * (1 - ripplePhase)
    ctx.stroke()
  }

  // Slower orbiting particles in amber
  for (let i = 0; i < 3; i++) {
    const angle = time * AGENT_DRAW.waitingOrbitSpeed + (i / 3) * Math.PI * 2
    ctx.beginPath()
    ctx.fillStyle = color + '70'
    ctx.arc(
      agent.x + Math.cos(angle) * (r + AGENT_DRAW.waitingOrbitOffset),
      agent.y + Math.sin(angle) * (r + AGENT_DRAW.waitingOrbitOffset),
      AGENT_DRAW.waitingOrbitParticleSize, 0, Math.PI * 2,
    )
    ctx.fill()
  }
}

function drawAgentLabel(ctx: CanvasRenderingContext2D, agent: Agent, r: number, isHovered: boolean) {
  const labelFont = '10px monospace'
  const labelColor = isHovered ? COLORS.textPrimary : COLORS.textDim
  ctx.font = labelFont // needed for truncateText measurement
  const maxLabelW = r * AGENT_DRAW.labelWidthMultiplier
  const agentLabel = truncateText(ctx, agent.name, maxLabelW)
  const labelSprite = getTextSprite(agentLabel, labelFont, labelColor, 'center', 'top')
  drawTextSprite(ctx, labelSprite, agent.x, agent.y + r + AGENT_DRAW.labelYOffset, 'center', 'top')
}

function drawStatsOverlay(ctx: CanvasRenderingContext2D, agent: Agent, r: number) {
  const sy = agent.y - r - STATS_OVERLAY.yOffset
  const overlayW = STATS_OVERLAY.boxWidth
  const overlayH = STATS_OVERLAY.boxHeight

  // Cache key: quantize timeAlive to integer seconds so the cache only
  // invalidates ~once per second instead of every frame.  The displayed text
  // uses the same quantized value, keeping cache content pixel-faithful.
  const timeSec = Math.floor(agent.timeAlive)
  const statsText = `${agent.toolCalls} tools \u00B7 ${timeSec}s`
  const dataHash = `stats|${statsText}`

  const sprite = getOverlaySprite(
    overlayKey('stats', agent.id), dataHash, overlayW, overlayH, undefined,
    (offCtx) => {
      offCtx.fillStyle = COLORS.cardBgDark
      offCtx.beginPath()
      offCtx.roundRect(0, 0, overlayW, overlayH, STATS_OVERLAY.borderRadius)
      offCtx.fill()
      offCtx.strokeStyle = COLORS.glassBorder
      offCtx.lineWidth = 0.5
      offCtx.stroke()
      offCtx.fillStyle = COLORS.textMuted
      offCtx.font = `${STATS_OVERLAY.fontSize}px monospace`
      offCtx.textAlign = 'center'
      offCtx.textBaseline = 'top'
      offCtx.fillText(statsText, overlayW / 2, STATS_OVERLAY.textPaddingY)
    },
  )

  drawOverlaySprite(ctx, sprite, agent.x - overlayW / 2, sy)
}

export function drawAgents(
  ctx: CanvasRenderingContext2D,
  agents: Map<string, Agent>,
  selectedAgentId: string | null,
  hoveredAgentId: string | null,
  showStats: boolean,
  time: number,
) {
  for (const [id, agent] of agents) {
    const radius = agent.isMain ? NODE.radiusMain : NODE.radiusSub
    const color = getStateColor(agent.state)
    const isHovered = id === hoveredAgentId
    const isSelected = id === selectedAgentId

    const isWaiting = agent.state === 'waiting_permission'

    const breathe = isWaiting
      ? Math.sin(time * AGENT_DRAW.waitingBreatheSpeed) * AGENT_DRAW.waitingBreatheAmp + 1
      : agent.state === 'thinking'
      ? Math.sin(time * ANIM.breathe.thinkingSpeed) * ANIM.breathe.thinkingAmp + 1
      : agent.state === 'idle' ? Math.sin(time * ANIM.breathe.idleSpeed) * ANIM.breathe.idleAmp + 1 : 1

    const r = radius * breathe * agent.scale

    ctx.save()
    ctx.globalAlpha = agent.opacity

    drawDepthShadow(ctx, agent, r)
    drawAgentGlow(ctx, agent, r, color, isHovered, isSelected, isWaiting)
    drawScanline(ctx, agent, r, color, isHovered, isWaiting, time)
    drawStateRing(ctx, agent, r, color, isHovered, isSelected, isWaiting, time)
    drawCenterIcon(ctx, agent, r, color, isWaiting)

    if (agent.state === 'thinking') {
      drawOrbitingParticles(ctx, agent, r, color, time)
    }

    if (isWaiting) {
      drawWaitingRipples(ctx, agent, r, color, time)
    }

    drawAgentLabel(ctx, agent, r, isHovered)

    // Context composition — ring for main agent, bar for sub-agents
    if (agent.state !== 'complete' || agent.opacity > 0.5) {
      if (agent.isMain) {
        drawContextRing(ctx, agent, r, time)
      }
      drawContextComposition(ctx, agent, r)
    }

    if (showStats && agent.state !== 'complete') {
      drawStatsOverlay(ctx, agent, r)
    }

    ctx.restore()
  }
}
