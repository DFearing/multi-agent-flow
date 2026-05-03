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

## Long-task profiler (`profile-long-tasks.mjs`)

Single-stack CPU profile + long-task capture at 4× CPU throttle.
Produces a DevTools-loadable `.cpuprofile`, a parsed hot-path report,
and a JSON summary.

```bash
# Default: 1 rep, 30s warmup + 90s measurement, 4× throttle
node bench/profile-long-tasks.mjs

# Multi-rep with variance reporting (recommended)
node bench/profile-long-tasks.mjs --reps=5

# Quick verify
node bench/profile-long-tasks.mjs --smoke

# Without bloom
node bench/profile-long-tasks.mjs --no-bloom

# Bloom throttle
node bench/profile-long-tasks.mjs --bloom-throttle=2

# Custom timing
node bench/profile-long-tasks.mjs --warmup=10 --measure=15

# No CPU throttle
node bench/profile-long-tasks.mjs --no-throttle
```

Flags:
- `--reps=N` — run N reps back-to-back (default `1`). With N>1, writes per-rep
  summaries (`*-rep1.json` ... `*-repN.json`) and an aggregated summary with
  median/mean/min/max/stdDev for each metric. CPU profile is from the best
  (highest FPS) rep.
- `--smoke` — 15s warmup + 30s measurement
- `--no-bloom` — disable the Canvas2D bloom pass
- `--bloom-throttle=N` — bloom every Nth frame
- `--warmup=S` — warmup in seconds
- `--measure=S` — measurement in seconds
- `--no-throttle` — disable CPU throttle (1×)

### Variance reporting

When `--reps=N` is used with N>1, the harness computes the coefficient of
variation (CoV = stdDev/mean) for FPS. If CoV exceeds 15%, a warning is
printed:

```
⚠ HIGH VARIANCE — CoV=18.2% (threshold: 15%)
System load may be interfering. Consider closing other apps and rerunning.
```

The aggregated JSON includes `variance: { cov, noisy }` for programmatic
consumption.

### Aggregated summary JSON shape (with --reps=N)

```json
{
  "meta": { "commit", "throttle", "warmupMs", "measureMs", "simCount", "bloom", "bloomThrottle", "reps", "bestRep" },
  "system": { "cpuModel", "governor", "loadavg1m", "freeMemMB" },
  "variance": { "cov": 0.042, "noisy": false },
  "fps": { "median", "mean", "min", "max", "stdDev", "values": [...] },
  "frameMs": { "mean": { ... }, "p50": { ... }, "p95": { ... }, "p99": { ... } },
  "longTasks": { "totalMs": { ... }, "count": { ... }, "maxMs": { ... } },
  "reactCommits": { "median", "mean", "min", "max", "stdDev", "values": [...] },
  "scriptingMs": { "median", "mean", "min", "max", "stdDev", "values": [...] }
}
```

## CPU governor helper (`bench/scripts/bench-prep.sh`)

Optional helper that reports system state and can lock the CPU governor to
`performance` mode for reduced variance. Requires `sudo` for governor changes.

```bash
# Report current system state (no sudo needed)
./bench/scripts/bench-prep.sh

# Lock to performance governor (requires sudo)
./bench/scripts/bench-prep.sh --set-performance

# Restore original governor
./bench/scripts/bench-prep.sh --restore
```

### Recommended stable-bench workflow

```bash
./bench/scripts/bench-prep.sh --set-performance
node bench/profile-long-tasks.mjs --reps=5
./bench/scripts/bench-prep.sh --restore
```

## Caveats

- **Single-machine, real CPU.** Other workloads on the host will inflate frame
  times — keep the box quiet during a run, especially for unthrottled (1×) cells.
  Use `--reps=5` and check the CoV to detect noisy runs.
- **CPU governor matters.** The `powersave` governor lets the OS scale frequency
  dynamically, adding variance. Use `bench-prep.sh --set-performance` to lock it.
- **The simulator only exists on HEAD.** It produces JSONL events the relay
  consumes; that input is identical across stacks.
- **Production builds, not `next dev`.** `pnpm run build:app` produces a single
  Node binary serving the prebuilt webview + relay over one port — no HMR /
  Fast Refresh overhead.
