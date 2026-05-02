# Long-task profile — 2026-05-02 21:33:21

- Stack: HEAD (`98df60b`)
- CPU throttle: 4×
- Warmup: 30s · Measurement: 90s
- Sim: `concurrent` scenario, 3 sessions
- CPU profile sampling interval: 1000us
- Total profiled CPU time: 90.35s

## Long tasks observed (PerformanceObserver, main thread)

- Count: **861**, total blocking: **79.8s**, longest: **165ms**

| duration | count |
|---|---|
| 0–50ms | 0 |
| 50–100ms | 643 |
| 100–200ms | 218 |
| 200–500ms | 0 |
| 500–1000ms | 0 |
| 1000–5000ms | 0 |
| ≥5000ms | 0 |

## Top 25 functions by self time (CPU profile)

| rank | self time | self % | function |
|---|---|---|---|
| 1 | 44757.7ms | 49.5% | `drawImage @ :-1:-1` |
| 2 | 19316.8ms | 21.4% | `(program) @ :-1:-1` |
| 3 | 3058.4ms | 3.4% | `fillText @ :-1:-1` |
| 4 | 2192.9ms | 2.4% | `(anonymous) @ http://127.0.0.1:7150/index.js:1016:15504` |
| 5 | 1527.9ms | 1.7% | `closePath @ :-1:-1` |
| 6 | 870.4ms | 1.0% | `ir @ http://127.0.0.1:7150/index.js:36:59914` |
| 7 | 829.4ms | 0.9% | `Jr @ http://127.0.0.1:7150/index.js:37:4029` |
| 8 | 699.9ms | 0.8% | `Kn @ http://127.0.0.1:7150/index.js:36:57486` |
| 9 | 693.3ms | 0.8% | `wr @ http://127.0.0.1:7150/index.js:36:69500` |
| 10 | 586.7ms | 0.6% | `fill @ :-1:-1` |
| 11 | 563.6ms | 0.6% | `jr @ http://127.0.0.1:7150/index.js:36:72061` |
| 12 | 529.7ms | 0.6% | `(idle) @ :-1:-1` |
| 13 | 460.9ms | 0.5% | `Ut @ http://127.0.0.1:7150/index.js:7:10593` |
| 14 | 371.2ms | 0.4% | `apply @ http://127.0.0.1:7150/index.js:36:56424` |
| 15 | 358.4ms | 0.4% | `(garbage collector) @ :-1:-1` |
| 16 | 339.7ms | 0.4% | `Rs @ http://127.0.0.1:7150/index.js:7:64054` |
| 17 | 336.1ms | 0.4% | `Fd @ http://127.0.0.1:7150/index.js:8:7883` |
| 18 | 325.0ms | 0.4% | `(anonymous) @ http://127.0.0.1:7150/index.js:40:12525` |
| 19 | 315.3ms | 0.3% | `Yn @ http://127.0.0.1:7150/index.js:36:58071` |
| 20 | 303.9ms | 0.3% | `ul @ http://127.0.0.1:7150/index.js:7:100046` |
| 21 | 300.6ms | 0.3% | `Ht @ http://127.0.0.1:7150/index.js:7:10341` |
| 22 | 273.4ms | 0.3% | `removeChild @ :-1:-1` |
| 23 | 247.5ms | 0.3% | `stroke @ :-1:-1` |
| 24 | 247.4ms | 0.3% | `wc @ http://127.0.0.1:7150/index.js:7:79825` |
| 25 | 245.7ms | 0.3% | `e.cloneElement @ http://127.0.0.1:7150/index.js:0:9002` |

## Top 10 hot paths — call stacks

### 1. `drawImage @ :-1:-1` — 44757.7ms self (49.5%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34802
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:15275
      ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12525
        ↳ apply @ http://127.0.0.1:7150/index.js:36:56424
          ↳ drawImage @ :-1:-1
