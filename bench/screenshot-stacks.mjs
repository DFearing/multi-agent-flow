#!/usr/bin/env node
/**
 * One-shot visual smoke test for the bench stacks.
 *
 * Boots each app build sibling worktree (baseline-tree, pr1-tree, pr31-tree),
 * runs the `concurrent` sim against it, opens the visualizer in headless
 * Chromium, lets it settle, and writes a PNG so a human can eyeball that the
 * stack is rendering what they expect (canvases populated, agents flowing).
 *
 * This is NOT a measurement script — no metrics are recorded. It exists to
 * back issue-37-style "is the harness wired up correctly?" questions.
 *
 * Usage:
 *   node bench/screenshot-stacks.mjs                 # all stacks
 *   node bench/screenshot-stacks.mjs --stack A-base  # one stack
 *   node bench/screenshot-stacks.mjs --settle 30     # custom settle (seconds)
 *
 * Output: bench/results/screenshots/<stack-id>-<UTC-timestamp>.png
 */

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as http from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BENCH_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(BENCH_DIR, '..')        // .../source
const WORKTREE_ROOT = path.resolve(REPO_ROOT, '..')    // .../instance_2_source
const BENCH_WS = '/tmp/agent-flow-bench'
const SHOTS_DIR = path.join(BENCH_DIR, 'results', 'screenshots')

const STACKS = [
  { id: 'A-base',  label: 'Baseline (59ccf4e)',   appPath: `${WORKTREE_ROOT}/baseline-tree/app/dist/app.js` },
  { id: 'C-pr1',   label: 'PR 1 head (f5d9976)',  appPath: `${WORKTREE_ROOT}/pr1-tree/app/dist/app.js` },
  { id: 'D-pr31',  label: 'PR 31 head (df3bd94)', appPath: `${WORKTREE_ROOT}/pr31-tree/app/dist/app.js` },
]

const PORT = 7100
const SIM_COUNT = 3

let SETTLE_MS = 15_000
let STACK_FILTER = null

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--stack')  STACK_FILTER = process.argv[++i]
  else if (a === '--settle') SETTLE_MS = Number(process.argv[++i]) * 1000
  else if (a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 18).join('\n')); process.exit(0) }
}

const now = () => new Date().toISOString().slice(11, 19)
const log = (...a) => console.log(`[${now()}]`, ...a)

// Mirrors runner.ts encodeWorkspace — strips the leaked symlink dir between reps.
function encodedWorkspaceDir(ws) {
  let resolved = path.resolve(ws)
  try { resolved = fs.realpathSync(resolved) } catch {}
  return path.join(os.homedir(), '.claude/projects', resolved.replace(/[^a-zA-Z0-9]/g, '-'))
}

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }) } catch {} }

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

function spawnApp(appPath) {
  const proc = spawn('node', [appPath, '--port', String(PORT), '--no-open'], {
    cwd: BENCH_WS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  proc.stdout.on('data', d => process.stderr.write(`  app ${d}`))
  proc.stderr.on('data', d => process.stderr.write(`  app! ${d}`))
  return proc
}

function spawnSim() {
  const proc = spawn('pnpm', ['--silent', 'sim', 'concurrent', '--workspace', BENCH_WS], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SIM_CONCURRENT_COUNT: String(SIM_COUNT) },
  })
  proc.stderr.on('data', d => process.stderr.write(`  sim! ${d}`))
  return proc
}

async function killGracefully(proc) {
  if (!proc || proc.exitCode != null) return
  return new Promise(resolve => {
    proc.once('exit', resolve)
    proc.kill('SIGINT')
    setTimeout(() => { if (proc.exitCode == null) proc.kill('SIGKILL') }, 5000)
  })
}

