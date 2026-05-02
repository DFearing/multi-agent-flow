'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Agent, type AgentState } from '@/lib/agent-types'
import { COLORS, ROLE_COLORS, colorForSession, getStateColor } from '@/lib/colors'
import type { ConversationMessage } from '@/hooks/simulation/types'
import { useClickOutside } from '@/hooks/use-click-outside'
import { useVirtualList } from '@/hooks/use-virtual-list'
import { mergeByTimestamp } from '@/lib/sort-utils'
import { FloatingPanel } from './floating-panel'

interface MessageFeedPanelProps {
  conversations: Map<string, ConversationMessage[]>
  agents: Map<string, Agent>
  /** agentId → sessionId, so each row can render a colored dot identifying
   *  which session it came from. Only matters when conversations span more
   *  than one session; falls back to no dot when missing. */
  agentToSession?: Map<string, string>
  onAgentClick: (agentId: string | null) => void
  selectedAgentId: string | null
  visible?: boolean
  onClose?: () => void
}

// Only show text messages (assistant, user, thinking) — tool calls visible via agent selection
const TEXT_TYPES = new Set(['assistant', 'user', 'thinking'])

// Truncation limits for compact display
const COLLAPSED_AGENT_NAME_MAX = 12
const TAB_AGENT_NAME_MAX = 14
const PREVIEW_MAX = 50
const MESSAGE_TRUNCATE_MAX = 120

const MESSAGE_GAP = 4

/** Conversation message decorated with a duplicate-collapse count. The
 *  feed renders one row per consecutive run of identical messages and
 *  shows ×N when count > 1. */
interface DedupedMessage extends ConversationMessage {
  agentId: string
  count: number
  lastTimestamp: number
}

// mergeByTimestamp imported from @/lib/sort-utils

// ─── Main component ─────────────────────────────────────────────────────────

