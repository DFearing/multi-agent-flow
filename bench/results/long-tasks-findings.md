# Long-task profile findings — issue #46 direction item 1

**Date:** 2026-05-02
**Stack:** main (`98df60b`)
**Workload:** `concurrent` sim, 3 sessions, 4× CPU throttle, 30s warmup + 90s measurement
**Renderer:** Canvas2D (default — see methodology note below)
**Outputs:** `long-tasks-profile.cpuprofile` (loadable in Chrome DevTools), `long-tasks-report.md` (parsed top hot paths), `long-tasks-summary.json`

## Bench-level numbers reproduce #46

| metric | issue #46 (main) | this run |
|---|---|---|
| FPS @ 4× | 11.5 | 9.5 |
| long-task total | ~80.9s / 90s window | 79.8s / 90s window |
| long-task count | (not reported) | 861 (74% in 50–100ms bucket, 25% in 100–200ms) |

Different rep, slightly noisier; same regime. Confirms the issue's framing: the main thread is blocked ~89% of wall time.

## Top hot paths

| rank | self time | % of CPU | function | code location |
|---|---|---|---|---|
| 1 | **44.8s** | **49.5%** | `drawImage` (V8 builtin) | called from `BloomRenderer.apply` |
| 2 | 19.3s | 21.4% | `(program)` (V8 internal — GC, deopts, parse, etc.) | _unattributable without v8 trace_ |
| 3 | 3.1s | 3.4% | `fillText` (V8 builtin) | called from agent/tool/bubble label draws |
| 4 | 2.2s | 2.4% | virtualized-list `measureRef` callback | `web/hooks/use-virtual-list.ts:132` |
| 5 | 1.5s | 1.7% | `closePath` (V8 builtin) | called from hex-grid draw |

(Plus `fill` 0.6%, `stroke` 0.3%, `clearRect` 0.3%, `removeChild` 0.3% — the long tail.)

### Where drawImage time actually goes

A breakdown of `drawImage`'s 44.8s by immediate caller (via `bench/breakdown-by-caller.mjs`):

| caller | time | share of drawImage |
|---|---|---|
| `BloomRenderer.apply` (`web/components/agent-visualizer/bloom-renderer.ts`) | 44.1s | **98.5%** |
| Canvas2D scene-layer draws (agents/edges/particles, 4 distinct sites) | 0.7s | 1.5% |

**98.5% of all `drawImage` time is the Canvas2D bloom pass.** The bloom does 4 `drawImage` calls per frame (clearRect + drawImage source → blur via `ctx.filter='blur(12px)'` → drawImage blurred → composite back), each over the full canvas at half resolution.

### Where fillText time goes

Spread across 7 callers (no single hot spot — text is drawn from many layers):
- agent labels ~1.5s (`wr` — `drawAgent`)
- tool/discovery labels ~0.5s (`jr`)
- bubble text ~0.4s (`Jr`)
- token/stat overlays ~0.3s each (`Or`, `Dr`)

## Methodology note: bench measures Canvas2D, not Pixi

`session-canvas-panel.tsx:22` gates the Pixi renderer behind `?renderer=pixi`, an opt-in URL parameter. The bench (`run-bench.mjs`) navigates to the bare URL, so **the bench (and this profile) measures the Canvas2D `AgentCanvas` path, not the Pixi WebGL `PixiCanvas` path**.

Implications for #46's framing:
- The "PR #36 (full Pixi migration) was the inflection point" claim cannot be the Pixi path itself — that path is opt-in and unmeasured. PR #36's wins must come from infrastructure shared by both renderers (sim manager, scene-graph diff, etc.).
- PR #45's multiView and PR #43's visibility gating only affect the Pixi path. Their zero measured impact in the bench is therefore expected — the bench can't see them.
- Of the perf settings shipped in PR #49, only the **frame-rate cap** affects the Canvas2D path; the **bloom toggle** detaches the Pixi bloom filter, not the Canvas2D `BloomRenderer`. The hot-path #1 below is unaddressed by current toggles.

This is itself a finding worth filing separately (already accounted for in the sub-issues below).

## Sub-issues filed

1. **Canvas2D `BloomRenderer` is 49% of all CPU at 4× throttle** — gate, replace, or shrink the bloom pass.
2. **Canvas2D label/text draws (fillText + path primitives) ≈ 6% of CPU** — labels are redrawn per frame; cache to off-screen canvas + invalidate on text change.
3. **Message-feed virtualization `measureRef` thrash ≈ 2.4% of CPU** — `ResizeObserver`-style measure callback drives a re-render every time an item's offsetHeight changes; batch and short-circuit.

Each is linked back to #46.

## Verification (2026-05-02, after PR #61 ship)

PR #61 added a user-visible bloom on/off toggle. Re-ran the bench A/B at commit `3f2f4ac` (current main) with the existing harness modified to seed `localStorage` and force `effects.bloom=false` for the OFF arm.

