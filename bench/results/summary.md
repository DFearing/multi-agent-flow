# Agent Flow perf benchmark — 2026-05-02 10:48:03

Workload: `concurrent` scenario (3 sessions × 3 subagents/round, continuous)
Warmup: 30s · Measurement window: 90s · Reps: 5/cell
Browser: Chromium headless · Viewport: 1440×900

## CPU throttle: 1×

| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |
|---|---|---|---|---|---|---|---|---|---|
| Baseline (59ccf4e) | 5 | 45.6 (±0.6) | 26.0 (±0.5) | 29.0 | 0.0 | 0 | 72682 | 21.5 | 329 |
| PR 1 head (f5d9976) | 5 | 54.4 (±1.4) | 34.4 (±0.1) | 35.3 | 0.0 | 0 | 67867 | 41.4 | 1090 |

**Deltas (1×):**
- A → C (net, baseline → PR 1):   FPS 19.4%, p95 32.5%, longtasks NaN%, scripting -6.6%

## CPU throttle: 4×

| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |
|---|---|---|---|---|---|---|---|---|---|
| Baseline (59ccf4e) | 5 | 9.0 (±0.3) | 133.4 (±4.7) | 144.6 | 816.2 | 87219 | 73339 | 13.5 | 282 |
| PR 1 head (f5d9976) | 5 | 9.4 (±0.3) | 138.6 (±7.3) | 168.0 | 859.4 | 80681 | 68485 | 42.7 | 719 |

**Deltas (4×):**
- A → C (net, baseline → PR 1):   FPS 4.9%, p95 3.9%, longtasks -7.5%, scripting -6.6%
