#!/usr/bin/env node
/**
 * Agent Flow benchmark harness.
 *
 * Boots three production-built stacks one at a time:
 *   A = upstream baseline (merge-base 59ccf4e)
 *   B = features-but-no-perf (433ef5a, parent of first perf: commit)
 *   C = PR 1 head (f5d9976)
 *
 * For each stack: runs N reps × 2 CPU-throttle levels of the `concurrent`
 * sim scenario, records browser-side perf metrics via Playwright + CDP, and
 * appends a JSON line per run to results/runs.jsonl. Final aggregation runs
 * after all stacks finish.
 *
 * Outputs:
 *   results/runs.jsonl    one row per run (stack, throttle, rep, metrics)
 *   results/summary.md    aggregated comparison report
 */

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as http from 'node:http'
import { chromium } from 'playwright'

// ─── Config ─────────────────────────────────────────────────────────────────

import { fileURLToPath } from 'node:url'

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url))
// Repo layout: <ROOT>/bench/run-bench.mjs lives inside the source repo, with the
// fork-point and pre-perf checkouts as sibling worktrees one level up.
const REPO_ROOT = path.resolve(BENCH_DIR, '..')          // <ROOT>/source
const WORKTREE_ROOT = path.resolve(REPO_ROOT, '..')      // <ROOT>
const BENCH_WS = '/tmp/agent-flow-bench'
const RESULTS_DIR = path.join(BENCH_DIR, 'results')
const RUNS_PATH = path.join(RESULTS_DIR, 'runs.jsonl')
const SUMMARY_PATH = path.join(RESULTS_DIR, 'summary.md')
const INSTRUMENTATION_PATH = path.join(BENCH_DIR, 'instrumentation.js')

const STACKS = [
  { id: 'A-base',    label: 'Baseline (59ccf4e)',     appPath: `${WORKTREE_ROOT}/baseline-tree/app/dist/app.js` },
  { id: 'B-preperf', label: 'Pre-perf (433ef5a)',     appPath: `${WORKTREE_ROOT}/preperf-tree/app/dist/app.js` },
  { id: 'C-pr1',     label: 'PR 1 head (f5d9976)',    appPath: `${WORKTREE_ROOT}/pr1-tree/app/dist/app.js` },
]

const SIM_CWD = REPO_ROOT                     // sim runs from the main repo (it doesn't exist on baseline)
const SIM_CMD = ['pnpm', '--silent', 'sim', 'concurrent', '--workspace', BENCH_WS]
const SIM_ENV = { ...process.env, SIM_CONCURRENT_COUNT: '3' }

const PORT = 7100
let REPS = 5
let THROTTLES = [1, 4]
let WARMUP_MS = 30_000
let MEASURE_MS = 90_000
let STACK_FILTER = null  // CLI: --stack A-base — limit to one stack

// ─── Helpers ────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString().slice(11, 19)
const log = (...a) => console.log(`[${now()}]`, ...a)

function encodedWorkspaceDir(ws) {
  // Mirrors runner.ts encodeWorkspace: alnum kept, others → '-'
  let resolved = path.resolve(ws)
  try { resolved = fs.realpathSync(resolved) } catch {}
  return path.join(os.homedir(), '.claude/projects', resolved.replace(/[^a-zA-Z0-9]/g, '-'))
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }) } catch {}
}

function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, res => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) return resolve()
        retry()
      })
      req.on('error', retry)
      req.setTimeout(1000, () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error(`server at ${url} did not come up`))
      setTimeout(tick, 200)
    }
    tick()
  })
}

