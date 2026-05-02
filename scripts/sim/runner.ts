/**
 * Wire-format simulator for Agent Flow.
 *
 * Drives the real relay/parser/watcher pipeline by writing fake Claude Code
 * transcript JSONL files into ~/.claude/projects/<encoded-cwd>/, using the
 * exact format Claude Code itself produces. The relay can't tell the difference.
 *
 * Storage layout:
 *   <workspace>/.sim-sessions/<sessionId>.jsonl              # real file (orchestrator)
 *   <workspace>/.sim-sessions/<sessionId>/subagents/         # real dir (subagents)
 *   ~/.claude/projects/<encoded>/<sessionId>.jsonl           # symlink → orchestrator
 *   ~/.claude/projects/<encoded>/<sessionId>/                # symlink → subagent dir parent
 *
 * Two symlinks per session live in the user's real Claude project dir; on
 * shutdown we unlink them so no fake data persists in Claude history.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'

const DEFAULT_MODEL = 'claude-opus-4-7'

export interface RunnerOptions {
  workspace: string
  speed: number
  keep: boolean
  verbose: boolean
}

export interface ToolOpts {
  /** Wall-clock duration for the call (before result is written). Default 200ms. */
  durationMs?: number
  /** If true, the result is written but tagged as an error (parser sets "[FAILED]"). */
  failed?: boolean
  /** Override the result tokenCost estimate (rarely needed). */
  resultTokens?: number
  /** Hold the call open without writing a result. Caller resolves manually via opts.holdUntil(). */
  hold?: boolean
}

export interface SessionAPI {
  readonly sessionId: string
  /** Wait (scaled by --speed). */
  wait(ms: number): Promise<void>
  /** Append a user-turn entry. The first one becomes the session label. */
  user(content: string): Promise<void>
  /** Append an assistant text block. */
  text(content: string): Promise<void>
  /** Append an assistant thinking block. */
  thinking(content: string): Promise<void>
  /** Append a tool_use, wait `durationMs`, then append matching tool_result. */
  tool(name: string, input: Record<string, unknown>, result: string, opts?: ToolOpts): Promise<void>
  /** Append a tool_use without writing a result yet. Returns a resolver. */
  pendingTool(name: string, input: Record<string, unknown>): Promise<(result: string, failed?: boolean) => Promise<void>>
  /** Spawn a subagent. Writes the Agent tool_use into the orchestrator transcript
   *  AND creates a fresh subagent JSONL file the relay will tail. */
  spawnSubagent(childName: string, task: string): Promise<SubagentAPI>
  /** Cleanly close the session (no more events). */
  end(): Promise<void>
}

export interface SubagentAPI {
  readonly subagentId: string
  wait(ms: number): Promise<void>
  text(content: string): Promise<void>
  thinking(content: string): Promise<void>
  tool(name: string, input: Record<string, unknown>, result: string, opts?: ToolOpts): Promise<void>
  /** Write the orchestrator's matching tool_result for this subagent's Agent call. */
  return(summary: string): Promise<void>
}

interface RunnerContext {
  workspace: string
  speed: number
  verbose: boolean
  encoded: string
  homeProjectDir: string
  localBase: string
  /** Symlinks created — removed on shutdown unless --keep was passed. */
  cleanupPaths: string[]
}

function encodeWorkspace(workspace: string): string {
  let resolved = path.resolve(workspace)
  try { resolved = fs.realpathSync(resolved) } catch { /* fresh cwd */ }
  return resolved.replace(/[^a-zA-Z0-9]/g, '-')
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}

function newId(): string {
  return crypto.randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}

function appendJsonl(filePath: string, obj: unknown): void {
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n')
}

/** Symlink `target` to `linkPath`. Falls back to a hard copy on platforms
 *  where unprivileged symlinks fail (Windows w/o dev mode); we don't ship
 *  Windows yet so this is best-effort. */
function makeSymlink(target: string, linkPath: string, type: 'file' | 'dir', verbose: boolean): void {
  ensureDir(path.dirname(linkPath))
  try { fs.unlinkSync(linkPath) } catch { /* not present */ }
  try {
    fs.symlinkSync(target, linkPath, type === 'dir' ? 'dir' : 'file')
  } catch (err) {
    if (verbose) console.warn(`[sim] symlink failed (${linkPath}):`, err)
    throw err
  }
}

export interface Runner {
  /** Create a session — writes empty JSONL + symlinks, scans for label, etc.
   *  Multiple sessions can run concurrently on one runner. */
  startSession(label?: string, model?: string): Promise<SessionAPI>
  /** Idempotent cleanup. Called by SIGINT handler in sim.ts. */
  shutdown(): void
}

