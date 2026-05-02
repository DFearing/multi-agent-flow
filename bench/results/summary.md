# Agent Flow perf benchmark — 2026-05-02 12:04:46

Workload: `concurrent` scenario, N concurrent sessions × 3 subagents/round, continuous
Warmup: 30s · Measurement window: 90s · Reps: 5/cell
Browser: Chromium headless · Viewport: 1440×900

## 1 session · CPU throttle 1×

(both stacks render 1 canvas — apples-to-apples)

| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |
|---|---|---|---|---|---|---|---|---|---|
| Baseline (59ccf4e) | 5 | 45.3 (±1.5) | 26.9 (±1.5) | 32.2 | 0.0 | 0 | 72942 | 21.7 | 260 |
| PR 1 head (f5d9976) | 5 | 196.6 (±3.3) | 7.1 (±0.2) | 9.4 | 0.0 | 0 | 61826 | 35.3 | 606 |

**Deltas (1×, 1 session):**
- A → C (baseline → PR 1):       FPS 334.2%, p95 -73.5%, longtasks NaN%, scripting -15.2%

## 1 session · CPU throttle 4×

(both stacks render 1 canvas — apples-to-apples)

| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |
|---|---|---|---|---|---|---|---|---|---|
| Baseline (59ccf4e) | 5 | 10.3 (±0.2) | 115.9 (±2.7) | 126.1 | 932.8 | 87581 | 72679 | 13.8 | 249 |
| PR 1 head (f5d9976) | 5 | 38.6 (±0.7) | 41.6 (±1.3) | 49.4 | 1.2 | 72 | 66793 | 40.6 | 547 |

**Deltas (4×, 1 session):**
- A → C (baseline → PR 1):       FPS 273.9%, p95 -64.1%, longtasks -99.9%, scripting -8.1%

## 3 sessions · CPU throttle 1×

(baseline shows 1 canvas at a time; PR 1 shows 3, so PR 1 is doing 3× the rendering work)

| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |
|---|---|---|---|---|---|---|---|---|---|
| Baseline (59ccf4e) | 5 | 45.6 (±0.6) | 26.0 (±0.5) | 29.0 | 0.0 | 0 | 72682 | 21.5 | 329 |
| PR 1 head (f5d9976) | 5 | 54.4 (±1.4) | 34.4 (±0.1) | 35.3 | 0.0 | 0 | 67867 | 41.4 | 1090 |
| PR 31 head (df3bd94) | 5 | 65.4 (±0.7) | 32.1 (±0.3) | 34.5 | 0.0 | 0 | 66973 | 43.2 | 3585 |

**Deltas (1×, 3 sessions):**
- A → C (baseline → PR 1):       FPS 19.4%, p95 32.5%, longtasks NaN%, scripting -6.6%
- C → D (PR 1 → PR 31):          FPS 20.1%, p95 -6.6%, longtasks NaN%, scripting -1.3%
- A → D (baseline → PR 31):      FPS 43.4%, p95 23.7%, longtasks NaN%, scripting -7.9%

## 3 sessions · CPU throttle 4×

(baseline shows 1 canvas at a time; PR 1 shows 3, so PR 1 is doing 3× the rendering work)

| stack | n | FPS (sd) | frame p95 ms (sd) | frame p99 ms | longtasks # | longtask total ms | scripting ms | heap peak MB | React commits |
|---|---|---|---|---|---|---|---|---|---|
| Baseline (59ccf4e) | 5 | 9.0 (±0.3) | 133.4 (±4.7) | 144.6 | 816.2 | 87219 | 73339 | 13.5 | 282 |
| PR 1 head (f5d9976) | 5 | 9.4 (±0.3) | 138.6 (±7.3) | 168.0 | 859.4 | 80681 | 68485 | 42.7 | 719 |
| PR 31 head (df3bd94) | 5 | 11.7 (±0.3) | 115.3 (±2.9) | 137.0 | 1056.6 | 80681 | 67417 | 43.2 | 3082 |

**Deltas (4×, 3 sessions):**
- A → C (baseline → PR 1):       FPS 4.9%, p95 3.9%, longtasks -7.5%, scripting -6.6%
- C → D (PR 1 → PR 31):          FPS 23.7%, p95 -16.8%, longtasks 0.0%, scripting -1.6%
- A → D (baseline → PR 31):      FPS 29.7%, p95 -13.5%, longtasks -7.5%, scripting -8.1%