function spawnApp(appPath, port) {
  // Run the app from BENCH_WS so its workspace dir is /tmp/agent-flow-bench.
  const proc = spawn('node', [appPath, '--port', String(port), '--no-open'], {
    cwd: BENCH_WS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  proc.stdout.on('data', d => process.stderr.write(`  app[${port}] ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`  app[${port}]! ${d}`))
  return proc
}

function spawnSim() {
  const proc = spawn(SIM_CMD[0], SIM_CMD.slice(1), {
    cwd: SIM_CWD,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: SIM_ENV,
  })
  proc.stdout.on('data', d => { /* swallow — verbose by default */ })
  proc.stderr.on('data', d => process.stderr.write(`  sim! ${d}`))
  return proc
}

async function killGracefully(proc, label) {
  if (!proc || proc.exitCode != null) return
  return new Promise(resolve => {
    const onExit = () => resolve()
    proc.once('exit', onExit)
    proc.kill('SIGINT')
    // Hard kill if it doesn't die in 5s
    setTimeout(() => { if (proc.exitCode == null) proc.kill('SIGKILL') }, 5000)
  })
}

function appendRun(row) {
  fs.appendFileSync(RUNS_PATH, JSON.stringify(row) + '\n')
}

// ─── Single rep ─────────────────────────────────────────────────────────────

async function runOnce({ stack, throttle, rep, browser }) {
  // Clean slate — wipe any leaked sim symlinks/dirs from prior reps.
  rmrf(encodedWorkspaceDir(BENCH_WS))
  rmrf(path.join(BENCH_WS, '.sim-sessions'))
  fs.mkdirSync(BENCH_WS, { recursive: true })

  log(`>>> ${stack.id} throttle=${throttle}x rep=${rep}/${REPS} — booting app`)
  const app = spawnApp(stack.appPath, PORT)
  await waitForServer(`http://127.0.0.1:${PORT}/`)

  const sim = spawnSim()
  // Give the sim a moment to start emitting events.
  await sleep(2000)

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await ctx.addInitScript({ path: INSTRUMENTATION_PATH })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)

  // Per-tab CDP throttle. Set after navigate so initial bundle parse is unthrottled
  // — we measure the steady-state, not first paint.
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })

  // PR 1 (and any branch with the workspace filter) defaults previously-unseen
  // workspaces to HIDDEN. Without this, the bench workspace is filtered out and
  // we'd be measuring an empty canvas. Click the topbar's "Workspaces (N hidden)"
  // pill, then "show all" to make the canvas mount before warmup.
  // Older stacks (e.g. A-base) lack this UI — the locator returns 0, we skip silently.
  try {
    const wsButton = page.getByText(/Workspaces \(\d+ hidden\)/).first()
    await wsButton.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
    if (await wsButton.count() > 0) {
      await wsButton.click({ timeout: 2_000 })
      const showAll = page.getByText('show all', { exact: true }).first()
      await showAll.waitFor({ state: 'visible', timeout: 2_000 })
      await showAll.click()
      await page.keyboard.press('Escape') // close popover so it doesn't affect measurement
      await sleep(500) // let the canvas mount
    }
  } catch (e) {
    log(`    workspace-show-all skipped: ${e.message}`)
  }

  // Warm up — let event buffer fill, layout stabilize.
  await sleep(WARMUP_MS)

  if (throttle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  }

  // CDP perf snapshot before
  await cdp.send('Performance.enable').catch(() => {})
  const perfBefore = await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] }))

  // Diagnostic: snapshot what the page has rendered before measurement.
  const diag = await page.evaluate(() => ({
    hasMemoryApi: typeof performance.memory !== 'undefined',
    canvases: document.querySelectorAll('canvas').length,
    bodyText: (document.body.innerText || '').slice(0, 300).replace(/\n/g, ' | '),
    instr: window.__bench && typeof window.__bench === 'object' ? 'loaded' : 'missing',
    heapAtCheck: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 0,
  }))
  log(`    diag: canvases=${diag.canvases} memApi=${diag.hasMemoryApi} heap=${diag.heapAtCheck}MB instr=${diag.instr}`)
  log(`    body: "${diag.bodyText}"`)

  await page.evaluate(() => window.__bench.start())
  await sleep(MEASURE_MS)
  const summary = await page.evaluate(() => { window.__bench.stop(); return window.__bench.summary() })

  const perfAfter = await cdp.send('Performance.getMetrics').catch(() => ({ metrics: [] }))

  if (throttle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  }

  const cdpDelta = (name) => {
    const a = (perfAfter.metrics || []).find(m => m.name === name)?.value ?? 0
    const b = (perfBefore.metrics || []).find(m => m.name === name)?.value ?? 0
    return a - b
  }

  const row = {
    ts: new Date().toISOString(),
    stack: stack.id,
    label: stack.label,
    throttle,
    rep,
    metrics: summary,
    cdp: {
      scriptDurationSec: cdpDelta('ScriptDuration'),
      taskDurationSec:   cdpDelta('TaskDuration'),
      layoutDurationSec: cdpDelta('LayoutDuration'),
      recalcStyleDurationSec: cdpDelta('RecalcStyleDuration'),
    },
  }
  appendRun(row)

  log(`    fps=${summary.fpsMean.toFixed(1)} p95=${summary.frameMs.p95.toFixed(1)}ms longTasks=${summary.longTasks.count}/${Math.round(summary.longTasks.totalMs)}ms heap=${(summary.heapBytes.peak/1e6).toFixed(1)}MB commits=${summary.reactCommits}`)

  await page.close()
  await ctx.close()
  await killGracefully(sim, 'sim')
  await killGracefully(app, 'app')

  // Final cleanup of leaked symlinks
  rmrf(encodedWorkspaceDir(BENCH_WS))
  rmrf(path.join(BENCH_WS, '.sim-sessions'))

  // Brief settle between reps
  await sleep(1500)
}