| metric | bloom ON | bloom OFF | Δ |
|---|---|---|---|
| FPS mean | 11.7 | 17.9 | **+53%** |
| frame mean | 85.5 ms | 55.7 ms | −35% |
| frame p95 | 115 ms | 83 ms | −28% |
| **long-task total** | **81.9s** | **40.6s** | **−50%** |
| long-task count | 1054 | 698 | −34% |
| React commits | 1368 | 1517 | +11% (more frames → more commits) |

**The 49.5% bloom finding above was correct.** Removing the bloom pass recovers ~41 of every 90 seconds of blocked main-thread time, almost exactly matching the profile's prediction. This vindicates the broader profile attribution and the open Canvas2D follow-up PRs (#62 hex-grid cache, #63 text/overlay caches) targeting the next-largest hot paths.

Reproducer artifacts:
- `bench/results/long-tasks-summary.json` (bloom ON)
- `bench/results/long-tasks-summary-no-bloom.json` (bloom OFF)
- `bench/results/long-tasks-profile-no-bloom.cpuprofile` (DevTools-loadable)
- Run with: `node bench/profile-long-tasks.mjs --no-bloom`

### Why a manual test in the dev server may not show this

The bench drives 3 concurrent sim sessions under `concurrent` workload at 4× CPU throttle. With 1 canvas / 1 idle session at native CPU speed, bloom's per-frame cost (~2-3ms) is invisible inside a 16.7ms frame budget. Also, Chrome DevTools' built-in FPS meter measures compositor frames, not the canvas's `requestAnimationFrame` rate — they diverge under throttle. Use the `?perf` overlay (in-canvas FPS counter) and 3 sim sessions to reproduce manually.

## Final comparison after all Canvas2D PRs (2026-05-02, commit `c80e5d8`)

After merging the bloom toggle (#61), hex-grid cache (#62), text/overlay caches (#63), measureRef stabilization (#60), and bloom throttle (#65). 4× CPU throttle, 3 sim sessions, 30s + 90s.

| Configuration | FPS | Long-task total | Frame p95 | React commits |
|---|---|---|---|---|
| **PR 56 baseline** (98df60b, before any opts) | 9.5 | 79.8s | ~150ms | 3048 |
| Pre-Canvas2D PRs (3f2f4ac: only #58 + #61) | 11.7 | 81.9s | 115ms | 1368 |
| Current main, defaults (bloom on, throttle 1) | 11.9 | 82.0s | 112ms | 1250 |
| Current main, bloom throttle=2 | **13.1** | 80.2s | 103ms | 1305 |
| Current main, bloom OFF | **17.9** | **41.4s** | **83ms** | 1349 |

### What materialized

- **PR #58 (React shared-ticker + memo)**: 3048 → 1368 commits (**−55%**), persisted through subsequent PRs. Real win.
- **PR #65 (bloom throttle=2)**: defaults 11.9 → 13.1 FPS (**+10%**) with the visual still present. Real, user-opt-in.
- **PR #61 (bloom toggle OFF)**: defaults 11.9 → 17.9 FPS (**+50%**), long-tasks 82s → 41s (**−50%**). Real, user-opt-in.

### What did NOT materialize at the bench level

- **PR #62 (hex-grid offscreen cache) + PR #63 (text/overlay caches)**: stack 3f2f4ac (11.7 FPS, 81.9s) → current main (11.9 FPS, 82.0s) is noise-level. The combined ~5% predicted CPU savings from `fillText`/`closePath` self-time did not translate to wall-clock improvement at 4× throttle. See investigation in [TODO: link to follow-up issue] for hypothesis & evidence.

### Reproducer

```bash
node bench/profile-long-tasks.mjs                      # bloom on, throttle 1 (default)
node bench/profile-long-tasks.mjs --bloom-throttle=2   # bloom on, throttle 2
node bench/profile-long-tasks.mjs --no-bloom           # bloom disabled
```

Outputs land in `bench/results/long-tasks-{summary,profile,report}{,-no-bloom,-throttle2}.{json,cpuprofile,md}`.

## What remains unattributed

- **21.4% in `(program)`** — V8's catch-all bucket. Almost certainly some mix of GC pauses, deoptimizations, and JIT compile/parse. To attribute, a future pass needs CDP `Tracing.start` with `disabled-by-default-v8.cpu_profiler` + `v8.runtime` categories (much more invasive than `Profiler.start`). Filing as a follow-up rather than a third hot-path issue because there's no actionable code change yet.

## How to reproduce

```bash
cd source
pnpm run build:app
cd bench && pnpm install --ignore-workspace && pnpx playwright install chromium
node profile-long-tasks.mjs                  # 30s warmup + 90s measure, 4× throttle
node profile-long-tasks.mjs --smoke          # quick verify (15s + 30s)
node breakdown-by-caller.mjs results/long-tasks-profile.cpuprofile drawImage
```

Outputs land in `bench/results/long-tasks-*.{cpuprofile,md,json}`. The `.cpuprofile` opens directly in Chrome DevTools → Performance → Load profile.
