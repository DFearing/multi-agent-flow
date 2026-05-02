# Agent Flow perf benchmark — 2026-05-02 09:53:37

Workload: `concurrent` scenario (3 sessions × 3 subagents/round, continuous)
Warmup: 30s · Measurement window: 90s · Reps: 5/cell
Browser: Chromium headless · Viewport: 1440×900

## CPU throttle: 1×

| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |
|---|---|---|---|---|---|---|---|---|---|
| Baseline (59ccf4e) | 5 | 45.6 (±0.6) | 26.0 (±0.5) | 29.0 | 0.0 | 0 | 72682 | 21.5 | 329 |

_(Only A-base measured at 1× — re-run with another `--stack` to compute deltas.)_

## CPU throttle: 4×

| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |
|---|---|---|---|---|---|---|---|---|---|
| Baseline (59ccf4e) | 5 | 9.0 (±0.3) | 133.4 (±4.7) | 144.6 | 816.2 | 87219 | 73339 | 13.5 | 282 |

_(Only A-base measured at 4× — re-run with another `--stack` to compute deltas.)_