// ─── Aggregation ────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return 0
  const s = arr.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}
function stddev(arr) {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1))
}

function writeSummary() {
  const rows = fs.readFileSync(RUNS_PATH, 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l))

  const groupKey = (r) => `${r.stack}|${r.throttle}`
  const groups = new Map()
  for (const r of rows) {
    const k = groupKey(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }

  const lines = []
  lines.push(`# Agent Flow perf benchmark — ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  lines.push('')
  lines.push(`Workload: \`concurrent\` scenario (3 sessions × 3 subagents/round, continuous)`)
  lines.push(`Warmup: ${WARMUP_MS/1000}s · Measurement window: ${MEASURE_MS/1000}s · Reps: ${REPS}/cell`)
  lines.push(`Browser: Chromium headless · Viewport: 1440×900`)
  lines.push('')

  // Helper: cell stats
  const cellStats = (key) => {
    const g = groups.get(key) || []
    return {
      n: g.length,
      fps:    { mean: mean(g.map(r => r.metrics.fpsMean)), sd: stddev(g.map(r => r.metrics.fpsMean)) },
      p95:    { mean: mean(g.map(r => r.metrics.frameMs.p95)), sd: stddev(g.map(r => r.metrics.frameMs.p95)) },
      p99:    { mean: mean(g.map(r => r.metrics.frameMs.p99)), sd: stddev(g.map(r => r.metrics.frameMs.p99)) },
      ltCount:{ mean: mean(g.map(r => r.metrics.longTasks.count)) },
      ltTotal:{ mean: mean(g.map(r => r.metrics.longTasks.totalMs)) },
      script: { mean: mean(g.map(r => r.cdp.scriptDurationSec * 1000)) }, // ms
      heap:   { mean: mean(g.map(r => r.metrics.heapBytes.peak)) / 1e6 },  // MB
      commits:{ mean: mean(g.map(r => r.metrics.reactCommits)) },
    }
  }

  for (const throttle of THROTTLES) {
    lines.push(`## CPU throttle: ${throttle}×`)
    lines.push('')
    lines.push('| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |')
    lines.push('|---|---|---|---|---|---|---|---|---|---|')
    const present = []
    for (const stack of STACKS) {
      const s = cellStats(`${stack.id}|${throttle}`)
      if (s.n === 0) continue
      present.push(stack.id)
      lines.push(`| ${stack.label} | ${s.n} | ${s.fps.mean.toFixed(1)} (±${s.fps.sd.toFixed(1)}) | ${s.p95.mean.toFixed(1)} (±${s.p95.sd.toFixed(1)}) | ${s.p99.mean.toFixed(1)} | ${s.ltCount.mean.toFixed(1)} | ${Math.round(s.ltTotal.mean)} | ${Math.round(s.script.mean)} | ${s.heap.mean.toFixed(1)} | ${Math.round(s.commits.mean)} |`)
    }
    lines.push('')

    // Only emit deltas for pairs where both sides have data.
    const A = cellStats(`A-base|${throttle}`)
    const B = cellStats(`B-preperf|${throttle}`)
    const C = cellStats(`C-pr1|${throttle}`)
    const pct = (n, d) => ((n - d) / d * 100).toFixed(1)
    const deltaLines = []
    if (A.n && B.n) deltaLines.push(`- A → B (cost of new features):  FPS ${pct(B.fps.mean, A.fps.mean)}%, p95 ${pct(B.p95.mean, A.p95.mean)}%, scripting ${pct(B.script.mean, A.script.mean)}%`)
    if (B.n && C.n) deltaLines.push(`- B → C (perf-commit payoff):    FPS ${pct(C.fps.mean, B.fps.mean)}%, p95 ${pct(C.p95.mean, B.p95.mean)}%, scripting ${pct(C.script.mean, B.script.mean)}%`)
    if (A.n && C.n) deltaLines.push(`- A → C (net, baseline → PR 1):   FPS ${pct(C.fps.mean, A.fps.mean)}%, p95 ${pct(C.p95.mean, A.p95.mean)}%, longtasks ${pct(C.ltTotal.mean, A.ltTotal.mean)}%, scripting ${pct(C.script.mean, A.script.mean)}%`)
    if (deltaLines.length) {
      lines.push(`**Deltas (${throttle}×):**`)
      lines.push(...deltaLines)
      lines.push('')
    } else if (present.length === 1) {
      lines.push(`_(Only ${present[0]} measured at ${throttle}× — re-run with another \`--stack\` to compute deltas.)_`)
      lines.push('')
    }
  }

  fs.writeFileSync(SUMMARY_PATH, lines.join('\n'))
  log(`summary written to ${SUMMARY_PATH}`)
}

