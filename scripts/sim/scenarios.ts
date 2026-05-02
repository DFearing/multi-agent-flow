/**
 * Pre-built scenarios for the wire-format simulator.
 *
 * Each scenario is one or more concurrent SessionScripts. Add new scenarios
 * here — sim.ts reads from the registry below.
 */

import type { Runner, SessionAPI } from './runner'

export interface Scenario {
  name: string
  description: string
  /** Run one full simulation. May spawn multiple sessions concurrently. */
  run(runner: Runner): Promise<void>
}

// ─── solo ───────────────────────────────────────────────────────────────────

const solo: Scenario = {
  name: 'solo',
  description: 'Single session with mixed tool calls and a final summary.',
  async run(runner) {
    const s = await runner.startSession()
    await s.user('Refactor the payment system to support Stripe and PayPal')
    await s.wait(800)
    await s.thinking('Multi-part task. I should explore the codebase first.')
    await s.wait(400)
    await s.text("I'll start by understanding the current payment structure.")

    await s.tool('Glob', { pattern: 'src/**/*.ts' }, '47 files matched', { durationMs: 250 })
    await s.tool('Read', { file_path: 'src/services/payment.ts' }, 'payment.ts — 234 lines, legacy Stripe v2', { durationMs: 350 })
    await s.tool('Grep', { pattern: 'stripe|paypal' }, '28 matches across 9 files', { durationMs: 280 })

    await s.thinking('Strategy pattern with adapters fits best.')
    await s.text("I'll write a PaymentGateway abstraction with adapters for each provider.")

    await s.tool('Bash', { command: 'npm install stripe @paypal/checkout-server-sdk' }, 'added 23 packages in 4.2s', { durationMs: 1200 })
    await s.tool('Write', { file_path: 'src/services/stripe-adapter.ts' }, 'Created — 94 lines', { durationMs: 200 })
    await s.tool('Write', { file_path: 'src/services/paypal-adapter.ts' }, 'Created — 78 lines', { durationMs: 200 })
    await s.tool('Bash', { command: 'npm test -- payments' }, '14 passed, 0 failed (8.3s)', { durationMs: 2500 })

    await s.text('Done — both adapters in place, tests passing.')
    await s.end()
  },
}

// ─── tool-failure ───────────────────────────────────────────────────────────

const toolFailure: Scenario = {
  name: 'tool-failure',
  description: 'Tools that fail, error recovery, eventual success.',
  async run(runner) {
    const s = await runner.startSession()
    await s.user('Build the project and run the tests')
    await s.wait(500)
    await s.tool('Bash', { command: 'npm run build' }, "tsc error: 'Foo' is not assignable to 'Bar' at src/x.ts:42", { failed: true, durationMs: 1500 })
    await s.thinking('Type error in src/x.ts — let me look at it.')
    await s.tool('Read', { file_path: 'src/x.ts' }, '...definition of Foo with mismatched union...', { durationMs: 200 })
    await s.tool('Edit', { file_path: 'src/x.ts' }, 'Edited — replaced Foo with Bar at line 42', { durationMs: 250 })
    await s.tool('Bash', { command: 'npm run build' }, 'build succeeded in 12.4s', { durationMs: 1800 })
    await s.tool('Bash', { command: 'npm test' }, '2 failed: payment.test.ts (race condition)', { failed: true, durationMs: 3000 })
    await s.thinking('Race condition — needs proper async sequencing.')
    await s.tool('Edit', { file_path: 'src/payment.ts' }, 'Awaited the pending intent before resolving', { durationMs: 300 })
    await s.tool('Bash', { command: 'npm test' }, '14 passed, 0 failed (7.8s)', { durationMs: 2200 })
    await s.text('Build green, tests passing.')
    await s.end()
  },
}

// ─── subagents ──────────────────────────────────────────────────────────────

