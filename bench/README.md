# Agent Flow perf benchmark

Empirical A/B/C harness comparing the visualizer's render performance across
checkouts, using a deterministic simulator workload and headless Chromium with
CDP perf instrumentation.

## What it measures

For each `(stack, throttle, rep)` cell, browser-side metrics over a
fixed measurement window:

- **FPS mean** — frame count / wall time
- **Frame time** p50, p95, p99 — from `requestAnimationFrame` deltas
- **Long tasks** — `PerformanceObserver({type:'longtask'})` count + total blocking time
- **Scripting / task / layout / recalc-style time** — from CDP `Performance.getMetrics`
- **Heap peak / mean** — `performance.memory.usedJSHeapSize` sampled at 1 Hz
  (Chromium launched with `--enable-precise-memory-info` so values aren't rounded to 100 KB)
- **React commits** — counted via the DevTools `onCommitFiberRoot` hook

The Chromium 30-FPS vsync cap is removed via `--disable-frame-rate-limit
--disable-gpu-vsync` so frame-time regressions are visible past the headless ceiling.

## Stacks

Configured in `run-bench.mjs`:

- **A-base** — `../baseline-tree/` at `59ccf4e` (merge-base with upstream `patoles/agent-flow`)
- **B-preperf** — `../preperf-tree/` at `433ef5a` (parent of the first `perf:` commit; new features but no perf work)
- **C-head** — current repo (`source/`)

Each stack must already have:
1. `pnpm install` run
2. `pnpm run build:app` run, producing `app/dist/app.js` + `app/dist/webview/`

To re-create the worktrees from the main repo:

```bash
git worktree add ../baseline-tree 59ccf4e
git worktree add ../preperf-tree 433ef5a
(cd ../baseline-tree && pnpm install && pnpm run build:app)
(cd ../preperf-tree && pnpm install && pnpm run build:app)
pnpm run build:app   # for HEAD
```

## Workload

The `concurrent` sim scenario from `scripts/sim/scenarios.ts`:
3 long-running sessions, each dispatching 3 subagents per round, in continuous
flight. Same JSONL events feed each stack via the standalone app's relay.

## Running

```bash
cd bench
pnpm install
pnpx playwright install chromium

# All three stacks, both throttles, 5 reps each (~60 min)
node run-bench.mjs

# Just the baseline (~22 min)
node run-bench.mjs --stack A-base

# Smoke test (~50s)
node run-bench.mjs --smoke --stack A-base

# Re-aggregate without re-running
node run-bench.mjs --summarize

# Append new runs without truncating runs.jsonl
node run-bench.mjs --append --stack C-head
```

Flags:
- `--stack <id>` — limit to one stack
- `--reps=N` — override rep count
- `--no-throttle` — only 1× CPU
- `--throttle-only` — only 4× CPU
- `--smoke` — short windows for quick verification
- `--append` — keep prior `runs.jsonl` rows
- `--summarize` — re-run aggregation only

## Outputs

- `results/runs.jsonl` — one line per run with raw metrics + CDP snapshot
- `results/summary.md` — aggregated comparison table + deltas

## Caveats

- **Single-machine, real CPU.** Other workloads on the host will inflate frame
  times — keep the box quiet during a run, especially for unthrottled (1×) cells.
- **The simulator only exists on HEAD.** It produces JSONL events the relay
  consumes; that input is identical across stacks.
- **Production builds, not `next dev`.** `pnpm run build:app` produces a single
  Node binary serving the prebuilt webview + relay over one port — no HMR /
  Fast Refresh overhead.