export function MessageFeedPanel({
  conversations,
  agents,
  agentToSession,
  onAgentClick,
  selectedAgentId,
  visible = true,
  onClose,
}: MessageFeedPanelProps) {
  const expanded = true
  const setExpanded = (_: boolean) => {}
  const [activeTab, setActiveTab] = useState<string>('all')
  const [unread, setUnread] = useState<Set<string>>(new Set())
  const logRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const agentsRef = useRef(agents)
  agentsRef.current = agents

  // Stable key that only changes when agent set membership or names change
  const agentKey = useMemo(() => {
    const parts: string[] = []
    for (const [id, a] of agents) parts.push(`${id}:${a.name}:${a.isMain}`)
    return parts.sort().join('|')
  }, [agents])

  // ── Latest message (cheap — used by collapsed view) ──
  const latestMessage = useMemo(() => {
    const currentAgents = agentsRef.current
    let latest: (ConversationMessage & { agentId: string }) | null = null
    for (const [agentId, msgs] of conversations) {
      if (!currentAgents.has(agentId)) continue
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (!TEXT_TYPES.has(msgs[i].type)) continue
        if (!latest || msgs[i].timestamp > latest.timestamp) {
          latest = { ...msgs[i], agentId }
        }
        break
      }
    }
    return latest
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, agentKey])

  // ── Expensive memos — only compute when expanded ──

  const agentsWithMessages = useMemo(() => {
    if (!expanded) return []
    const currentAgents = agentsRef.current
    const ids: string[] = []
    for (const [agentId, msgs] of conversations) {
      if (!currentAgents.has(agentId)) continue
      if (msgs.some(m => TEXT_TYPES.has(m.type))) ids.push(agentId)
    }
    return ids.sort((a, b) => {
      const agA = currentAgents.get(a)
      const agB = currentAgents.get(b)
      if (agA?.isMain) return -1
      if (agB?.isMain) return 1
      return (agA?.name ?? a).localeCompare(agB?.name ?? b)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded ? conversations : null, expanded, agentKey])

  // Incremental message cache
  const messagesCacheRef = useRef<{
    key: string
    counts: Map<string, number>
    result: (ConversationMessage & { agentId: string })[]
  }>({ key: '', counts: new Map(), result: [] })

  const messages = useMemo(() => {
    if (!expanded) return []
    const currentAgents = agentsRef.current
    const cache = messagesCacheRef.current
    const cacheKey = `${activeTab}:${agentKey}`

    if (cache.key !== cacheKey) {
      cache.key = cacheKey
      cache.counts = new Map()
      cache.result = []
    }

    if (activeTab === 'all') {
      // Collect new messages from each agent into a batch (each agent's
      // conversation is itself already sorted by timestamp), sort the batch,
      // then merge it with the existing sorted cache. O(M log M + N + M)
      // instead of O((N+M) log (N+M)) — meaningful as N grows past a few
      // hundred messages in long-running sessions.
      const newItems: (ConversationMessage & { agentId: string })[] = []
      for (const [agentId, msgs] of conversations) {
        if (!currentAgents.has(agentId)) continue
        const prevLen = cache.counts.get(agentId) ?? 0
        if (msgs.length > prevLen) {
          for (let i = prevLen; i < msgs.length; i++) {
            if (TEXT_TYPES.has(msgs[i].type)) newItems.push({ ...msgs[i], agentId })
          }
          cache.counts.set(agentId, msgs.length)
        }
      }
      if (newItems.length > 0) {
        newItems.sort((a, b) => a.timestamp - b.timestamp)
        cache.result = mergeByTimestamp(cache.result, newItems)
      }
      return cache.result
    }

    const msgs = conversations.get(activeTab) ?? []
    const prevLen = cache.counts.get(activeTab) ?? 0
    if (msgs.length > prevLen) {
      for (let i = prevLen; i < msgs.length; i++) {
        if (TEXT_TYPES.has(msgs[i].type)) cache.result.push({ ...msgs[i], agentId: activeTab })
      }
      cache.counts.set(activeTab, msgs.length)
    }
    return cache.result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded ? conversations : null, expanded, activeTab, agentKey])

  // Collapse runs of consecutive identical messages — same agent, same role,
  // same content text — into a single row with a count badge. Tools and
  // workers often spam the same line repeatedly; the deduped view keeps the
  // feed scannable. Cheap to recompute since it's a single linear pass over
  // an already-cached array.
  const dedupedMessages = useMemo<readonly DedupedMessage[]>(() => {
    if (messages.length === 0) return []
    const out: DedupedMessage[] = []
    for (const msg of messages) {
      const last = out[out.length - 1]
      if (
        last
        && last.agentId === msg.agentId
        && last.type === msg.type
        && last.content === msg.content
      ) {
        // Merge this duplicate into the previous entry. We track lastTimestamp
        // separately so the count badge stays close to the latest occurrence
        // visually but the row's primary timestamp (sort key) doesn't shift.
        last.count++
        last.lastTimestamp = msg.timestamp
      } else {
        out.push({ ...msg, count: 1, lastTimestamp: msg.timestamp })
      }
    }
    return out
  }, [messages])

  // Virtual list with auto-scroll — operate on the deduped feed so collapsed
  // runs don't blow up the height/measure cache.
  const {
    visibleItems, totalHeight, offsetTop,
    handleScroll, measureRef,
  } = useVirtualList(dedupedMessages, logRef, { gap: MESSAGE_GAP, autoScroll: true })

  // Track unread messages per agent tab
  useEffect(() => {
    const totalCount = Array.from(conversations.values()).reduce((n, msgs) => n + msgs.length, 0)
    if (totalCount > prevCountRef.current && expanded) {
      for (const [agentId, msgs] of conversations) {
        if (agentId !== activeTab && activeTab !== 'all' && msgs.length > 0) {
          setUnread(prev => new Set(prev).add(agentId))
        }
      }
    }
    prevCountRef.current = totalCount
  }, [conversations, expanded, activeTab])

  useEffect(() => {
    if (activeTab !== 'all') {
      setUnread(prev => { const next = new Set(prev); next.delete(activeTab); return next })
    } else {
      setUnread(new Set())
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'all' && !conversations.has(activeTab)) setActiveTab('all')
  }, [conversations, activeTab])

  useEffect(() => {
    if (selectedAgentId) {
      const selected = agentsRef.current.get(selectedAgentId)
      if (selected && !selected.isMain) setActiveTab(selectedAgentId)
      else setActiveTab('all')
    } else {
      setActiveTab('all')
    }
  }, [selectedAgentId])

  const panelRef = useRef<HTMLDivElement>(null)
  const collapsePanel = useCallback(() => setExpanded(false), [])
  useClickOutside(panelRef, collapsePanel)

  if (!visible) return null
  if (!latestMessage && agentsWithMessages.length === 0) return null

  // ── Collapsed ──
  if (!expanded) {
    if (!latestMessage) return null
    const agent = agents.get(latestMessage.agentId)
    const agentName = agent?.name ?? latestMessage.agentId
    const role = ROLE_COLORS[latestMessage.type] ?? ROLE_COLORS.assistant
    const preview = latestMessage.content.replace(/\n/g, ' ').slice(0, PREVIEW_MAX)

    return (
      <FloatingPanel
        id="message-feed"
        defaultRect={{ x: 12, y: 72, w: 320, h: 444 }}
        minW={200}
        minH={40}
        onClose={onClose}
      >
        <div
          className="cursor-pointer transition-all hover:scale-[1.02] px-3 py-2 flex items-center gap-2"
          onClick={() => setExpanded(true)}
        >
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: role.text }} />
          <span className="text-[9px] font-mono font-semibold shrink-0" style={{ color: COLORS.textPrimary }}>
            {agentName.length > COLLAPSED_AGENT_NAME_MAX ? agentName.slice(0, COLLAPSED_AGENT_NAME_MAX) + '..' : agentName}
          </span>
          <span className="text-[9px] font-mono truncate" style={{ color: role.text + 'cc' }}>
            {preview}{latestMessage.content.length > PREVIEW_MAX ? '...' : ''}
          </span>
          <span className="text-[9px] shrink-0" style={{ color: COLORS.textMuted }}>▾</span>
        </div>
      </FloatingPanel>
    )
  }

  // ── Expanded (virtualized) ──
  return (
    <FloatingPanel
      id="message-feed"
      defaultRect={{ x: 12, y: 72, w: 320, h: 444 }}
      minW={240}
      minH={120}
      title="MESSAGES"
      onClose={onClose}
    >
      <div
        ref={panelRef}
        className="flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Collapse button */}
        <div className="flex items-center justify-end px-3 pt-1">
          <button
            onClick={() => setExpanded(false)}
            className="text-[9px] transition-colors"
            style={{ color: COLORS.textMuted }}
          >
            ▴
          </button>
        </div>

        {/* Agent Tabs (hidden when only 1 agent) */}
        {agentsWithMessages.length > 1 && (
        <div className="flex gap-0.5 px-2 pb-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <TabButton
            label="All"
            active={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
            color={COLORS.holoBase}
          />
          {agentsWithMessages.map(agentId => {
            const agent = agents.get(agentId)
            const name = agent?.name ?? agentId
            const color = agent ? getStateColor(agent.state) : COLORS.idle
            return (
              <TabButton
                key={agentId}
                label={name.length > TAB_AGENT_NAME_MAX ? name.slice(0, TAB_AGENT_NAME_MAX) + '..' : name}
                active={activeTab === agentId}
                onClick={() => setActiveTab(agentId)}
                color={color}
                hasUnread={unread.has(agentId)}
              />
            )
          })}
        </div>
        )}

        {/* Message List (virtualized) */}
        <div
          ref={logRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-2 pb-2"
          style={{ scrollbarWidth: 'thin', scrollbarColor: `${COLORS.scrollbarThumb} transparent` }}
        >
          {messages.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <span className="text-[9px] font-mono" style={{ color: COLORS.textMuted }}>
                No messages yet
              </span>
            </div>
          ) : (
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
                {visibleItems.map((msg) => {
                  const sid = agentToSession?.get(msg.agentId)
                  const sessionDot = sid ? colorForSession(sid).accent : null
                  return (
                    <div
                      key={msg.id}
                      ref={(el) => measureRef(msg.id, el)}
                      style={{ marginBottom: MESSAGE_GAP }}
                    >
                      <MessageRow
                        message={msg}
                        agentId={msg.agentId}
                        agentName={agents.get(msg.agentId)?.name ?? msg.agentId}
                        showAgent={activeTab === 'all'}
                        isSelected={selectedAgentId === msg.agentId}
                        sessionDot={sessionDot}
                        repeatCount={msg.count}
                        onClick={() => { onAgentClick(msg.agentId); setExpanded(false) }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </FloatingPanel>
  )
}

// ── Tab Button ──

function TabButton({ label, active, onClick, color, hasUnread }: {
  label: string
  active: boolean
  onClick: () => void
  color: string
  hasUnread?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-0.5 rounded text-[9px] font-mono transition-all shrink-0 relative"
      style={{
        background: active ? color + '20' : 'transparent',
        color: active ? color : COLORS.textMuted,
        border: active ? `1px solid ${color}30` : '1px solid transparent',
      }}
    >
      {label}
      {hasUnread && (
        <span
          className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
          style={{ background: COLORS.unreadDot }}
        />
      )}
    </button>
  )
}

// ── Message Row ──

const MESSAGE_LINE_CLAMP = 3

// Approximate visible characters per line for the 9px monospace text used
// in the feed at typical panel widths (320–720px). Used by the overflow
// heuristic below; conservative on the low side so we lean towards showing
// the "more" toggle on borderline messages.
const APPROX_CHARS_PER_LINE = 50

function MessageRow({ message, agentId, agentName, showAgent, isSelected, sessionDot, repeatCount, onClick }: {
  message: ConversationMessage
  agentId: string
  agentName: string
  showAgent: boolean
  isSelected: boolean
  /** Per-session accent color, rendered as a small dot in the header. Null
   *  when there's only one session (or the parent didn't pass agentToSession). */
  sessionDot: string | null
  /** Number of consecutive identical messages collapsed into this row. >1
   *  renders a "×N" badge so the user can see something repeated rather
   *  than guess from a sparser feed. */
  repeatCount?: number
  onClick: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const role = ROLE_COLORS[message.type] ?? ROLE_COLORS.assistant

  // Content-based overflow heuristic — replaces a per-row ResizeObserver +
  // scrollHeight measurement that was running for every visible message
  // (and re-running on every width change, message change, or expand). The
  // heuristic loses a little precision on borderline single-line messages
  // when the panel is resized wider than expected, but eliminates the
  // observer churn that compounds as the message list grows.
  const overflowsContent = useMemo(() => {
    const c = message.content
    const newlineCount = (c.match(/\n/g) || []).length
    if (newlineCount + 1 > MESSAGE_LINE_CLAMP) return true
    return c.length > MESSAGE_LINE_CLAMP * APPROX_CHARS_PER_LINE
  }, [message.content])
  const isOverflowing = expanded ? false : overflowsContent

  return (
    <div
      className="rounded px-2 py-1.5 cursor-pointer transition-all"
      style={{
        background: isSelected ? role.bgSelected : role.bg,
        borderLeft: isSelected ? `2px solid ${role.text}` : '2px solid transparent',
      }}
      onClick={onClick}
    >
      {/* Header row */}
      <div className="flex items-center gap-1.5 mb-0.5">
        {sessionDot && (
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 6, height: 6,
              borderRadius: '50%',
              background: sessionDot,
              flexShrink: 0,
              boxShadow: `0 0 4px ${sessionDot}`,
            }}
          />
        )}
        <span className="text-[9px] font-mono font-semibold" style={{ color: role.text + '90' }}>
          {role.label}
        </span>
        {showAgent && (
          <span className="text-[9px] font-mono" style={{ color: COLORS.textMuted }}>
            {agentName}
          </span>
        )}
        {repeatCount && repeatCount > 1 && (
          <span
            title={`This message appeared ${repeatCount} times in a row`}
            className="text-[9px] font-mono"
            style={{
              marginLeft: 'auto',
              padding: '0 5px',
              borderRadius: 8,
              background: role.text + '22',
              color: role.text,
              fontWeight: 600,
              letterSpacing: '0.02em',
              flexShrink: 0,
            }}
          >
            ×{repeatCount}
          </span>
        )}
      </div>

      {/* Content — line-clamped when collapsed; CSS handles ellipsis only when actually overflowing. */}
      <div
        className="text-[9px] font-mono leading-relaxed whitespace-pre-wrap break-words"
        style={{
          color: role.text,
          ...(expanded ? null : {
            display: '-webkit-box',
            WebkitLineClamp: MESSAGE_LINE_CLAMP,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }),
        }}
      >
        {message.content}
      </div>

      {/* Show toggle only if currently overflowing or already expanded. */}
      {(expanded || isOverflowing) && (() => {
        const totalLines = message.content.split('\n').length
        return (
          <button
            className="text-[9px] font-mono mt-0.5 transition-colors"
            style={{ color: COLORS.textMuted }}
            onClick={(e) => { e.stopPropagation(); setExpanded(prev => !prev) }}
          >
            {expanded ? '▴ less' : `▾ more (${totalLines} ${totalLines === 1 ? 'line' : 'lines'})`}
          </button>
        )
      })()}
    </div>
  )
}
