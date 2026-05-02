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
