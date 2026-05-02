'use client'

import { useState } from 'react'
import { CARD, type AgentState } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { TranscriptMessage } from './transcript-message'
import type { ConversationMessage } from '@/hooks/simulation/types'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import { FloatingPanel } from './floating-panel'

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
  const { ref: logRef, handleScroll } = useAutoScroll(conversation.length, visible)

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
        {/* Messages */}
        <div
          ref={logRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto space-y-1.5"
          style={{ scrollbarWidth: 'thin', scrollbarColor: `${COLORS.scrollbarThumb} transparent` }}
        >
          {conversation.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-[10px] font-mono" style={{ color: COLORS.textMuted }}>
                No messages yet...
              </p>
            </div>
          ) : (
            conversation.map((msg) => (
              <TranscriptMessage key={msg.id} message={msg} />
            ))
          )}
        </div>
      </div>
    </FloatingPanel>
  )
}