```

### 2. `(program) @ :-1:-1` — 19316.8ms self (21.4%)

```
↳ (root) @ :-1:-1
  ↳ (program) @ :-1:-1
```

### 3. `fillText @ :-1:-1` — 3058.4ms self (3.4%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34802
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:15275
      ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12525
        ↳ kr @ http://127.0.0.1:7150/index.js:36:71273
          ↳ wr @ http://127.0.0.1:7150/index.js:36:69500
            ↳ fillText @ :-1:-1
```

### 4. `(anonymous) @ http://127.0.0.1:7150/index.js:1016:15504` — 2192.9ms self (2.4%)

```
↳ (root) @ :-1:-1
  ↳ (anonymous) @ http://127.0.0.1:7150/index.js:7:123444
    ↳ id @ http://127.0.0.1:7150/index.js:7:122026
      ↳ nd @ http://127.0.0.1:7150/index.js:7:121611
        ↳ sd @ http://127.0.0.1:7150/index.js:7:123382
          ↳ pu @ http://127.0.0.1:7150/index.js:7:111191
            ↳ mu @ http://127.0.0.1:7150/index.js:7:112283
              ↳ Pu @ http://127.0.0.1:7150/index.js:7:117097
                ↳ Iu @ http://127.0.0.1:7150/index.js:7:118913
                  ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                    ↳ pl @ http://127.0.0.1:7150/index.js:7:105167
                      ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                        ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                          ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                            ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                              ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                  ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                    ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                      ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                        ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                          ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                            ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                              ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                  ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                    ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                      ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                        ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                          ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                            ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                              ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                                ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                                  ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                                    ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                                      ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                                        ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                                          ↳ $c @ http://127.0.0.1:7150/index.js:7:96326
                                                                            ↳ Rc @ http://127.0.0.1:7150/index.js:7:92501
                                                                              ↳ ref @ http://127.0.0.1:7150/index.js:1016:24777
                                                                                ↳ (anonymous) @ http://127.0.0.1:7150/index.js:1016:15504
```

### 5. `closePath @ :-1:-1` — 1527.9ms self (1.7%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34802
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:15275
      ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12525
        ↳ Kn @ http://127.0.0.1:7150/index.js:36:57486
          ↳ Yn @ http://127.0.0.1:7150/index.js:36:58071
            ↳ closePath @ :-1:-1
```

### 6. `ir @ http://127.0.0.1:7150/index.js:36:59914` — 870.4ms self (1.0%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34802
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:15275
      ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12525
        ↳ Jr @ http://127.0.0.1:7150/index.js:37:4029
          ↳ ar @ http://127.0.0.1:7150/index.js:36:60108
            ↳ ir @ http://127.0.0.1:7150/index.js:36:59914
```

### 7. `Jr @ http://127.0.0.1:7150/index.js:37:4029` — 829.4ms self (0.9%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34802
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:15275
      ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12525
        ↳ Jr @ http://127.0.0.1:7150/index.js:37:4029
```

### 8. `Kn @ http://127.0.0.1:7150/index.js:36:57486` — 699.9ms self (0.8%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34802
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:15275
      ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12525
        ↳ Kn @ http://127.0.0.1:7150/index.js:36:57486
```

### 9. `wr @ http://127.0.0.1:7150/index.js:36:69500` — 693.3ms self (0.8%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34802
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:15275
      ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12525
        ↳ kr @ http://127.0.0.1:7150/index.js:36:71273
          ↳ wr @ http://127.0.0.1:7150/index.js:36:69500
```

### 10. `fill @ :-1:-1` — 586.7ms self (0.6%)

```
↳ (root) @ :-1:-1
  ↳ v @ http://127.0.0.1:7150/index.js:36:34802
    ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:15275
      ↳ (anonymous) @ http://127.0.0.1:7150/index.js:40:12525
        ↳ Kn @ http://127.0.0.1:7150/index.js:36:57486
          ↳ fill @ :-1:-1
```
