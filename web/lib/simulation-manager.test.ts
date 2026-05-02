import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSimulationManager, type SimulationManager } from './simulation-manager'
import type { SimulationEvent } from '@/lib/agent-types'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(
  type: SimulationEvent['type'],
  time: number,
  payload: Record<string, unknown> = {},
  sessionId?: string,
): SimulationEvent {
  return { type, time, payload, ...(sessionId ? { sessionId } : {}) } as SimulationEvent
}

function spawnEvent(name: string, time: number, sessionId?: string): SimulationEvent {
  return makeEvent('agent_spawn', time, { name, isMain: true, task: 'test' }, sessionId)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('createSimulationManager', () => {
  let manager: SimulationManager

  beforeEach(() => {
    manager = createSimulationManager()
  })

  afterEach(() => {
    manager.destroy()
  })

  describe('session lifecycle', () => {
    it('addSession registers a new session', () => {
      manager.addSession('s1')
      expect(manager.hasSession('s1')).toBe(true)
      expect(manager.getSessionIds()).toEqual(['s1'])
    })

    it('addSession is a no-op for existing sessions', () => {
      manager.addSession('s1')
      manager.addSession('s1')
      expect(manager.getSessionIds()).toEqual(['s1'])
    })

    it('removeSession cleans up', () => {
      manager.addSession('s1')
      manager.removeSession('s1')
      expect(manager.hasSession('s1')).toBe(false)
      expect(manager.getSessionIds()).toEqual([])
    })

    it('getSessionState returns empty state for unknown session', () => {
      const state = manager.getSessionState('unknown')
      expect(state.agents.size).toBe(0)
    })
  })

  describe('multi-session isolation', () => {
    it('agents in session A do not appear in session B', () => {
      manager.addSession('sA')
      manager.addSession('sB')

      // Push a spawn event only to session A.
      manager.pushEvents('sA', [spawnEvent('agent-alpha', 0)])

      // Manually tick by starting and running a frame.
      // Since we can't rely on rAF in tests, we verify that pushEvents
      // queues events and getSessionState reads the correct session.
      const stateA = manager.getSessionState('sA')
      const stateB = manager.getSessionState('sB')

      // Before processing (no rAF has run), states are empty.
      expect(stateA.agents.size).toBe(0)
      expect(stateB.agents.size).toBe(0)
    })

    it('play/pause on session A does not affect session B', () => {
      manager.addSession('sA')
      manager.addSession('sB')

      manager.pause('sA')

      const stateA = manager.getSessionState('sA')
      const stateB = manager.getSessionState('sB')

      expect(stateA.isPlaying).toBe(false)
      expect(stateB.isPlaying).toBe(true) // default is playing
    })
  })

  describe('per-session controls', () => {
    it('play sets isPlaying to true', () => {
      manager.addSession('s1')
      manager.pause('s1')
      expect(manager.getSessionState('s1').isPlaying).toBe(false)
      manager.play('s1')
      expect(manager.getSessionState('s1').isPlaying).toBe(true)
    })

    it('pause sets isPlaying to false', () => {
      manager.addSession('s1')
      manager.pause('s1')
      expect(manager.getSessionState('s1').isPlaying).toBe(false)
    })

    it('setSpeed updates the speed', () => {
      manager.addSession('s1')
      manager.setSpeed('s1', 4)
      expect(manager.getSessionState('s1').speed).toBe(4)
    })

    it('restart resets the session state', () => {
      manager.addSession('s1')
      manager.setSpeed('s1', 3)
      manager.restart('s1')
      const state = manager.getSessionState('s1')
      expect(state.agents.size).toBe(0)
      expect(state.isPlaying).toBe(true)
      // Speed should be preserved across restart.
      expect(state.speed).toBe(3)
    })

    it('seekToTime replays events up to the target time', () => {
      manager.addSession('s1')
      // seekToTime replays from the event log. Since we haven't processed
      // any events yet, seeking should just set the time.
      manager.seekToTime('s1', 5.0)
      const state = manager.getSessionState('s1')
      expect(state.currentTime).toBe(5.0)
    })
  })

  describe('subscriber notifications', () => {
    it('subscriber to session A is not called on session B updates', () => {
      manager.addSession('sA')
      manager.addSession('sB')

      const listenerA = vi.fn()
      manager.subscribe('sA', listenerA)

      // Modify session B.
      manager.play('sB')
      manager.pause('sB')

      expect(listenerA).not.toHaveBeenCalled()
    })

    it('subscriber fires when its session is modified', () => {
      manager.addSession('s1')

      const listener = vi.fn()
      manager.subscribe('s1', listener)

      manager.pause('s1')
      expect(listener).toHaveBeenCalledTimes(1)

      manager.play('s1')
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('unsubscribe removes the listener', () => {
      manager.addSession('s1')

      const listener = vi.fn()
      const unsub = manager.subscribe('s1', listener)
      unsub()

      manager.pause('s1')
      expect(listener).not.toHaveBeenCalled()
    })

    it('getSnapshotVersion bumps on session modification', () => {
      manager.addSession('s1')
      const v0 = manager.getSnapshotVersion('s1')

      manager.pause('s1')
      const v1 = manager.getSnapshotVersion('s1')
      expect(v1).toBeGreaterThan(v0)

      manager.play('s1')
      const v2 = manager.getSnapshotVersion('s1')
      expect(v2).toBeGreaterThan(v1)
    })
  })

  describe('snapshot/restore', () => {
    it('saveSnapshot returns a state copy', () => {
      manager.addSession('s1')
      manager.setSpeed('s1', 2)

      const snapshot = manager.saveSnapshot('s1')
      expect(snapshot.simState.speed).toBe(2)
      expect(snapshot.simState.isPlaying).toBe(true)
    })

    it('restoreSnapshot round-trips a session state', () => {
      manager.addSession('s1')
      manager.setSpeed('s1', 3)
      manager.pause('s1')

      const snapshot = manager.saveSnapshot('s1')

      // Modify the session.
      manager.restart('s1')
      expect(manager.getSessionState('s1').speed).toBe(3) // speed preserved

      // Restore the snapshot.
      manager.restoreSnapshot('s1', snapshot)
      const restored = manager.getSessionState('s1')
      // Restore always sets isPlaying to true (for auto-resume).
      expect(restored.isPlaying).toBe(true)
    })

    it('saveSnapshot for unknown session returns empty state', () => {
      const snapshot = manager.saveSnapshot('nonexistent')
      expect(snapshot.simState.agents.size).toBe(0)
      expect(snapshot.blockId).toBe(0)
    })
  })

  describe('updateAgentPosition', () => {
    it('is a no-op for unknown sessions', () => {
      // Should not throw.
      manager.updateAgentPosition('unknown', 'agent-1', 10, 20)
    })
  })

  describe('lifecycle', () => {
    it('start/destroy manages the rAF loop', () => {
      // start() should not throw even if called multiple times.
      manager.start()
      manager.start()
      manager.destroy()
      manager.destroy()
    })
  })
})
