#!/usr/bin/env node
/**
 * For a given target function name (or substring match), aggregate self-time
 * by the *immediate caller* across the entire CPU profile.
 *
 * Usage:
 *   node breakdown-by-caller.mjs results/long-tasks-profile.cpuprofile drawImage
 */
import * as fs from 'node:fs'

const [, , profilePath, targetMatch] = process.argv
if (!profilePath || !targetMatch) {
  console.error('usage: node breakdown-by-caller.mjs <profile.cpuprofile> <function-name>')
  process.exit(2)
}
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
const { nodes, samples, timeDeltas } = profile

const byId = new Map(nodes.map(n => [n.id, n]))
const parentOf = new Map()
for (const n of nodes) if (n.children) for (const c of n.children) parentOf.set(c, n.id)

function keyOf(n) {
  const f = n.callFrame
  return `${f.functionName || '(anonymous)'} @ ${f.url || ''}:${f.lineNumber}:${f.columnNumber}`
}

// Self-time per node id (microseconds).
const selfUs = new Map()
for (const n of nodes) selfUs.set(n.id, 0)
for (let i = 0; i < samples.length; i++) {
  selfUs.set(samples[i], (selfUs.get(samples[i]) || 0) + (timeDeltas[i] || 0))
}

const totalUs = (timeDeltas || []).reduce((a, b) => a + b, 0)

// All target nodes (any node whose function name contains the substring).
const targets = nodes.filter(n => (n.callFrame.functionName || '').includes(targetMatch))
if (targets.length === 0) {
  console.error(`no functions matched "${targetMatch}"`)
  process.exit(1)
}
const targetTotal = targets.reduce((a, n) => a + (selfUs.get(n.id) || 0), 0)

// Aggregate target self-time by immediate caller.
const byCaller = new Map()
for (const n of targets) {
  const pid = parentOf.get(n.id)
  const caller = pid != null ? keyOf(byId.get(pid)) : '(no caller)'
  const me = selfUs.get(n.id) || 0
  byCaller.set(caller, (byCaller.get(caller) || 0) + me)
}
const sorted = [...byCaller.entries()].sort((a, b) => b[1] - a[1])

console.log(`# breakdown of "${targetMatch}" by immediate caller`)
console.log(`# total profiled CPU time:    ${(totalUs / 1e6).toFixed(2)}s`)
console.log(`# total time in "${targetMatch}":   ${(targetTotal / 1e6).toFixed(2)}s  (${(targetTotal / totalUs * 100).toFixed(1)}% of CPU)`)
console.log(`# ${sorted.length} distinct callers, ${targets.length} target node instances`)
console.log()
console.log('| self time | self %-of-target | self %-of-total | caller |')
console.log('|---|---|---|---|')
for (const [caller, us] of sorted.slice(0, 15)) {
  const pctTarget = (us / targetTotal * 100).toFixed(1)
  const pctTotal = (us / totalUs * 100).toFixed(1)
  console.log(`| ${(us / 1000).toFixed(1)}ms | ${pctTarget}% | ${pctTotal}% | \`${caller}\` |`)
}
