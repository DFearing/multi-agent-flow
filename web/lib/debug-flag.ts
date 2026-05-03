/**
 * Diagnostic event tracing flag for the bridge → canvas event pipeline.
 *
 * Read once at module load. Enable by either:
 *   1. URL: ?debug=events  (or any value containing the substring "events")
 *   2. localStorage: localStorage.setItem('AGENT_FLOW_DEBUG', 'events')
 *
 * Falsy/missing means silent. The flag is cached, so toggling at runtime
 * requires a page refresh.
 *
 * Examples:
 *   http://localhost:3000/?debug=events
 *   localStorage.setItem('AGENT_FLOW_DEBUG', 'events')  // then refresh
 */
export const DEBUG_EVENTS = (() => {
  if (typeof window === 'undefined') return false
  try {
    const url = new URLSearchParams(window.location.search).get('debug') ?? ''
    if (url.includes('events')) return true
    const ls = window.localStorage?.getItem('AGENT_FLOW_DEBUG') ?? ''
    if (ls.includes('events')) return true
  } catch { /* ignore */ }
  return false
})()

/** Cheap no-op when flag is off. Prefix all output with `[af]`. */
export function dlog(...args: unknown[]): void {
  if (DEBUG_EVENTS) console.log('[af]', ...args)
}
