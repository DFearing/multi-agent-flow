# Long-task profile — 2026-05-02 23:02:55

- Stack: HEAD (`c80e5d8`)
- CPU throttle: 4×
- Warmup: 30s · Measurement: 90s
- Sim: `concurrent` scenario, 3 sessions
- CPU profile sampling interval: 1000us
- Total profiled CPU time: 90.36s

## Long tasks observed (PerformanceObserver, main thread)

- Count: **1078**, total blocking: **82.0s**, longest: **122ms**

| duration | count |
|---|---|
| 0–50ms | 0 |
| 50–100ms | 1041 |
| 100–200ms | 37 |
| 200–500ms | 0 |
| 500–1000ms | 0 |
| 1000–5000ms | 0 |
| ≥5000ms | 0 |

## Top 25 functions by self time (CPU profile)

| rank | self time | self % | function |
|---|---|---|---|
| 1 | 44300.8ms | 49.0% | `drawImage @ :-1:-1` |
| 2 | 22028.5ms | 24.4% | `(program) @ :-1:-1` |
| 3 | 1962.2ms | 2.2% | `closePath @ :-1:-1` |
| 4 | 1892.9ms | 2.1% | `fillText @ :-1:-1` |
| 5 | 891.8ms | 1.0% | `_i @ http://127.0.0.1:7150/index.js:37:4033` |
| 6 | 875.6ms | 1.0% | `mr @ http://127.0.0.1:7150/index.js:36:60986` |
| 7 | 736.7ms | 0.8% | `qr @ http://127.0.0.1:7150/index.js:36:72362` |
| 8 | 699.1ms | 0.8% | `nr @ http://127.0.0.1:7150/index.js:36:58529` |
| 9 | 628.9ms | 0.7% | `fill @ :-1:-1` |
| 10 | 618.2ms | 0.7% | `t @ http://127.0.0.1:7150/index.js:1016:15713` |
| 11 | 560.2ms | 0.6% | `getContext @ :-1:-1` |
| 12 | 538.7ms | 0.6% | `(idle) @ :-1:-1` |
| 13 | 517.6ms | 0.6% | `clearRect @ :-1:-1` |
| 14 | 492.8ms | 0.5% | `(garbage collector) @ :-1:-1` |
| 15 | 464.7ms | 0.5% | `yr @ http://127.0.0.1:7150/index.js:36:61213` |
| 16 | 393.2ms | 0.4% | `ar @ http://127.0.0.1:7150/index.js:36:59143` |
| 17 | 373.9ms | 0.4% | `(anonymous) @ http://127.0.0.1:7150/index.js:40:12838` |
| 18 | 338.2ms | 0.4% | `ei @ http://127.0.0.1:7150/index.js:36:74986` |
| 19 | 309.6ms | 0.3% | `apply @ http://127.0.0.1:7150/index.js:36:56496` |
| 20 | 294.9ms | 0.3% | `Gt @ http://127.0.0.1:7150/index.js:7:10593` |
| 21 | 267.7ms | 0.3% | `Wt @ http://127.0.0.1:7150/index.js:7:10341` |
| 22 | 243.2ms | 0.3% | `Fd @ http://127.0.0.1:7150/index.js:8:7883` |
| 23 | 241.1ms | 0.3% | `fl @ http://127.0.0.1:7150/index.js:7:100095` |
| 24 | 238.5ms | 0.3% | `lineTo @ :-1:-1` |
| 25 | 231.3ms | 0.3% | `removeChild @ :-1:-1` |

## Top 10 hot paths — call stacks

### 1. `drawImage @ :-1:-1` — 44300.8ms self (49.0%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ apply @ http://127.0.0.1:7150/index.js:36:56496
        ↳ drawImage @ :-1:-1
```

### 2. `(program) @ :-1:-1` — 22028.5ms self (24.4%)

```
↳ (root) @ :-1:-1
  ↳ (program) @ :-1:-1
```

### 3. `closePath @ :-1:-1` — 1962.2ms self (2.2%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ nr @ http://127.0.0.1:7150/index.js:36:58529
        ↳ $n @ http://127.0.0.1:7150/index.js:36:57759
          ↳ ar @ http://127.0.0.1:7150/index.js:36:59143
            ↳ closePath @ :-1:-1
```

### 4. `fillText @ :-1:-1` — 1892.9ms self (2.1%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ Qr @ http://127.0.0.1:7150/index.js:36:74198
        ↳ qr @ http://127.0.0.1:7150/index.js:36:72362
          ↳ fillText @ :-1:-1
```

### 5. `_i @ http://127.0.0.1:7150/index.js:37:4033` — 891.8ms self (1.0%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ _i @ http://127.0.0.1:7150/index.js:37:4033
```

### 6. `mr @ http://127.0.0.1:7150/index.js:36:60986` — 875.6ms self (1.0%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ _i @ http://127.0.0.1:7150/index.js:37:4033
        ↳ Or @ http://127.0.0.1:7150/index.js:36:62987
          ↳ mr @ http://127.0.0.1:7150/index.js:36:60986
```

### 7. `qr @ http://127.0.0.1:7150/index.js:36:72362` — 736.7ms self (0.8%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ Qr @ http://127.0.0.1:7150/index.js:36:74198
        ↳ qr @ http://127.0.0.1:7150/index.js:36:72362
```

### 8. `nr @ http://127.0.0.1:7150/index.js:36:58529` — 699.1ms self (0.8%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ nr @ http://127.0.0.1:7150/index.js:36:58529
```

### 9. `fill @ :-1:-1` — 628.9ms self (0.7%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34786
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12838
      ↳ nr @ http://127.0.0.1:7150/index.js:36:58529
        ↳ fill @ :-1:-1
```

### 10. `t @ http://127.0.0.1:7150/index.js:1016:15713` — 618.2ms self (0.7%)

```
↳ (root) @ :-1:-1
  ↳ (anonymous) @ http://127.0.0.1:7150/index.js:7:123450
    ↳ id @ http://127.0.0.1:7150/index.js:7:122032
      ↳ nd @ http://127.0.0.1:7150/index.js:7:121617
        ↳ sd @ http://127.0.0.1:7150/index.js:7:123388
          ↳ mu @ http://127.0.0.1:7150/index.js:7:111233
            ↳ hu @ http://127.0.0.1:7150/index.js:7:112325
              ↳ Pu @ http://127.0.0.1:7150/index.js:7:117104
                ↳ Iu @ http://127.0.0.1:7150/index.js:7:118919
                  ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                    ↳ hl @ http://127.0.0.1:7150/index.js:7:105216
                      ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                        ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                          ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                            ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                              ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                  ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                    ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                      ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                        ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                          ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                            ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                              ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                  ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                    ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                      ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                        ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                          ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                            ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                              ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                                ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                                  ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                                    ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                                      ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                                        ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                                          ↳ el @ http://127.0.0.1:7150/index.js:7:96351
                                                                            ↳ zc @ http://127.0.0.1:7150/index.js:7:92526
                                                                              ↳ t @ http://127.0.0.1:7150/index.js:1016:15713
```
