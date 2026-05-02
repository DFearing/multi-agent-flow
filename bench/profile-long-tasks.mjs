#!/usr/bin/env node
/**
 * profile-long-tasks.mjs
 *
 * Single-stack CPU profile + long-task capture for diagnosing what's in
 * the JS main-thread long tasks at 4× CPU throttle.
 *
 * Companion to issue #46 direction item 1 ("profile long tasks at 4× throttle").
 * The standard run-bench harness reports *that* 80s of every 90s window is
 * blocked in long tasks, but not *what* the work is. This script attaches
 * a CDP CPU profiler during the measurement window so we can attribute
 * the time to specific functions.
 *
 * Outputs (under bench/results/):
 *   long-tasks-profile.cpuprofile    raw v8 CPU profile (load in DevTools)
 *   long-tasks-summary.json          per-long-task entries from PerformanceObserver
 *   long-tasks-report.md             top hot paths by self time + stack views
 *
 * Usage:
 *   node profile-long-tasks.mjs                # 30s warmup + 90s measurement, 4× throttle
 *   node profile-long-tasks.mjs --smoke        # 15s + 30s for quick verify
 *   node profile-long-tasks.mjs --no-throttle  # measure unthrottled (baseline)
 */
import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as http from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(BENCH_DIR, '..')
const BENCH_WS = '/tmp/agent-flow-bench-profile'
const RESULTS_DIR = path.join(BENCH_DIR, 'results')
const APP_PATH = path.join(REPO_ROOT, 'app/dist/app.js')
const INSTRUMENTATION_PATH = path.join(BENCH_DIR, 'instrumentation.js')
const PORT = 7150
const SIM_COUNT = 3
const SIM_CMD = ['pnpm', '--silent', 'sim', 'concurrent', '--workspace', BENCH_WS]

let WARMUP_MS = 30_000
let MEASURE_MS = 90_000
let THROTTLE = 4
let SAMPLE_INTERVAL_US = 1000   // 1ms — high enough for long-task attribution

const args = process.argv.slice(2)
if (args.includes('--smoke')) { WARMUP_MS = 15_000; MEASURE_MS = 30_000 }
if (args.includes('--no-throttle')) THROTTLE = 1
const NO_BLOOM = args.includes('--no-bloom')
const measureFlag = args.find(a => a.startsWith('--measure='))
if (measureFlag) MEASURE_MS = parseInt(measureFlag.split('=')[1], 10) * 1000
const warmupFlag = args.find(a => a.startsWith('--warmup='))
if (warmupFlag) WARMUP_MS = parseInt(warmupFlag.split('=')[1], 10) * 1000
const SUFFIX = NO_BLOOM ? '-no-bloom' : ''

const now = () => new Date().toISOString().slice(11, 19)
const log = (...a) => console.log(`[${now()}]`, ...a)

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }) } catch {} }

