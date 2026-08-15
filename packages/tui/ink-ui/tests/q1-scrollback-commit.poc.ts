/**
 * Q1 reconnaissance PoC: does committing a finished step to real terminal
 * scrollback without `<Static>` actually work — the alternative the Agent
 * Note proposes (`.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md`,
 * "Rendering" and "Alternatives considered")?
 *
 * Runs the fixture (`fixtures/q1-scrollback-app.tsx`) under a real pty twice,
 * once per commit strategy, and projects the resulting byte stream through a
 * headless terminal emulator (`@xterm/headless`) to read the final screen a
 * real terminal would show:
 *
 * - `raw-write`: `instance.clear()` then a direct `process.stdout.write()`.
 * - `console-log`: routes through Ink's own `patchConsole` plumbing.
 *
 * NOT a vitest spec (`*.poc.ts`, not `*.spec.ts` — see `vitest.config.ts`'s
 * `testIncludes`): it spawns a real pty via `node-pty` and drives timers at
 * wall-clock speed, which is slow and would add PTY/ANSI-parsing flakiness to
 * the coverage gate for a spike whose evidence is meant to be read, not
 * re-run on every commit. Run manually:
 *
 *   pnpm exec tsx packages/tui/ink-ui/tests/q1-scrollback-commit.poc.ts
 *
 * Exits 0 and prints "Q1 VERDICT: PASS" only if `console-log` passes every
 * assertion (the strategy this PoC recommends); `raw-write`'s result is
 * reported but does not gate the exit code — it is expected to fail and its
 * failure is itself part of the finding.
 */
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as pty from 'node-pty'
import xtermHeadless from '@xterm/headless'

const { Terminal } = xtermHeadless

const FIXTURE = fileURLToPath(new URL('./fixtures/q1-scrollback-app.tsx', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const TOTAL_STEPS = 5
const COLS = 80
const ROWS = 24
const DONE_MARKER = '___POC_ALL_DONE___'

interface Assertion {
  readonly description: string
  readonly pass: boolean
  readonly detail?: string
}

async function runFixture(mode: 'raw-write' | 'console-log'): Promise<string> {
  const child = pty.spawn(process.execPath, ['--import', 'tsx/esm', FIXTURE, String(TOTAL_STEPS), mode], {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: REPO_ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
  })

  let raw = ''
  let sawMarker = false
  child.onData((chunk) => {
    raw += chunk
    if (raw.includes(DONE_MARKER)) sawMarker = true
  })

  const exited = new Promise<void>((resolve) => {
    child.onExit(() => { resolve() })
  })

  const deadline = Date.now() + 15_000
  while (!sawMarker && Date.now() < deadline) await delay(20)
  if (!sawMarker) throw new Error(`[${mode}] fixture never printed ${DONE_MARKER} within timeout; captured:\n${raw}`)

  await Promise.race([exited, delay(5_000)])
  // Let the pty drain any trailing bytes written between the marker and unmount's final frame.
  await delay(200)
  return raw
}

async function projectFinalScreen(raw: string): Promise<string[]> {
  const terminal = new Terminal({ cols: COLS, rows: ROWS, scrollback: 1000, allowProposedApi: true })
  await new Promise<void>((resolve) => { terminal.write(raw, resolve) })
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row)
    if (line) lines.push(line.translateToString(true))
  }
  terminal.dispose()
  return lines
}

function evaluate(raw: string, screenLines: readonly string[]): Assertion[] {
  const nonBlank = screenLines.filter(line => line.trim() !== '')
  const assertions: Assertion[] = []

  for (let step = 0; step < TOTAL_STEPS; step++) {
    const needle = `✓ committed step ${step}`
    const rawOccurrences = raw.split(needle).length - 1
    assertions.push({
      description: `raw pty stream writes "${needle}" exactly once (not re-emitted by a later Ink render)`,
      pass: rawOccurrences === 1,
      detail: `occurrences=${rawOccurrences}`,
    })
    const screenOccurrences = nonBlank.filter(line => line.includes(needle)).length
    assertions.push({
      description: `final terminal projection shows "${needle}" exactly once`,
      pass: screenOccurrences === 1,
      detail: `occurrences=${screenOccurrences}`,
    })
  }

  // Scrollback order: each committed line must appear strictly after the
  // previous one in the terminal's row order (no interleaving/misordering
  // from a clear() that erased the wrong region).
  const committedRows = nonBlank
    .map((line, index) => ({ line, index }))
    .filter(entry => entry.line.startsWith('✓ committed step '))
  const inOrder = committedRows.every((entry, position) => {
    if (position === 0) return true
    return entry.index > committedRows[position - 1]!.index
  })
  assertions.push({
    description: 'committed lines land in scrollback in ascending row order (no misalignment)',
    pass: inOrder,
    detail: committedRows.map(entry => `${entry.index}:${entry.line}`).join(' | '),
  })

  // No stray duplicate of the live "running" line should remain once the
  // fixture unmounts — Ink's own teardown frame is the only one left.
  const runningLines = nonBlank.filter(line => line.includes('running step'))
  assertions.push({
    description: 'no leftover duplicate live-region frame after unmount',
    pass: runningLines.length <= 1,
    detail: `runningLines=${JSON.stringify(runningLines)}`,
  })

  return assertions
}

async function runMode(mode: 'raw-write' | 'console-log'): Promise<boolean> {
  console.log(`\n=== mode: ${mode} ===`)
  const raw = await runFixture(mode)
  const screenLines = await projectFinalScreen(raw)
  const assertions = evaluate(raw, screenLines)
  for (const assertion of assertions) {
    console.log(`${assertion.pass ? 'PASS' : 'FAIL'} - ${assertion.description}${assertion.detail ? ` (${assertion.detail})` : ''}`)
  }
  const failures = assertions.filter(assertion => !assertion.pass)
  console.log(failures.length === 0
    ? `[${mode}] all ${assertions.length} assertions passed`
    : `[${mode}] ${failures.length}/${assertions.length} assertions failed`)
  return failures.length === 0
}

async function main(): Promise<void> {
  const rawWritePassed = await runMode('raw-write')
  const consoleLogPassed = await runMode('console-log')

  console.log('\n--- summary ---')
  console.log(`raw-write:   ${rawWritePassed ? 'PASS' : 'FAIL (expected — log-update cursor bookkeeping desyncs, see fixture module doc)'}`)
  console.log(`console-log: ${consoleLogPassed ? 'PASS' : 'FAIL'}`)

  if (!consoleLogPassed) {
    console.log('\nQ1 VERDICT: INCONCLUSIVE — the recommended console-log strategy did not pass; re-investigate before trusting the Rendering design.')
    process.exitCode = 1
    return
  }
  console.log(rawWritePassed
    ? '\nQ1 VERDICT: PASS — both strategies commit to scrollback correctly.'
    : '\nQ1 VERDICT: PASS with a caveat — commit through console.log()/Ink\'s patchConsole plumbing, not a manual clear()+write(); see README "Q1" section.')
}

await main()
