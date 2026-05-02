'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Agent } from '@/lib/agent-types'
import { COLORS, ROLE_COLORS, colorForSession, getStateColor } from '@/lib/colors'
import type { ConversationMessage } from '@/hooks/simulation/types'
import { useVirtualList } from '@/hooks/use-virtual-list'
import { mergeByTimestamp } from '@/lib/sort-utils'
import { FloatingPanel } from './floating-panel'
import { useSessionStatsSel, type SessionStats } from './session-stats-provider'

interface MessageFeedPanelProps {
  /** Set of visible session ids — only these sessions contribute messages. */
  visibleSessionIds: ReadonlySet<string>
  onAgentClick: (agentId: string | null) => void
  selectedAgentId: string | null
  onClose?: () => void
}

// Only show text messages (assistant, user, thinking)
const TEXT_TYPES = new Set(['assistant', 'user', 'thinking'])

const TAB_AGENT_NAME_MAX = 14

const MESSAGE_GAP = 4

interface DedupedMessage extends ConversationMessage {
  agentId: string
  count: number
  lastTimestamp: number
}

// ─── Feed data selector ────────────────────────────────────────────────────

type FeedData = {
  conversations: Map<string, ConversationMessage[]>
  agents: Map<string, Agent>
  agentToSession: Map<string, string>
}

function feedDataEqual(a: FeedData, b: FeedData): boolean {
  if (a.conversations === b.conversations && a.agents === b.agents) return true
  if (a.conversations.size !== b.conversations.size || a.agents.size !== b.agents.size) return false
  for (const [k, v] of a.conversations) {
    if (b.conversations.get(k) !== v) return false
  }
  for (const [k, v] of a.agents) {
    if (b.agents.get(k) !== v) return false
  }
  return true
}

// ─── Main component ─────────────────────────────────────────────────────────

export function MessageFeedPanel({
  visibleSessionIds,
  onAgentClick,
  selectedAgentId,
  onClose,
}: MessageFeedPanelProps) {
  // Select only conversations and agents for visible sessions from the store.
  const feedData = useSessionStatsSel(
    useCallback((snap: ReadonlyMap<string, SessionStats>): FeedData => {
      const conversations = new Map<string, ConversationMessage[]>()
      const agents = new Map<string, Agent>()
      const agentToSession = new Map<string, string>()
      for (const [sid, stats] of snap) {
        if (!visibleSessionIds.has(sid)) continue
        for (const [agentId, msgs] of stats.conversations) {
          conversations.set(`${sid}:${agentId}`, msgs)
        }
        for (const [agentId, ag] of stats.agents) {
          agents.set(`${sid}:${agentId}`, ag)
          agentToSession.set(`${sid}:${agentId}`, sid)
        }
      }
      return { conversations, agents, agentToSession }
    }, [visibleSessionIds]),
    feedDataEqual,
  )

  const { conversations, agents, agentToSession } = feedData

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

  const agentsWithMessages = useMemo(() => {
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
  }, [conversations, agentKey])

  // Incremental message cache
  const messagesCacheRef = useRef<{
    key: string
    counts: Map<string, number>
    result: (ConversationMessage & { agentId: string })[]
  }>({ key: '', counts: new Map(), result: [] })

  const messages = useMemo(() => {
    const currentAgents = agentsRef.current
    const cache = messagesCacheRef.current
    const cacheKey = `${activeTab}:${agentKey}`

    if (cache.key !== cacheKey) {
      cache.key = cacheKey
      cache.counts = new Map()
      cache.result = []
    }

    if (activeTab === 'all') {
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
  }, [conversations, activeTab, agentKey])

  // Collapse runs of consecutive identical messages
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
        last.count++
        last.lastTimestamp = msg.timestamp
      } else {
        out.push({ ...msg, count: 1, lastTimestamp: msg.timestamp })
      }
    }
    return out
  }, [messages])

  // Virtual list with auto-scroll
  const {
    visibleItems, totalHeight, offsetTop,
    handleScroll, measureRef,
  } = useVirtualList(dedupedMessages, logRef, { gap: MESSAGE_GAP, autoScroll: true })

  // Track unread messages per agent tab
  useEffect(() => {
    const totalCount = Array.from(conversations.values()).reduce((n, msgs) => n + msgs.length, 0)
    if (totalCount > prevCountRef.current) {
      for (const [agentId, msgs] of conversations) {
        if (agentId !== activeTab && activeTab !== 'all' && msgs.length > 0) {
          setUnread(prev => new Set(prev).add(agentId))
        }
      }
    }
    prevCountRef.current = totalCount
  }, [conversations, activeTab])

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

  if (agentsWithMessages.length === 0) return null

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
        className="flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
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
                  const sid = agentToSession.get(msg.agentId)
                  const sessionDot = sid ? colorForSession(sid).accent : null
                  return (
                    <div
                      key={msg.id}
                      ref={measureRef(msg.id)}
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
                        onClick={() => onAgentClick(msg.agentId)}
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

const APPROX_CHARS_PER_LINE = 50

function MessageRow({ message, agentId, agentName, showAgent, isSelected, sessionDot, repeatCount, onClick }: {
  message: ConversationMessage
  agentId: string
  agentName: string
  showAgent: boolean
  isSelected: boolean
  sessionDot: string | null
  repeatCount?: number
  onClick: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const role = ROLE_COLORS[message.type] ?? ROLE_COLORS.assistant

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
            x{repeatCount}
          </span>
        )}
      </div>

      {/* Content */}
      <div
        className="text-[9px] font-mono leading-relaxed whitespace-pre-wrap break-words"
        style={{
          color: role.text,
          ...(expanded ? {} : {
            display: '-webkit-box',
            WebkitLineClamp: MESSAGE_LINE_CLAMP,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }),
        }}
      >
        {message.content}
      </div>

      {(expanded || isOverflowing) && (() => {
        const totalLines = message.content.split('\n').length
        return (
          <button
            className="text-[9px] font-mono mt-0.5 transition-colors"
            style={{ color: COLORS.textMuted }}
            onClick={(e) => { e.stopPropagation(); setExpanded(prev => !prev) }}
          >
            {expanded ? '< less' : `> more (${totalLines} ${totalLines === 1 ? 'line' : 'lines'})`}
          </button>
        )
      })()}
    </div>
  )
}
