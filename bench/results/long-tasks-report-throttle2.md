# Long-task profile — 2026-05-02 23:05:45

- Stack: HEAD (`c80e5d8`)
- CPU throttle: 4×
- Warmup: 30s · Measurement: 90s
- Sim: `concurrent` scenario, 3 sessions
- CPU profile sampling interval: 1000us
- Total profiled CPU time: 90.29s

## Long tasks observed (PerformanceObserver, main thread)

- Count: **1155**, total blocking: **80.2s**, longest: **120ms**

| duration | count |
|---|---|
| 0–50ms | 0 |
| 50–100ms | 1139 |
| 100–200ms | 16 |
| 200–500ms | 0 |
| 500–1000ms | 0 |
| 1000–5000ms | 0 |
| ≥5000ms | 0 |

## Top 25 functions by self time (CPU profile)

| rank | self time | self % | function |
|---|---|---|---|
| 1 | 37576.3ms | 41.6% | `(program) @ :-1:-1` |
| 2 | 27987.1ms | 31.0% | `drawImage @ :-1:-1` |
| 3 | 2061.3ms | 2.3% | `closePath @ :-1:-1` |
| 4 | 2008.3ms | 2.2% | `fillText @ :-1:-1` |
| 5 | 968.4ms | 1.1% | `_i @ http://127.0.0.1:7150/index.js:37:4033` |
| 6 | 963.0ms | 1.1% | `mr @ http://127.0.0.1:7150/index.js:36:60986` |
| 7 | 733.3ms | 0.8% | `nr @ http://127.0.0.1:7150/index.js:36:58529` |
| 8 | 722.3ms | 0.8% | `fill @ :-1:-1` |
| 9 | 686.2ms | 0.8% | `qr @ http://127.0.0.1:7150/index.js:36:72362` |
| 10 | 630.3ms | 0.7% | `getContext @ :-1:-1` |
| 11 | 585.4ms | 0.6% | `(idle) @ :-1:-1` |
| 12 | 543.8ms | 0.6% | `t @ http://127.0.0.1:7150/index.js:1016:15713` |
| 13 | 526.0ms | 0.6% | `(garbage collector) @ :-1:-1` |
| 14 | 499.3ms | 0.6% | `clearRect @ :-1:-1` |
| 15 | 464.0ms | 0.5% | `yr @ http://127.0.0.1:7150/index.js:36:61213` |
| 16 | 393.4ms | 0.4% | `ei @ http://127.0.0.1:7150/index.js:36:74986` |
| 17 | 367.8ms | 0.4% | `ar @ http://127.0.0.1:7150/index.js:36:59143` |
| 18 | 336.2ms | 0.4% | `Gt @ http://127.0.0.1:7150/index.js:7:10593` |
| 19 | 321.3ms | 0.4% | `(anonymous) @ http://127.0.0.1:7150/index.js:40:12838` |
| 20 | 250.8ms | 0.3% | `zs @ http://127.0.0.1:7150/index.js:7:64088` |
| 21 | 243.8ms | 0.3% | `stroke @ :-1:-1` |
| 22 | 243.2ms | 0.3% | `Wt @ http://127.0.0.1:7150/index.js:7:10341` |
| 23 | 242.7ms | 0.3% | `removeChild @ :-1:-1` |
| 24 | 234.0ms | 0.3% | `fl @ http://127.0.0.1:7150/index.js:7:100095` |
| 25 | 229.7ms | 0.3% | `(anonymous) @ http://127.0.0.1:7150/index.js:36:73861` |

## Top 10 hot paths — call stacks

### 1. `(program) @ :-1:-1` — 37576.3ms self (41.6%)

```
↳ (root) @ :-1:-1
  ↳ (program) @ :-1:-1
```

### 2. `drawImage @ :-1:-1` — 27987.1ms self (31.0%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ apply @ http://127.0.0.1:7150/index.js:36:56496
        ↳ drawImage @ :-1:-1
```

### 3. `closePath @ :-1:-1` — 2061.3ms self (2.3%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ nr @ http://127.0.0.1:7150/index.js:36:58529
        ↳ $n @ http://127.0.0.1:7150/index.js:36:57759
          ↳ ar @ http://127.0.0.1:7150/index.js:36:59143
            ↳ closePath @ :-1:-1
```

### 4. `fillText @ :-1:-1` — 2008.3ms self (2.2%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ Qr @ http://127.0.0.1:7150/index.js:36:74198
        ↳ qr @ http://127.0.0.1:7150/index.js:36:72362
          ↳ fillText @ :-1:-1
```

### 5. `_i @ http://127.0.0.1:7150/index.js:37:4033` — 968.4ms self (1.1%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ _i @ http://127.0.0.1:7150/index.js:37:4033
```

### 6. `mr @ http://127.0.0.1:7150/index.js:36:60986` — 963.0ms self (1.1%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ _i @ http://127.0.0.1:7150/index.js:37:4033
        ↳ Or @ http://127.0.0.1:7150/index.js:36:62987
          ↳ mr @ http://127.0.0.1:7150/index.js:36:60986
```

### 7. `nr @ http://127.0.0.1:7150/index.js:36:58529` — 733.3ms self (0.8%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ nr @ http://127.0.0.1:7150/index.js:36:58529
```

### 8. `fill @ :-1:-1` — 722.3ms self (0.8%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ nr @ http://127.0.0.1:7150/index.js:36:58529
        ↳ fill @ :-1:-1
```

### 9. `qr @ http://127.0.0.1:7150/index.js:36:72362` — 686.2ms self (0.8%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ Qr @ http://127.0.0.1:7150/index.js:36:74198
        ↳ qr @ http://127.0.0.1:7150/index.js:36:72362
```

### 10. `getContext @ :-1:-1` — 630.3ms self (0.7%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ Qr @ http://127.0.0.1:7150/index.js:36:74198
        ↳ Zr @ http://127.0.0.1:7150/index.js:36:73708
          ↳ Tr @ http://127.0.0.1:7150/index.js:36:62388
            ↳ getContext @ :-1:-1
```