const subagents: Scenario = {
  name: 'subagents',
  description: 'Orchestrator dispatches two parallel subagents.',
  async run(runner) {
    const s = await runner.startSession()
    await s.user('Audit the codebase for unused exports and dead code')
    await s.wait(400)
    await s.thinking('I should run two passes in parallel — exports and reachability.')
    await s.text('Dispatching subagents for parallel analysis.')

    const [exportSub, deadSub] = await Promise.all([
      s.spawnSubagent('export-auditor', 'Find unused exports across the workspace'),
      s.spawnSubagent('dead-code-scanner', 'Identify unreachable code paths'),
    ])

    await Promise.all([
      (async () => {
        await exportSub.wait(300)
        await exportSub.thinking('Globbing all TS files first.')
        await exportSub.tool('Glob', { pattern: '**/*.{ts,tsx}' }, '312 files', { durationMs: 400 })
        await exportSub.tool('Grep', { pattern: 'export ' }, '847 export statements', { durationMs: 600 })
        await exportSub.tool('Bash', { command: 'npx ts-prune' }, '23 unused exports across 11 files', { durationMs: 2200 })
        await exportSub.text('Found 23 unused exports — list attached.')
        await exportSub.return('23 unused exports identified across 11 files')
      })(),
      (async () => {
        await deadSub.wait(500)
        await deadSub.thinking('Running coverage to find unreached branches.')
        await deadSub.tool('Bash', { command: 'npm test -- --coverage' }, 'coverage: 78% statements', { durationMs: 4000 })
        await deadSub.tool('Read', { file_path: 'coverage/coverage-summary.json' }, '14 functions never called', { durationMs: 200 })
        await deadSub.text('14 dead functions detected.')
        await deadSub.return('14 unreachable functions in payment + auth modules')
      })(),
    ])

    await s.wait(300)
    await s.text('Both audits complete. Summarizing findings.')
    await s.tool('Write', { file_path: 'audit-report.md' }, 'Wrote audit report — 67 lines', { durationMs: 250 })
    await s.text('Audit report saved to audit-report.md.')
    await s.end()
  },
}

// ─── multi-session ──────────────────────────────────────────────────────────

const multiSession: Scenario = {
  name: 'multi-session',
  description: 'Two unrelated sessions running concurrently.',
  async run(runner) {
    const a = await runner.startSession('Session A: refactor auth')
    const b = await runner.startSession('Session B: add request logging')

    await Promise.all([
      (async () => {
        await a.user('Refactor the auth module to use JWT instead of sessions')
        await a.wait(500)
        await a.tool('Read', { file_path: 'src/auth/session.ts' }, '180 lines, cookie-based session store', { durationMs: 400 })
        await a.tool('Write', { file_path: 'src/auth/jwt.ts' }, 'Created — 95 lines', { durationMs: 300 })
        await a.tool('Edit', { file_path: 'src/auth/middleware.ts' }, 'Switched to verifyJwt()', { durationMs: 250 })
        await a.text('Auth migrated to JWT.')
        await a.end()
      })(),
      (async () => {
        await b.user('Add structured request logging to all routes')
        await b.wait(700)
        await b.tool('Glob', { pattern: 'src/routes/**/*.ts' }, '12 route files', { durationMs: 200 })
        await b.tool('Edit', { file_path: 'src/middleware/log.ts' }, 'Added pino with req.id correlation', { durationMs: 350 })
        await b.tool('Bash', { command: 'npm test' }, 'all green', { durationMs: 1800 })
        await b.text('Logging middleware in place.')
        await b.end()
      })(),
    ])
  },
}

// ─── stress ─────────────────────────────────────────────────────────────────

const stress: Scenario = {
  name: 'stress',
  description: '500 rapid tool calls in one session — exercises buffering and SSE throughput.',
  async run(runner) {
    const s = await runner.startSession('Stress test')
    await s.user('Read every file in src/')
    await s.wait(200)
    for (let i = 0; i < 500; i++) {
      await s.tool('Read', { file_path: `src/file-${i}.ts` }, `file-${i}.ts — ${20 + (i % 80)} lines`, { durationMs: 5 })
    }
    await s.text('All 500 files read.')
    await s.end()
  },
}

// ─── permission-prompt ──────────────────────────────────────────────────────

const permissionPrompt: Scenario = {
  name: 'permission-prompt',
  description: 'Tool call left pending — relay infers a permission prompt.',
  async run(runner) {
    const s = await runner.startSession()
    await s.user('Delete the build directory')
    await s.wait(400)
    await s.thinking("This is destructive — Claude will ask for permission.")
    const resolve = await s.pendingTool('Bash', { command: 'rm -rf dist/' })
    // Hold the call open longer than the permission-detection timeout
    // (constants.PERMISSION_DETECTION_DELAY_MS, ~3s) so the relay emits
    // permission_requested. Then we resolve as if the user approved.
    await s.wait(5000)
    await resolve('removed dist/ (124 files)')
    await s.text('Build directory cleared.')
    await s.end()
  },
}