export function createRunner(opts: RunnerOptions): Runner {
  const ctx: RunnerContext = {
    workspace: path.resolve(opts.workspace),
    speed: opts.speed,
    verbose: opts.verbose,
    encoded: encodeWorkspace(opts.workspace),
    homeProjectDir: '',
    localBase: path.join(path.resolve(opts.workspace), '.sim-sessions'),
    cleanupPaths: [],
  }
  ctx.homeProjectDir = path.join(os.homedir(), '.claude', 'projects', ctx.encoded)

  ensureDir(ctx.homeProjectDir)
  ensureDir(ctx.localBase)

  if (opts.verbose) {
    console.log(`[sim] workspace: ${ctx.workspace}`)
    console.log(`[sim] encoded:   ${ctx.encoded}`)
    console.log(`[sim] target:    ${ctx.homeProjectDir}`)
    console.log(`[sim] local:     ${ctx.localBase}`)
  }

  let shutdownCalled = false

  return {
    async startSession(label?: string, model?: string): Promise<SessionAPI> {
      return createSession(ctx, label, model ?? DEFAULT_MODEL)
    },
    shutdown() {
      if (shutdownCalled) return
      shutdownCalled = true
      if (opts.keep) {
        if (opts.verbose) console.log('[sim] --keep: leaving symlinks in place')
        return
      }
      for (const p of ctx.cleanupPaths) {
        try { fs.unlinkSync(p) } catch { /* already gone */ }
      }
      if (opts.verbose) console.log(`[sim] removed ${ctx.cleanupPaths.length} symlink(s)`)
    },
  }
}

// ─── Session implementation ─────────────────────────────────────────────────

async function createSession(ctx: RunnerContext, label: string | undefined, model: string): Promise<SessionAPI> {
  const sessionId = newId()
  const localFile = path.join(ctx.localBase, `${sessionId}.jsonl`)
  const localSubDir = path.join(ctx.localBase, sessionId, 'subagents')
  const linkFile = path.join(ctx.homeProjectDir, `${sessionId}.jsonl`)
  const linkDir = path.join(ctx.homeProjectDir, sessionId)

  // Pre-create local artifacts so the symlinks resolve to real paths
  ensureDir(localSubDir)
  fs.writeFileSync(localFile, '')

  makeSymlink(localFile, linkFile, 'file', ctx.verbose)
  ctx.cleanupPaths.push(linkFile)
  makeSymlink(path.join(ctx.localBase, sessionId), linkDir, 'dir', ctx.verbose)
  ctx.cleanupPaths.push(linkDir)

  if (ctx.verbose) console.log(`[sim] session ${sessionId.slice(0, 8)} ready (label="${label ?? '(from first user msg)'}")`)

  // Sequenced state
  let parentUuid: string | undefined
  let firstUserSent = false

  const wait = async (ms: number) => sleep(ms / ctx.speed)

  function appendEntry(entry: Record<string, unknown>): void {
    appendJsonl(localFile, entry)
    parentUuid = entry.uuid as string
  }

  function userEntry(content: string): Record<string, unknown> {
    return {
      parentUuid: parentUuid ?? null,
      isSidechain: false,
      type: 'user',
      uuid: newId(),
      sessionId,
      timestamp: nowIso(),
      cwd: ctx.workspace,
      version: '2.1.0',
      message: { role: 'user', content },
    }
  }

  function assistantEntry(content: unknown[]): Record<string, unknown> {
    return {
      parentUuid: parentUuid ?? null,
      isSidechain: false,
      type: 'assistant',
      uuid: newId(),
      sessionId,
      timestamp: nowIso(),
      cwd: ctx.workspace,
      version: '2.1.0',
      message: {
        id: `msg_${newId().replace(/-/g, '').slice(0, 24)}`,
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    }
  }

  function toolResultEntry(toolUseId: string, content: string, failed: boolean): Record<string, unknown> {
    const formatted = failed ? `Error: ${content}` : content
    return {
      parentUuid: parentUuid ?? null,
      isSidechain: false,
      type: 'user',
      uuid: newId(),
      sessionId,
      timestamp: nowIso(),
      cwd: ctx.workspace,
      version: '2.1.0',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: formatted,
            is_error: failed || undefined,
          },
        ],
      },
    }
  }

  async function emitTool(name: string, input: Record<string, unknown>, result: string, opts: ToolOpts | undefined, isOrchestrator: true): Promise<void>
  async function emitTool(name: string, input: Record<string, unknown>, result: string, opts: ToolOpts | undefined, isOrchestrator: false, sub: SubagentInternal): Promise<void>
  async function emitTool(
    name: string,
    input: Record<string, unknown>,
    result: string,
    opts: ToolOpts | undefined,
    isOrchestrator: boolean,
    sub?: SubagentInternal,
  ): Promise<void> {
    const id = `toolu_${newId().replace(/-/g, '').slice(0, 24)}`
    const useBlock = { type: 'tool_use', id, name, input }
    if (isOrchestrator) {
      appendEntry(assistantEntry([useBlock]))
    } else if (sub) {
      sub.appendAssistant([useBlock])
    }

    await wait(opts?.durationMs ?? 200)

    const block = toolResultEntry(id, result, opts?.failed ?? false)
    if (isOrchestrator) {
      appendEntry(block)
    } else if (sub) {
      sub.appendUser(block.message as Record<string, unknown>)
    }
  }

  // Public API
  const api: SessionAPI = {
    sessionId,

    async wait(ms) { await wait(ms) },

    async user(content) {
      // Mimic Claude Code: typed user prompts are content: string entries.
      // Subsequent turns can be tool_result entries (handled separately).
      if (!firstUserSent) {
        firstUserSent = true
      }
      appendEntry(userEntry(content))
    },

    async text(content) {
      appendEntry(assistantEntry([{ type: 'text', text: content }]))
    },

    async thinking(content) {
      appendEntry(assistantEntry([{ type: 'thinking', thinking: content }]))
    },

    async tool(name, input, result, opts) {
      await emitTool(name, input, result, opts, true)
    },

    async pendingTool(name, input) {
      const id = `toolu_${newId().replace(/-/g, '').slice(0, 24)}`
      appendEntry(assistantEntry([{ type: 'tool_use', id, name, input }]))
      return async (result: string, failed = false) => {
        appendEntry(toolResultEntry(id, result, failed))
      }
    },

    async spawnSubagent(childName, task) {
      // Orchestrator's Agent tool_use — parser uses input.description as child name.
      const toolUseId = `toolu_${newId().replace(/-/g, '').slice(0, 24)}`
      appendEntry(assistantEntry([{
        type: 'tool_use', id: toolUseId, name: 'Agent',
        input: { description: childName, prompt: task, subagent_type: childName },
      }]))

      // Create the subagent's own JSONL + meta sidecar in the subagents dir
      const subId = newId()
      const subFile = path.join(localSubDir, `${subId}.jsonl`)
      const metaFile = path.join(localSubDir, `${subId}.meta.json`)
      fs.writeFileSync(subFile, '')
      fs.writeFileSync(metaFile, JSON.stringify({ description: childName, subagent_type: childName }) + '\n')

      return createSubagentApi(ctx, sessionId, subFile, model, toolUseId, (summary, failed) => {
        // Orchestrator-side tool_result (Agent call returns)
        appendEntry(toolResultEntry(toolUseId, summary, failed))
      })
    },

    async end() {
      // Nothing to write — relay marks session "ended" after inactivity timeout.
      // Caller can wait or just exit.
    },
  }

  return api
}