function encodedWorkspaceDir(ws) {
  let resolved = path.resolve(ws)
  try { resolved = fs.realpathSync(resolved) } catch {}
  return path.join(os.homedir(), '.claude/projects', resolved.replace(/[^a-zA-Z0-9]/g, '-'))
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

async function killGracefully(proc) {
  if (!proc || proc.exitCode != null) return
  return new Promise(resolve => {
    proc.once('exit', () => resolve())
    proc.kill('SIGINT')
    setTimeout(() => { if (proc.exitCode == null) proc.kill('SIGKILL') }, 5000)
  })
}

function spawnApp() {
  const proc = spawn('node', [APP_PATH, '--port', String(PORT), '--no-open'], {
    cwd: BENCH_WS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  proc.stdout.on('data', d => process.stderr.write(`  app[${PORT}] ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`  app[${PORT}]! ${d}`))
  return proc
}

function spawnSim() {
  const proc = spawn(SIM_CMD[0], SIM_CMD.slice(1), {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SIM_CONCURRENT_COUNT: String(SIM_COUNT) },
  })
  proc.stderr.on('data', d => process.stderr.write(`  sim! ${d}`))
  return proc
}

// ─── CPU-profile parser ────────────────────────────────────────────────────
//
// V8 CPU profile shape:
//   { nodes: [{ id, callFrame: {functionName, url, lineNumber, columnNumber, scriptId},
//               hitCount, children?[ids] }],
//     samples: [nodeId, nodeId, ...],
//     timeDeltas: [usFromStart, usDelta, ...],
//     startTime, endTime }
//
// Self time of a node = sum of timeDeltas[i] for samples[i] === node.id.
// Total time = self + sum(total) of children — we walk children explicitly.
//
// For a "what's in the long tasks" report we want:
//   - Top N functions by self time (where time is actually being spent)
//   - For each, the dominant call-stack chain leading to it (parent→child)

function parseCpuProfile(profile) {
  const { nodes, samples, timeDeltas } = profile
  const byId = new Map(nodes.map(n => [n.id, n]))
  // Parent map — V8 profiles store children only.
  const parentOf = new Map()
  for (const n of nodes) {
    if (n.children) for (const c of n.children) parentOf.set(c, n.id)
  }

  // Self-time accumulator per node (microseconds).
  const selfUs = new Map()
  for (const n of nodes) selfUs.set(n.id, 0)
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i]
    const dt = timeDeltas[i] || 0
    selfUs.set(id, (selfUs.get(id) || 0) + dt)
  }

  // Total time per function-key: aggregate samples by signature (function +
  // url + line) so e.g. inlined React internals collapse correctly.
  function keyOf(n) {
    const f = n.callFrame
    const fn = f.functionName || '(anonymous)'
    const url = f.url || ''
    return `${fn} @ ${url}:${f.lineNumber}:${f.columnNumber}`
  }

  const aggSelf = new Map()  // key -> us
  for (const n of nodes) {
    const k = keyOf(n)
    aggSelf.set(k, (aggSelf.get(k) || 0) + (selfUs.get(n.id) || 0))
  }

  // Top-N self-time hot functions.
  const top = [...aggSelf.entries()]
    .filter(([, us]) => us > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)

  // For each of the top 10, surface the dominant ancestor chain — pick the
  // node instance with the most self-time for that key, then walk parents.
  function topInstance(key) {
    let best = null, bestUs = -1
    for (const n of nodes) {
      if (keyOf(n) !== key) continue
      const us = selfUs.get(n.id) || 0
      if (us > bestUs) { best = n; bestUs = us }
    }
    return best
  }
  function ancestorChain(node) {
    const chain = []
    let cur = node
    while (cur) {
      chain.unshift(keyOf(cur))
      const pid = parentOf.get(cur.id)
      cur = pid != null ? byId.get(pid) : null
    }
    return chain
  }

  const totalUs = (timeDeltas || []).reduce((a, b) => a + b, 0)
  const stacks = top.slice(0, 10).map(([key, us]) => ({
    key,
    selfUs: us,
    selfPct: totalUs > 0 ? (us / totalUs) * 100 : 0,
    chain: ancestorChain(topInstance(key)),
  }))

  return { totalUs, top, stacks }
}

function fmtMs(us) { return (us / 1000).toFixed(1) + 'ms' }
function fmtSec(us) { return (us / 1e6).toFixed(2) + 's' }

function writeReport(parsed, longTasks, meta) {
  const { totalUs, top, stacks } = parsed
  const lines = []
  lines.push(`# Long-task profile — ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  lines.push('')
  lines.push(`- Stack: HEAD (\`${meta.commit}\`)`)
  lines.push(`- CPU throttle: ${meta.throttle}×`)
  lines.push(`- Warmup: ${meta.warmupMs / 1000}s · Measurement: ${meta.measureMs / 1000}s`)
  lines.push(`- Sim: \`concurrent\` scenario, ${SIM_COUNT} sessions`)
  lines.push(`- CPU profile sampling interval: ${SAMPLE_INTERVAL_US}us`)
  lines.push(`- Total profiled CPU time: ${fmtSec(totalUs)}`)
  lines.push('')
  lines.push(`## Long tasks observed (PerformanceObserver, main thread)`)
  lines.push('')
  if (longTasks.length === 0) {
    lines.push('_No long tasks recorded._')
  } else {
    const total = longTasks.reduce((a, b) => a + b.duration, 0)
    const max = longTasks.reduce((a, b) => Math.max(a, b.duration), 0)
    const histo = (() => {
      const buckets = [50, 100, 200, 500, 1000, 5000]
      const counts = buckets.map(() => 0)
      let over = 0
      for (const t of longTasks) {
        let placed = false
        for (let i = 0; i < buckets.length; i++) {
          if (t.duration < buckets[i]) { counts[i]++; placed = true; break }
        }
        if (!placed) over++
      }
      const rows = []
      let prev = 0
      for (let i = 0; i < buckets.length; i++) {
        rows.push(`| ${prev}–${buckets[i]}ms | ${counts[i]} |`)
        prev = buckets[i]
      }
      rows.push(`| ≥${buckets[buckets.length - 1]}ms | ${over} |`)
      return rows
    })()
    lines.push(`- Count: **${longTasks.length}**, total blocking: **${(total / 1000).toFixed(1)}s**, longest: **${max.toFixed(0)}ms**`)
    lines.push('')
    lines.push('| duration | count |')
    lines.push('|---|---|')
    lines.push(...histo)
  }
  lines.push('')
  lines.push(`## Top 25 functions by self time (CPU profile)`)
  lines.push('')
  lines.push('| rank | self time | self % | function |')
  lines.push('|---|---|---|---|')
  for (let i = 0; i < top.length; i++) {
    const [key, us] = top[i]
    const pct = totalUs > 0 ? (us / totalUs) * 100 : 0
    lines.push(`| ${i + 1} | ${fmtMs(us)} | ${pct.toFixed(1)}% | \`${key}\` |`)
  }
  lines.push('')
  lines.push(`## Top 10 hot paths — call stacks`)
  lines.push('')
  for (let i = 0; i < stacks.length; i++) {
    const s = stacks[i]
    lines.push(`### ${i + 1}. \`${s.key}\` — ${fmtMs(s.selfUs)} self (${s.selfPct.toFixed(1)}%)`)
    lines.push('')
    lines.push('```')
    for (let j = 0; j < s.chain.length; j++) {
      lines.push('  '.repeat(j) + '↳ ' + s.chain[j])
    }
    lines.push('```')
    lines.push('')
  }
  return lines.join('\n')
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  if (!fs.existsSync(APP_PATH)) {
    console.error(`Built app not found at ${APP_PATH}. Run: pnpm run build:app`)
    process.exit(2)
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  rmrf(encodedWorkspaceDir(BENCH_WS))
  rmrf(path.join(BENCH_WS, '.sim-sessions'))
  fs.mkdirSync(BENCH_WS, { recursive: true })

  const commit = (() => {
    try { return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim() }
    catch { return 'unknown' }
  })()

  log(`config: throttle=${THROTTLE}× warmup=${WARMUP_MS}ms measure=${MEASURE_MS}ms commit=${commit}`)
  log(`booting app on :${PORT}`)
  const app = spawnApp()
  await waitForServer(`http://127.0.0.1:${PORT}/`)

  const sim = spawnSim()
  await sleep(2000)

  const browser = await chromium.launch({
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
      '--disable-features=CalculateNativeWinOcclusion',
      '--enable-precise-memory-info',
    ],
  })

  let report = null
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await ctx.addInitScript({ path: INSTRUMENTATION_PATH })
    if (NO_BLOOM) {
      await ctx.addInitScript({
        content: `try { localStorage.setItem('agent-flow:effects:v1', JSON.stringify({bloom:false,particles:true,bubbles:true,backgroundParticles:true})); } catch {}`,
      })
    }
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })

    // Reveal sim sessions. The visualizer hides new workspaces by default;
    // the top-bar button reads "Workspaces" (none) or "Workspaces (V/T)"
    // when at least one workspace is known. We poll for the V/T form (so
    // we know the sim has produced events the UI knows about), then click
    // "show all" inside the popover.
    log('waiting for sim sessions to appear in UI…')
    try {
      const wsButton = page.getByText(/Workspaces \(\d+\/\d+\)/).first()
      await wsButton.waitFor({ state: 'visible', timeout: 20_000 })
      await wsButton.click({ timeout: 2_000 })
      const showAll = page.getByText('show all', { exact: true }).first()
      await showAll.waitFor({ state: 'visible', timeout: 2_000 })
      await showAll.click()
      await page.keyboard.press('Escape')
      await sleep(500)
      log('workspaces revealed')
    } catch (e) {
      throw new Error(`failed to reveal workspaces: ${e.message}`)
    }

    log(`warming up for ${WARMUP_MS / 1000}s`)
    await sleep(WARMUP_MS)

    const diag = await page.evaluate(() => ({
      canvases: document.querySelectorAll('canvas').length,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 0,
    }))
    log(`diag: canvases=${diag.canvases} heap=${diag.heap}MB`)
    if (diag.canvases === 0) throw new Error('no canvases mounted — sim/workspace setup failed')

    if (THROTTLE > 1) {
      log(`applying ${THROTTLE}× CPU throttle`)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE })
    }

    log('starting CPU profiler + bench instrumentation')
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: SAMPLE_INTERVAL_US })
    await cdp.send('Profiler.start')
    await page.evaluate(() => window.__bench.start())

    log(`measuring for ${MEASURE_MS / 1000}s`)
    await sleep(MEASURE_MS)

    log('stopping profiler')
    const { profile } = await cdp.send('Profiler.stop')
    const summary = await page.evaluate(() => {
      window.__bench.stop()
      return { summary: window.__bench.summary(), longTasks: window.__bench.raw().longTasks }
    })

    if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    log(`fps=${summary.summary.fpsMean.toFixed(1)} longTasks=${summary.summary.longTasks.count}/${Math.round(summary.summary.longTasks.totalMs)}ms`)

    // Write raw cpuprofile (DevTools-loadable) and our parsed report.
    const cpuPath = path.join(RESULTS_DIR, `long-tasks-profile${SUFFIX}.cpuprofile`)
    fs.writeFileSync(cpuPath, JSON.stringify(profile))
    log(`wrote ${cpuPath} (${(fs.statSync(cpuPath).size / 1e6).toFixed(1)} MB)`)

    const summaryPath = path.join(RESULTS_DIR, `long-tasks-summary${SUFFIX}.json`)
    fs.writeFileSync(summaryPath, JSON.stringify({
      meta: { commit, throttle: THROTTLE, warmupMs: WARMUP_MS, measureMs: MEASURE_MS, simCount: SIM_COUNT, bloom: !NO_BLOOM },
      bench: summary.summary,
    }, null, 2))
    log(`wrote ${summaryPath}`)

    log('parsing CPU profile')
    const parsed = parseCpuProfile(profile)
    report = writeReport(parsed, summary.longTasks, {
      commit, throttle: THROTTLE, warmupMs: WARMUP_MS, measureMs: MEASURE_MS,
    })
    const reportPath = path.join(RESULTS_DIR, `long-tasks-report${SUFFIX}.md`)
    fs.writeFileSync(reportPath, report)
    log(`wrote ${reportPath}`)

    await page.close()
    await ctx.close()
  } finally {
    await browser.close()
    await killGracefully(sim)
    await killGracefully(app)
    rmrf(encodedWorkspaceDir(BENCH_WS))
    rmrf(path.join(BENCH_WS, '.sim-sessions'))
  }

  log('done')
}

run().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
