import { useRef, useState, useEffect, useCallback } from 'react'
import { SOUND_PREF_KEY } from '@/lib/canvas-constants'
import { AudioEngine } from '@/lib/audio-engine'
import type { Agent, ToolCallNode } from '@/lib/agent-types'
import { detectStateChanges } from '@/components/agent-visualizer/canvas/detect-state-changes'

export function useAudioEffects(
  agents: Map<string, Agent>,
  toolCalls: Map<string, ToolCallNode>,
  isReviewing: boolean,
) {
  const audioRef = useRef<AudioEngine | null>(null)
  const [isMuted, setIsMuted] = useState(true)
  const seekingRef = useRef(false)
  // Ping-pong pairs for the state-change detector (see canvas.tsx for the
  // same pattern). Reused across calls; one half is "prev", the other is
  // cleared and repopulated each call.
  const agentStatesARef = useRef<Map<string, string>>(new Map())
  const agentStatesBRef = useRef<Map<string, string>>(new Map())
  const toolStatesARef = useRef<Map<string, string>>(new Map())
  const toolStatesBRef = useRef<Map<string, string>>(new Map())
  const stateMapsUseARef = useRef(true)

  // Audio engine lifecycle + restore persisted mute preference
  useEffect(() => {
    const engine = new AudioEngine()
    try {
      const savedOn = localStorage.getItem(SOUND_PREF_KEY) === 'on'
      if (savedOn) {
        engine.setMuted(false)
        setIsMuted(false)
      }
    } catch { /* localStorage unavailable (private browsing, etc.) */ }
    audioRef.current = engine
    return () => { audioRef.current?.dispose(); audioRef.current = null }
  }, [])

  // Detect tool/agent state transitions and play sounds (live mode only)
  useEffect(() => {
    if (seekingRef.current || !audioRef.current || isReviewing) return
    const audio = audioRef.current

    const useA = stateMapsUseARef.current
    const prevAgents = useA ? agentStatesARef.current : agentStatesBRef.current
    const outAgents = useA ? agentStatesBRef.current : agentStatesARef.current
    const prevTools  = useA ? toolStatesARef.current  : toolStatesBRef.current
    const outTools   = useA ? toolStatesBRef.current  : toolStatesARef.current
    const { transitions } = detectStateChanges(
      agents, toolCalls,
      prevAgents, prevTools,
      outAgents, outTools,
    )
    stateMapsUseARef.current = !useA

    for (const t of transitions) {
      switch (t.kind) {
        case 'agent_spawn':   audio.playAgentSpawn(); break
        case 'agent_complete': audio.playAgentComplete(); break
        case 'tool_start':    audio.playToolStart(); break
        case 'tool_complete': audio.playToolEnd(); break
        case 'tool_error':    audio.playError(); break
      }
    }
  }, [agents, toolCalls, isReviewing])

  const handleToggleMute = useCallback(() => {
    if (audioRef.current) {
      const nowMuted = audioRef.current.toggleMute()
      setIsMuted(nowMuted)
      try { localStorage.setItem(SOUND_PREF_KEY, nowMuted ? 'off' : 'on') } catch { /* ignore */ }
    }
  }, [])

  // UI feedback sounds for top-bar button clicks. Reuses the existing tool-click
  // tones — 'save' = higher positive click, 'reset' = lower neutral click.
  const playUiClick = useCallback((variant: 'save' | 'reset') => {
    const engine = audioRef.current
    if (!engine) return
    if (variant === 'save') engine.playToolEnd()
    else engine.playToolStart()
  }, [])

  return { isMuted, seekingRef, handleToggleMute, playUiClick }
}
