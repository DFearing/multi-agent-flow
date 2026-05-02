# Long-task profile — 2026-05-02 22:43:49

- Stack: HEAD (`3f2f4ac`)
- CPU throttle: 4×
- Warmup: 30s · Measurement: 90s
- Sim: `concurrent` scenario, 3 sessions
- CPU profile sampling interval: 1000us
- Total profiled CPU time: 90.28s

## Long tasks observed (PerformanceObserver, main thread)

- Count: **698**, total blocking: **40.6s**, longest: **89ms**

| duration | count |
|---|---|
| 0–50ms | 0 |
| 50–100ms | 698 |
| 100–200ms | 0 |
| 200–500ms | 0 |
| 500–1000ms | 0 |
| 1000–5000ms | 0 |
| ≥5000ms | 0 |

## Top 25 functions by self time (CPU profile)

| rank | self time | self % | function |
|---|---|---|---|
| 1 | 60456.2ms | 67.0% | `(program) @ :-1:-1` |
| 2 | 3866.4ms | 4.3% | `fillText @ :-1:-1` |
| 3 | 3172.5ms | 3.5% | `closePath @ :-1:-1` |
| 4 | 1843.5ms | 2.0% | `(anonymous) @ http://127.0.0.1:7150/index.js:1016:15504` |
| 5 | 1192.0ms | 1.3% | `ei @ http://127.0.0.1:7150/index.js:37:4029` |
| 6 | 1031.1ms | 1.1% | `ur @ http://127.0.0.1:7150/index.js:36:59985` |
| 7 | 869.7ms | 1.0% | `drawImage @ :-1:-1` |
| 8 | 853.2ms | 0.9% | `Qn @ http://127.0.0.1:7150/index.js:36:57557` |
| 9 | 813.2ms | 0.9% | `Ar @ http://127.0.0.1:7150/index.js:36:69571` |
| 10 | 804.3ms | 0.9% | `fill @ :-1:-1` |
| 11 | 774.9ms | 0.9% | `Lr @ http://127.0.0.1:7150/index.js:36:72132` |
| 12 | 574.7ms | 0.6% | `(idle) @ :-1:-1` |
| 13 | 525.2ms | 0.6% | `tr @ http://127.0.0.1:7150/index.js:36:58142` |
| 14 | 444.4ms | 0.5% | `(garbage collector) @ :-1:-1` |
| 15 | 402.6ms | 0.4% | `stroke @ :-1:-1` |
| 16 | 359.3ms | 0.4% | `Gt @ http://127.0.0.1:7150/index.js:7:10593` |
| 17 | 317.9ms | 0.4% | `(anonymous) @ http://127.0.0.1:7150/index.js:40:12566` |
| 18 | 314.7ms | 0.3% | `lineTo @ :-1:-1` |
| 19 | 300.4ms | 0.3% | `$r @ http://127.0.0.1:7150/index.js:37:2710` |
| 20 | 291.5ms | 0.3% | `Wt @ http://127.0.0.1:7150/index.js:7:10341` |
| 21 | 268.8ms | 0.3% | `Rs @ http://127.0.0.1:7150/index.js:7:64010` |
| 22 | 238.7ms | 0.3% | `arc @ :-1:-1` |
| 23 | 235.5ms | 0.3% | `removeChild @ :-1:-1` |
| 24 | 232.9ms | 0.3% | `dl @ http://127.0.0.1:7150/index.js:7:100004` |
| 25 | 217.8ms | 0.2% | `Fd @ http://127.0.0.1:7150/index.js:8:7883` |

## Top 10 hot paths — call stacks

### 1. `(program) @ :-1:-1` — 60456.2ms self (67.0%)

```
↳ (root) @ :-1:-1
  ↳ (program) @ :-1:-1
```

### 2. `fillText @ :-1:-1` — 3866.4ms self (4.3%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34785
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12566
      ↳ Fr @ http://127.0.0.1:7150/index.js:36:71344
        ↳ Ar @ http://127.0.0.1:7150/index.js:36:69571
          ↳ fillText @ :-1:-1
```

### 3. `closePath @ :-1:-1` — 3172.5ms self (3.5%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34785
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12566
      ↳ Qn @ http://127.0.0.1:7150/index.js:36:57557
        ↳ tr @ http://127.0.0.1:7150/index.js:36:58142
          ↳ closePath @ :-1:-1
```

### 4. `(anonymous) @ http://127.0.0.1:7150/index.js:1016:15504` — 1843.5ms self (2.0%)

```
↳ (root) @ :-1:-1
  ↳ (anonymous) @ http://127.0.0.1:7150/index.js:7:123358
    ↳ id @ http://127.0.0.1:7150/index.js:7:121940
      ↳ nd @ http://127.0.0.1:7150/index.js:7:121525
        ↳ sd @ http://127.0.0.1:7150/index.js:7:123296
          ↳ mu @ http://127.0.0.1:7150/index.js:7:111146
            ↳ hu @ http://127.0.0.1:7150/index.js:7:112234
              ↳ Pu @ http://127.0.0.1:7150/index.js:7:117012
                ↳ Iu @ http://127.0.0.1:7150/index.js:7:118827
                  ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                    ↳ ml @ http://127.0.0.1:7150/index.js:7:105125
                      ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                        ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                          ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                            ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                              ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                  ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                    ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                      ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                        ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                          ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                            ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                              ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                  ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                    ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                      ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                        ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                          ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                            ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                              ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                                ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                                  ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                                    ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                                      ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                                        ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                                          ↳ $c @ http://127.0.0.1:7150/index.js:7:96259
                                                                            ↳ Rc @ http://127.0.0.1:7150/index.js:7:92434
                                                                              ↳ ref @ http://127.0.0.1:7150/index.js:1016:24777
                                                                                ↳ (anonymous) @ http://127.0.0.1:7150/index.js:1016:15504
```

### 5. `ei @ http://127.0.0.1:7150/index.js:37:4029` — 1192.0ms self (1.3%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34785
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12566
      ↳ ei @ http://127.0.0.1:7150/index.js:37:4029
```

### 6. `ur @ http://127.0.0.1:7150/index.js:36:59985` — 1031.1ms self (1.1%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34785
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12566
      ↳ ei @ http://127.0.0.1:7150/index.js:37:4029
        ↳ dr @ http://127.0.0.1:7150/index.js:36:60179
          ↳ ur @ http://127.0.0.1:7150/index.js:36:59985
```

### 7. `drawImage @ :-1:-1` — 869.7ms self (1.0%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34785
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12566
      ↳ Fr @ http://127.0.0.1:7150/index.js:36:71344
        ↳ Dr @ http://127.0.0.1:7150/index.js:36:68713
          ↳ drawImage @ :-1:-1
```

### 8. `Qn @ http://127.0.0.1:7150/index.js:36:57557` — 853.2ms self (0.9%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34785
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12566
      ↳ Qn @ http://127.0.0.1:7150/index.js:36:57557
```

### 9. `Ar @ http://127.0.0.1:7150/index.js:36:69571` — 813.2ms self (0.9%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34785
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12566
      ↳ Fr @ http://127.0.0.1:7150/index.js:36:71344
        ↳ Ar @ http://127.0.0.1:7150/index.js:36:69571
```

### 10. `fill @ :-1:-1` — 804.3ms self (0.9%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34785
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12566
      ↳ Qn @ http://127.0.0.1:7150/index.js:36:57557
        ↳ fill @ :-1:-1
```