// ─── Subagent implementation ────────────────────────────────────────────────

interface SubagentInternal {
  appendAssistant(content: unknown[]): void
  appendUser(message: Record<string, unknown>): void
}

function createSubagentApi(
  ctx: RunnerContext,
  sessionId: string,
  subFile: string,
  model: string,
  parentToolUseId: string,
  writeOrchestratorReturn: (summary: string, failed: boolean) => void,
): SubagentAPI {
  const subagentId = path.basename(subFile, '.jsonl')
  let subParentUuid: string | undefined

  const wait = async (ms: number) => sleep(ms / ctx.speed)

  function appendSubEntry(entry: Record<string, unknown>): void {
    appendJsonl(subFile, entry)
    subParentUuid = entry.uuid as string
  }

  const internal: SubagentInternal = {
    appendAssistant(content) {
      appendSubEntry({
        parentUuid: subParentUuid ?? null,
        isSidechain: true,
        type: 'assistant',
        uuid: crypto.randomUUID(),
        sessionId,
        timestamp: nowIso(),
        cwd: ctx.workspace,
        version: '2.1.0',
        message: {
          id: `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
          type: 'message', role: 'assistant', model, content,
          stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      })
    },
    appendUser(message) {
      appendSubEntry({
        parentUuid: subParentUuid ?? null,
        isSidechain: true,
        type: 'user',
        uuid: crypto.randomUUID(),
        sessionId,
        timestamp: nowIso(),
        cwd: ctx.workspace,
        version: '2.1.0',
        message,
      })
    },
  }

  // First entry: a system-injected user prompt (the task); the parser skips this
  // for label purposes, but it gives the file content so the watcher picks it up.
  internal.appendUser({ role: 'user', content: 'Subagent task starting.' })

  return {
    subagentId,
    async wait(ms) { await wait(ms) },
    async text(content) { internal.appendAssistant([{ type: 'text', text: content }]) },
    async thinking(content) { internal.appendAssistant([{ type: 'thinking', thinking: content }]) },
    async tool(name, input, result, opts) {
      const id = `toolu_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
      internal.appendAssistant([{ type: 'tool_use', id, name, input }])
      await wait(opts?.durationMs ?? 200)
      const failed = opts?.failed ?? false
      internal.appendUser({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: id,
          content: failed ? `Error: ${result}` : result,
          is_error: failed || undefined,
        }],
      })
    },
    async return(summary) {
      writeOrchestratorReturn(summary, false)
    },
  }
}