// ─── Main ───────────────────────────────────────────────────────────────────

function parseCliArgs(argv) {
  const out = { summarizeOnly: false, smoke: false, append: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--summarize') out.summarizeOnly = true
    else if (a === '--smoke') {
      // Smoke = 1 rep, 1× throttle only, moderate windows. ~50s/rep.
      out.smoke = true
      REPS = 1
      THROTTLES = [1]
      WARMUP_MS = 15_000
      MEASURE_MS = 30_000
    }
    else if (a === '--append') out.append = true
    else if (a === '--stack' && argv[i + 1]) { STACK_FILTER = argv[++i] }
    else if (a.startsWith('--reps=')) REPS = parseInt(a.slice(7), 10)
    else if (a === '--no-throttle') THROTTLES = [1]
    else if (a === '--throttle-only') THROTTLES = [4]
  }
  return out
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2))

  if (opts.summarizeOnly) {
    writeSummary()
    return
  }

  // Truncate prior runs file unless --append given
  if (!opts.append) {
    fs.writeFileSync(RUNS_PATH, '')
  }

  const stacksToRun = STACK_FILTER
    ? STACKS.filter(s => s.id === STACK_FILTER)
    : STACKS
  if (!stacksToRun.length) {
    console.error(`No stacks match --stack ${STACK_FILTER}. Choices: ${STACKS.map(s => s.id).join(', ')}`)
    process.exit(2)
  }

  log(`config: stacks=[${stacksToRun.map(s => s.id).join(',')}] throttles=[${THROTTLES.join(',')}] reps=${REPS} warmup=${WARMUP_MS}ms measure=${MEASURE_MS}ms`)

  const browser = await chromium.launch({
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      // Remove the 30 FPS / vsync cap so frame-time regressions are visible.
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--disable-features=CalculateNativeWinOcclusion',
      // Report unrounded JS heap size for accurate memory tracking.
      '--enable-precise-memory-info',
    ],
  })

  try {
    for (const stack of stacksToRun) {
      for (const throttle of THROTTLES) {
        for (let rep = 1; rep <= REPS; rep++) {
          await runOnce({ stack, throttle, rep, browser })
        }
      }
    }
  } finally {
    await browser.close()
  }

  writeSummary()
  log('done')
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
