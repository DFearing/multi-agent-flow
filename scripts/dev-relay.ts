#!/usr/bin/env node
/**
 * Dev relay server — wraps the shared relay with a standalone HTTP server
 * that includes CORS headers for cross-origin dev mode (Next.js on :3000).
 */
import * as http from 'http'
import { createRelay } from './relay'
import { DEFAULT_RELAY_PORT, DEV_WEB_ORIGIN_PATTERN } from '../extension/src/constants'

async function main() {
  const workspace = process.argv[2] || process.cwd()

  console.log('Starting Agent Flow dev relay...\n')
  console.log(`Workspace: ${workspace}`)

  const relay = await createRelay({ workspace, verbose: true })

  const server = http.createServer((req, res) => {
    // Echo back the request Origin if it matches a localhost pattern, so
    // CORS survives Next.js picking a fallback port when 3000 is busy.
    const origin = req.headers.origin
    if (typeof origin === 'string' && DEV_WEB_ORIGIN_PATTERN.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.url === '/events') {
      return relay.handleSSE(req, res)
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Agent Flow Dev Relay')
  })

  // Dev-only: bind to all interfaces so the relay is reachable from a
  // browser loading the Next dev server over LAN / Tailscale / SSH-forward.
  // Override with AGENT_FLOW_DEV_RELAY_HOST=127.0.0.1 to lock to loopback.
  const host = process.env.AGENT_FLOW_DEV_RELAY_HOST || '0.0.0.0'
  server.listen(DEFAULT_RELAY_PORT, host, () => {
    console.log(`\nSSE relay on http://${host}:${DEFAULT_RELAY_PORT}/events`)
    console.log('Ready! Events will appear in the web app.')
  })

  function cleanup() {
    server.close()
    relay.dispose()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

main().catch(e => {
  console.error('Failed to start dev relay:', e)
  process.exit(1)
})
