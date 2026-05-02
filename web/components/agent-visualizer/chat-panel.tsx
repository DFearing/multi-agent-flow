'use client'

import { useRef, useState } from 'react'
import { CARD, type AgentState } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { TranscriptMessage } from './transcript-message'
import type { ConversationMessage } from '@/hooks/simulation/types'
import { useVirtualList } from '@/hooks/use-virtual-list'
import { FloatingPanel } from './floating-panel'

// ─── Constants ──────────────────────────────────────────────────────────────

const CHAT_GAP = 6 // matches space-y-1.5
const CHAT_INITIAL_VIEWPORT = 400

// ─── Component ──────────────────────────────────────────────────────────────

interface ChatPanelProps {
  visible: boolean
  agentName: string
  agentState: AgentState
  conversation: ConversationMessage[]
  onClose: () => void
}

export function AgentChatPanel({
  visible,
  agentName,
  agentState,
  conversation,
  onClose,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const {
    visibleItems, totalHeight, offsetTop,
    handleScroll, measureRef,
    isAtBottom, scrollToBottom,
  } = useVirtualList(conversation, scrollRef, {
    gap: CHAT_GAP,
    initialViewportHeight: CHAT_INITIAL_VIEWPORT,
    autoScroll: true,
  })

  // Compute default rect on client only
  const [defaultRect] = useState(() => {
    if (typeof window === 'undefined') return { x: 800, y: 400, w: CARD.chat.width, h: CARD.chat.maxHeight + 24 }
    return {
      x: window.innerWidth - CARD.chat.width - 12,
      y: window.innerHeight - (CARD.chat.maxHeight + 24) - 64,
      w: CARD.chat.width,
      h: CARD.chat.maxHeight + 24,
    }
  })

  return (
    <FloatingPanel
      id="agent-chat"
      defaultRect={defaultRect}
      minW={220}
      minH={160}
      visible={visible}
      title={`${agentName.toUpperCase()} - ${agentState}`}
      onClose={onClose}
      showHandle={false}
    >
      <div className="flex flex-col h-full p-2">
        {/* Virtualized messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: 'thin', scrollbarColor: `${COLORS.scrollbarThumb} transparent` }}
        >
          {conversation.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-[10px] font-mono" style={{ color: COLORS.textMuted }}>
                No messages yet...
              </p>
            </div>
          ) : (
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
                {visibleItems.map((msg) => (
                  <div
                    key={msg.id}
                    ref={(el) => measureRef(msg.id, el)}
                    style={{ marginBottom: CHAT_GAP }}
                  >
                    <TranscriptMessage message={msg} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Scroll-to-bottom button */}
        {!isAtBottom && conversation.length > 0 && (
          <div className="flex justify-center py-1 flex-shrink-0" style={{ borderTop: `1px solid ${COLORS.holoBorder06}` }}>
            <button
              onClick={scrollToBottom}
              className="text-[9px] font-mono px-3 py-1 rounded-full transition-all"
              style={{
                background: COLORS.holoBg10,
                border: `1px solid ${COLORS.glassBorder}`,
                color: COLORS.scrollBtnText,
              }}
            >
              New messages
            </button>
          </div>
        )}
      </div>
    </FloatingPanel>
  )
}
