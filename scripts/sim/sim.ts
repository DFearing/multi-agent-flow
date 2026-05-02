/**
 * Wire-format simulator CLI.
 *
 * Usage:
 *   pnpm sim <scenario> [--workspace <path>] [--speed <n>] [--keep] [--verbose]
 *   pnpm sim --list
 *
 * The sim is consumed by the running relay (start it separately with
 * `pnpm dev`, `pnpm dev:relay`, or `npx agent-flow-app`). The sim's only
 * job is to produce JSONL on disk in the layout the relay expects.
 */

import { createRunner } from './runner'
import { SCENARIOS, SCENARIO_NAMES } from './scenarios'

interface CliArgs {
  scenario: string | null
  workspace: string
  speed: number
  keep: boolean
  verbose: boolean
  list: boolean
  help: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    scenario: null,
    workspace: process.cwd(),
    speed: 1,
    keep: false,
    verbose: false,
    list: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '--workspace': args.workspace = argv[++i]; break
      case '--speed': {
        const n = Number(argv[++i])
        if (!Number.isFinite(n) || n <= 0) {
          console.error(`[sim] --speed must be a positive number (got ${argv[i]})`)
          process.exit(2)
        }
        args.speed = n
        break
      }
      case '--keep': args.keep = true; break
      case '--verbose': case '-v': args.verbose = true; break
      case '--list': args.list = true; break
      case '--help': case '-h': args.help = true; break
      default:
        if (a.startsWith('-')) {
          console.error(`[sim] unknown flag: ${a}`)
          process.exit(2)
        }
        if (args.scenario) {
          console.error(`[sim] unexpected positional arg: ${a}`)
          process.exit(2)
        }
        args.scenario = a
    }
  }
  return args
}

function printHelp(): void {
  console.log(`Usage: pnpm sim <scenario> [options]

Scenarios:
${SCENARIO_NAMES.map(n => `  ${n.padEnd(20)} ${SCENARIOS[n].description}`).join('\n')}

Options:
  --workspace <path>    Workspace path (default: cwd). Must match the dir
                        the running relay/dev server is watching.
  --speed <multiplier>  Playback speed multiplier (default: 1.0).
                        E.g. --speed 5 → 5x faster.
  --keep                Don't remove the symlinks under ~/.claude/projects/
                        on exit. Useful for replaying scenarios.
  --verbose, -v         Log session ids, paths, and lifecycle events.
  --list                List scenarios and exit.
  --help, -h            Show this message.

Setup:
  1. Start the relay (in another terminal):  pnpm dev
  2. In this terminal, run a scenario:       pnpm sim solo
  3. Open the visualizer at the URL the relay prints — events stream live.
`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) { printHelp(); return }
  if (args.list) {
    for (const name of SCENARIO_NAMES) {
      console.log(`${name.padEnd(20)} ${SCENARIOS[name].description}`)
    }
    return
  }
  if (!args.scenario) {
    printHelp()
    process.exit(2)
  }

  const scenario = SCENARIOS[args.scenario]
  if (!scenario) {
    console.error(`[sim] unknown scenario: ${args.scenario}`)
    console.error(`[sim] available: ${SCENARIO_NAMES.join(', ')}`)
    process.exit(2)
  }

  const runner = createRunner({
    workspace: args.workspace,
    speed: args.speed,
    keep: args.keep,
    verbose: args.verbose,
  })

  let interrupted = false
  const onSignal = () => {
    if (interrupted) return
    interrupted = true
    console.log('\n[sim] interrupted — cleaning up')
    runner.shutdown()
    process.exit(130)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  console.log(`[sim] running scenario "${scenario.name}" (speed ${args.speed}x)`)
  const start = Date.now()
  try {
    await scenario.run(runner)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`[sim] scenario "${scenario.name}" finished in ${elapsed}s`)
  } finally {
    runner.shutdown()
  }
}

main().catch(err => {
  console.error('[sim] fatal:', err)
  process.exit(1)
})
