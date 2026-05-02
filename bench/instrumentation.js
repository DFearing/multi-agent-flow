// Injected via Playwright addInitScript before any page script runs.
// Captures FPS, frame times, long tasks, JS heap, and React commit counts.
// Exposes window.__bench with: start(), stop(), summary().

(() => {
  const state = {
    running: false,
    frames: [],            // rAF deltas in ms
    longTasks: [],         // { duration, startTime }
    heapSamples: [],       // { ts, used }
    reactCommits: 0,
    rafId: 0,
    longTaskObs: null,
    heapTimer: 0,
    startedAt: 0,
    stoppedAt: 0,
    lastFrameTs: 0,
  }

  // React DevTools hook — installed before React loads. React calls
  // onCommitFiberRoot on every commit; we just count.
  // Stay compatible with real DevTools: if a real one is already there, leave it alone.
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberRoot: (_id, _root, _priorityLevel) => {
        if (state.running) state.reactCommits++
      },
      onCommitFiberUnmount: () => {},
      checkDCE: () => {},
      renderers: new Map(),
    }
  }

  function rafLoop(ts) {
    if (!state.running) return
    if (state.lastFrameTs) {
      state.frames.push(ts - state.lastFrameTs)
    }
    state.lastFrameTs = ts
    state.rafId = requestAnimationFrame(rafLoop)
  }

  window.__bench = {
    start() {
      if (state.running) return
      state.running = true
      state.frames = []
      state.longTasks = []
      state.heapSamples = []
      state.reactCommits = 0
      state.lastFrameTs = 0
      state.startedAt = performance.now()

      try {
        state.longTaskObs = new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            state.longTasks.push({ duration: e.duration, startTime: e.startTime })
          }
        })
        state.longTaskObs.observe({ type: 'longtask', buffered: true })
      } catch (e) { /* longtask not supported */ }

      state.heapTimer = setInterval(() => {
        if (performance.memory) {
          state.heapSamples.push({
            ts: performance.now(),
            used: performance.memory.usedJSHeapSize,
          })
        }
      }, 1000)

      state.rafId = requestAnimationFrame(rafLoop)
    },

    stop() {
      if (!state.running) return
      state.running = false
      state.stoppedAt = performance.now()
      cancelAnimationFrame(state.rafId)
      if (state.longTaskObs) state.longTaskObs.disconnect()
      clearInterval(state.heapTimer)
    },

    summary() {
      const wallMs = state.stoppedAt - state.startedAt
      const frames = state.frames.slice()
      frames.sort((a, b) => a - b)
      const fcount = frames.length
      const pct = (p) => fcount ? frames[Math.min(fcount - 1, Math.floor(p * fcount))] : 0
      const sum = frames.reduce((a, b) => a + b, 0)
      const meanFrame = fcount ? sum / fcount : 0
      const fps = wallMs > 0 ? (fcount * 1000) / wallMs : 0

      const ltCount = state.longTasks.length
      const ltTotal = state.longTasks.reduce((a, b) => a + b.duration, 0)
      const ltMax = state.longTasks.reduce((a, b) => Math.max(a, b.duration), 0)

      const heap = state.heapSamples.slice().sort((a, b) => a.used - b.used)
      const heapMean = heap.length ? heap.reduce((a, b) => a + b.used, 0) / heap.length : 0
      const heapPeak = heap.length ? heap[heap.length - 1].used : 0

      return {
        wallMs,
        frameCount: fcount,
        fpsMean: fps,
        frameMs: {
          mean: meanFrame,
          p50: pct(0.50),
          p95: pct(0.95),
          p99: pct(0.99),
        },
        longTasks: {
          count: ltCount,
          totalMs: ltTotal,
          maxMs: ltMax,
        },
        reactCommits: state.reactCommits,
        heapBytes: {
          mean: Math.round(heapMean),
          peak: Math.round(heapPeak),
          samples: heap.length,
        },
      }
    },

    raw() {
      // For deeper analysis if needed
      return {
        frames: state.frames,
        longTasks: state.longTasks,
        heapSamples: state.heapSamples,
      }
    },
  }
})()