// ─── concurrent (long-running) ──────────────────────────────────────────────

const TASKS = [
  'Refactor the auth module to use JWT instead of sessions',
  'Add structured request logging to all routes',
  'Migrate the queue worker to BullMQ v5',
  'Replace the in-memory cache with Redis',
  'Audit dependencies for known CVEs',
]

const concurrent: Scenario = {
  name: 'concurrent',
  description: 'N concurrent sessions that emit events until Ctrl+C — for layout-on-reload testing.',
  async run(runner) {
    const count = Number(process.env.SIM_CONCURRENT_COUNT) || 3
    const sessions = await Promise.all(
      Array.from({ length: count }, (_, i) => runner.startSession(`Long session ${i + 1}: ${TASKS[i % TASKS.length].slice(0, 32)}…`)),
    )

    // Per-session loops. Different cadences so the canvases don't all tick
    // in lockstep — easier to tell which is which while testing. Each round
    // dispatches 3 subagents in parallel so the visualizer always shows
    // active sub-trees under every main agent.
    await Promise.all(
      sessions.map(async (s, i) => {
        await s.user(TASKS[i % TASKS.length])
        await s.wait(300 + i * 200)
        await s.thinking('Planning — I will dispatch parallel subagents to inspect the code.')

        let round = 0
        const baseGap = 1500 + i * 400
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await s.tool(
            'Read',
            { file_path: `src/session-${i + 1}/orchestrator-round-${round}.ts` },
            `read — ${40 + (round % 60)} lines`,
            { durationMs: 500 + (round % 3) * 200 },
          )

          await s.text(`Round ${round + 1}: dispatching 3 subagents.`)

          const [reader, tester, linter] = await Promise.all([
            s.spawnSubagent(`code-reader-${round}`, 'Scan source for relevant files'),
            s.spawnSubagent(`test-runner-${round}`, 'Run the affected test suite'),
            s.spawnSubagent(`lint-checker-${round}`, 'Lint and auto-fix style issues'),
          ])

          await Promise.all([
            (async () => {
              await reader.wait(150)
              await reader.thinking('Globbing source for relevant files.')
              await reader.tool('Glob', { pattern: 'src/**/*.ts' }, `${80 + (round % 40)} files`, { durationMs: 400 })
              await reader.tool('Read', { file_path: `src/module-${round}.ts` }, `module-${round}.ts — 120 lines`, { durationMs: 600 })
              await reader.text('Read pass complete.')
              await reader.return(`code-reader: scanned ${80 + (round % 40)} files`)
            })(),
            (async () => {
              await tester.wait(250)
              await tester.thinking('Running the affected test suite.')
              await tester.tool(
                'Bash',
                { command: `npm test -- --filter session-${i + 1}` },
                `12 passed (${(2 + Math.random() * 3).toFixed(1)}s)`,
                { durationMs: 1500 + (round % 3) * 300 },
              )
              await tester.text('Tests green.')
              await tester.return('test-runner: 12 passed')
            })(),
            (async () => {
              await linter.wait(400)
              await linter.thinking('Running ESLint to find style issues.')
              await linter.tool(
                'Bash',
                { command: 'npx eslint src/' },
                `${round % 5} warnings, 0 errors`,
                { durationMs: 1100 + (round % 4) * 200 },
              )
              if (round % 3 === 0) {
                await linter.tool('Edit', { file_path: `src/lint-fix-${round}.ts` }, 'auto-fixed 2 issues', { durationMs: 300 })
              }
              await linter.text('Lint pass done.')
              await linter.return(`lint-checker: ${round % 5} warnings`)
            })(),
          ])

          await s.text(`Round ${round + 1} synthesized — 3 subagent reports merged.`)
          round++
          await s.wait(baseGap)
        }
      }),
    )
  },
}

// ─── registry ───────────────────────────────────────────────────────────────

export const SCENARIOS: Record<string, Scenario> = {
  [solo.name]: solo,
  [toolFailure.name]: toolFailure,
  [subagents.name]: subagents,
  [multiSession.name]: multiSession,
  [concurrent.name]: concurrent,
  [stress.name]: stress,
  [permissionPrompt.name]: permissionPrompt,
}

export const SCENARIO_NAMES = Object.keys(SCENARIOS)
