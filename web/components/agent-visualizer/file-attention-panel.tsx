'use client'

import { useState } from 'react'
import { FileAttention } from '@/lib/agent-types'
import { COLORS } from '@/lib/colors'
import { formatTokens, truncatePath } from '@/lib/utils'
import { ProgressBar } from './shared-ui'
import { FloatingPanel } from './floating-panel'

interface FileAttentionPanelProps {
  visible: boolean
  fileAttention: Map<string, FileAttention>
  onClose: () => void
  onOpenFile?: (filePath: string) => void
}

export function FileAttentionPanel({ visible, fileAttention, onClose, onOpenFile }: FileAttentionPanelProps) {
  const [defaultRect] = useState(() => {
    if (typeof window === 'undefined') return { x: 800, y: 108, w: 260, h: 480 }
    return { x: window.innerWidth - 280, y: 108, w: 260, h: 480 }
  })

  const files = Array.from(fileAttention.values())
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const maxTokens = Math.max(...files.map(f => f.totalTokens), 1)

  return (
    <FloatingPanel
      id="file-attention"
      defaultRect={defaultRect}
      minW={200}
      minH={160}
      visible={visible}
      title="FILE ATTENTION"
      onClose={onClose}
    >
      <div className="flex flex-col h-full p-3 pt-1">
        {/* File list */}
        <div className="space-y-1 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: `${COLORS.scrollbarThumb} transparent` }}>
          {files.length === 0 && (
            <div className="text-[9px] font-mono py-2 text-center" style={{ color: COLORS.textMuted }}>
              No files accessed yet
            </div>
          )}
          {files.map((file) => {
            const heatRatio = file.totalTokens / maxTokens
            const heatColor = heatRatio > 0.7 ? COLORS.error :
              heatRatio > 0.4 ? COLORS.tool :
                COLORS.holoBase
            const canOpen = onOpenFile && file.path.startsWith('/')
            const displayPath = truncatePath(file.path)

            return (
              <div
                key={file.path}
                className={`rounded px-2 py-1.5 transition-colors ${canOpen ? 'hover:brightness-125' : ''}`}
                style={{
                  background: `rgba(10, 15, 30, 0.5)`,
                  border: `1px solid ${canOpen ? heatColor + '30' : heatColor + '15'}`,
                  cursor: canOpen ? 'pointer' : undefined,
                }}
                onClick={canOpen ? () => onOpenFile(file.path) : undefined}
                title={canOpen ? file.path : undefined}
              >
                {/* Filename */}
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono truncate" style={{ color: heatColor, maxWidth: 160 }}>
                    {displayPath}
                  </span>
                  <span className="text-[9px] font-mono" style={{ color: COLORS.textMuted }}>
                    {file.totalTokens > 0 ? formatTokens(file.totalTokens) : '—'}
                  </span>
                </div>

                <div className="mt-1">
                  <ProgressBar percent={heatRatio * 100} color={heatColor} trackColor={COLORS.holoBg05} />
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-2 mt-1">
                  {file.reads > 0 && (
                    <span className="text-[9px] font-mono" style={{ color: COLORS.holoBase + '80' }}>
                      {file.reads} read{file.reads > 1 ? 's' : ''}
                    </span>
                  )}
                  {file.edits > 0 && (
                    <span className="text-[9px] font-mono" style={{ color: COLORS.tool + '80' }}>
                      {file.edits} edit{file.edits > 1 ? 's' : ''}
                    </span>
                  )}
                  {file.agents.length > 0 && (
                    <span className="text-[9px] font-mono" style={{ color: COLORS.textMuted }}
                      title={file.agents.join(', ')}
                    >
                      {file.agents.length} agent{file.agents.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Summary */}
        {files.length > 0 && (
          <div className="mt-2 pt-2 flex justify-between text-[9px] font-mono flex-shrink-0" style={{
            borderTop: `1px solid ${COLORS.holoBorder08}`,
            color: COLORS.textMuted,
          }}>
            <span>{files.length} files</span>
            <span>{formatTokens(files.reduce((s, f) => s + f.totalTokens, 0))} tokens in file reads</span>
          </div>
        )}
      </div>
    </FloatingPanel>
  )
}