async function captureStack(stack, browser) {
  rmrf(encodedWorkspaceDir(BENCH_WS))
  rmrf(path.join(BENCH_WS, '.sim-sessions'))
  fs.mkdirSync(BENCH_WS, { recursive: true })

  log(`>>> ${stack.id} (${stack.label}) — booting app`)
  const app = spawnApp(stack.appPath)
  await waitForServer(`http://127.0.0.1:${PORT}/`)

  const sim = spawnSim()
  await sleep(2000)

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' })

  // Stacks with the workspace filter (PR 1+) default unseen workspaces to hidden.
  // Click through the "show all" affordance so the bench workspace renders.
  // Older stacks lack this UI — locator returns 0 and we skip silently.
  try {
    const wsButton = page.getByText(/Workspaces \(\d+ hidden\)/).first()
    await wsButton.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
    if (await wsButton.count() > 0) {
      await wsButton.click({ timeout: 2_000 })
      const showAll = page.getByText('show all', { exact: true }).first()
      await showAll.waitFor({ state: 'visible', timeout: 2_000 })
      await showAll.click()
      // Escape and clicking neutral area both fail to dismiss the popover reliably.
      // Click the Workspaces button itself again to toggle it shut. Its label loses
      // the "(N hidden)" suffix once nothing is hidden.
      await sleep(200)
      const wsToggleClose = page.getByRole('button', { name: /^Workspaces($| \(\d+ hidden\))/ }).first()
      if (await wsToggleClose.count() > 0) {
        await wsToggleClose.click({ timeout: 2_000 })
      }
      await sleep(500)
    }
  } catch (e) {
    log(`    workspace-show-all skipped: ${e.message}`)
  }

  // Close the Messages panel so the canvases get the full viewport.
  // Only present on PR 1+ — baseline has no such toggle, so the locator no-ops.
  try {
    const msgBtn = page.getByRole('button', { name: 'Messages', exact: true }).first()
    if (await msgBtn.count() > 0) {
      await msgBtn.click({ timeout: 2_000 })
      await sleep(300)
    }
  } catch (e) {
    log(`    messages-close skipped: ${e.message}`)
  }

  // Tile canvases horizontally so they sit side-by-side instead of stacking.
  // Only present on PR 31+ (commit 5018818). Earlier stacks no-op.
  try {
    const tileBtn = page.locator('button:has([title="Tile open windows horizontally (side by side)"])').first()
    if (await tileBtn.count() > 0) {
      await tileBtn.click({ timeout: 2_000 })
      await sleep(500)
    }
  } catch (e) {
    log(`    tile-horizontal skipped: ${e.message}`)
  }

  log(`    settling ${SETTLE_MS / 1000}s for events to populate the canvas`)
  await sleep(SETTLE_MS)

  const diag = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    bodyText: (document.body.innerText || '').slice(0, 200).replace(/\n/g, ' | '),
  }))
  log(`    diag: canvases=${diag.canvases} body="${diag.bodyText}"`)

  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.join(SHOTS_DIR, `${stack.id}-${stamp}.png`)
  await page.screenshot({ path: outPath, fullPage: true })
  log(`    wrote ${outPath}`)

  await page.close()
  await ctx.close()
  await killGracefully(sim)
  await killGracefully(app)

  rmrf(encodedWorkspaceDir(BENCH_WS))
  rmrf(path.join(BENCH_WS, '.sim-sessions'))
  await sleep(1000)

  return { stack: stack.id, outPath, canvases: diag.canvases }
}

async function main() {
  const stacks = STACK_FILTER ? STACKS.filter(s => s.id === STACK_FILTER) : STACKS
  if (stacks.length === 0) {
    console.error(`No stacks matched --stack ${STACK_FILTER}. Known: ${STACKS.map(s => s.id).join(', ')}`)
    process.exit(2)
  }
  for (const s of stacks) {
    if (!fs.existsSync(s.appPath)) {
      console.error(`SKIP ${s.id}: app build missing at ${s.appPath}`)
      continue
    }
  }

  // Headless Chromium with the same flags the bench harness uses for FPS / heap fidelity.
  // Not strictly needed for screenshots, but keeps the page environment identical.
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-frame-rate-limit', '--disable-gpu-vsync', '--enable-precise-memory-info'],
  })

  const results = []
  try {
    for (const stack of stacks) {
      if (!fs.existsSync(stack.appPath)) continue
      try {
        results.push(await captureStack(stack, browser))
      } catch (e) {
        log(`    ERROR on ${stack.id}: ${e.message}`)
      }
    }
  } finally {
    await browser.close()
  }

  log('done.')
  for (const r of results) log(`  ${r.stack}: canvases=${r.canvases} → ${r.outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
