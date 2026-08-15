/**
 * Q3 reconnaissance PoC: does Ink restore raw mode, cursor visibility, and
 * bracketed paste on normal exit, Ctrl+C, and an uncaught exception alike —
 * the three paths the Agent Note's "Terminal ownership" section requires
 * ("raw mode, bracketed paste, and cursor state are restored on normal
 * exit, Ctrl-C, and abnormal termination alike")?
 *
 * For each mode, a real shell (`bash`) is spawned in its own pty so the pty
 * session survives past the fixture's exit; the fixture
 * (`fixtures/q3-exit-app.tsx`) runs as a child of that shell, and once it
 * exits control returns to the shell prompt, which then runs `stty -a` —
 * reading the pty's actual termios state the way a person would after the
 * app quit, not a value read from inside the (now-dead) fixture process.
 * Cursor visibility and bracketed paste are not termios bits, so those two
 * are read from the last relevant escape sequence in the raw byte stream
 * instead (last `\x1b[?25h`/`\x1b[?25l` occurrence, last
 * `\x1b[?2004h`/`\x1b[?2004l` occurrence).
 *
 * NOT a vitest spec — see `q1-scrollback-commit.poc.ts`'s module doc for why.
 * Run manually:
 *
 *   pnpm exec tsx packages/tui/ink-ui/tests/q3-terminal-restoration.poc.ts
 */
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as pty from 'node-pty'

const FIXTURE = fileURLToPath(new URL('./fixtures/q3-exit-app.tsx', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const COLS = 80
const ROWS = 24
const READY_MARKER = '___READY___'
const EXIT_MARKER_PREFIX = '___EXITCODE_'
const STTY_MARKER = '___STTY_DONE___'

type Mode = 'normal' | 'ctrlc' | 'throw'

interface ModeResult {
  readonly mode: Mode
  readonly exitCode: string | undefined
  readonly rawModeRestored: boolean | undefined
  readonly echoRestored: boolean | undefined
  readonly cursorShownAtEnd: boolean | undefined
  readonly bracketedPasteDisabledAtEnd: boolean | undefined
  readonly sttyOutput: string
}

/** Wait until `predicate(buffer)` is true or the deadline passes. */
async function waitUntil(getBuffer: () => string, predicate: (buffer: string) => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate(getBuffer()) && Date.now() < deadline) await delay(20)
  if (!predicate(getBuffer())) {
    throw new Error(`timed out waiting for condition; captured so far:\n${getBuffer()}`)
  }
}

/** Read a whole-token stty flag (`name` or `-name`) out of `sttyOutput`; `undefined` if absent. */
function readSttyFlag(sttyOutput: string, name: string): boolean | undefined {
  const match = new RegExp(`(?:^|\\s)(-?${name})(?=[\\s;]|$)`).exec(sttyOutput)
  if (!match) return undefined
  return !match[1]!.startsWith('-')
}

/** Whether the last occurrence of a DEC private-mode pair (`${prefix}h` / `${prefix}l`) in `raw` is the "on" or "off" form. */
function lastModeState(raw: string, prefix: string): boolean | undefined {
  const pattern = new RegExp(`\\u001b${prefix}([hl])`, 'g')
  let last: string | undefined
  for (const match of raw.matchAll(pattern)) last = match[1]
  if (last === undefined) return undefined
  return last === 'h'
}

async function runMode(mode: Mode): Promise<ModeResult> {
  const shell = pty.spawn('/bin/bash', ['--norc', '--noprofile'], {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: REPO_ROOT,
    env: { ...process.env, FORCE_COLOR: '0', PS1: 'Q3PROMPT$ ' },
  })

  let raw = ''
  shell.onData((chunk) => { raw += chunk })

  await delay(400) // let bash finish its own startup before the first command

  const command = `${process.execPath} --import tsx/esm ${FIXTURE} ${mode}; echo ${EXIT_MARKER_PREFIX}$?___\n`
  shell.write(command)

  await waitUntil(() => raw, buffer => buffer.includes(READY_MARKER), 15_000)

  if (mode === 'ctrlc') {
    await delay(150)
    shell.write('\x03')
  }
  // 'normal' and 'throw' exit on their own scheduled timers.

  await waitUntil(() => raw, buffer => buffer.includes(EXIT_MARKER_PREFIX), 15_000)
  const exitCodeMatch = new RegExp(`${EXIT_MARKER_PREFIX}(\\d+)___`).exec(raw)

  const rawAtFixtureExit = raw

  shell.write(`stty -a; echo ${STTY_MARKER}\n`)
  await waitUntil(() => raw, buffer => buffer.includes(STTY_MARKER), 5_000)
  await delay(100)

  // The typed command line itself is echoed back verbatim before it runs
  // (cooked-mode local echo), so both "stty -a" and the marker text appear a
  // first time inside that echoed line — neither is stty's real output yet.
  // Skip past the echoed line's newline to reach the real `stty -a` output,
  // and take the LAST occurrence of the marker (its actual printed line).
  const echoedCommandIndex = raw.indexOf('stty -a')
  const realOutputStart = echoedCommandIndex >= 0 ? raw.indexOf('\n', echoedCommandIndex) + 1 : -1
  const markerOutputIndex = raw.lastIndexOf(STTY_MARKER)
  const sttyOutput = realOutputStart > 0 && markerOutputIndex > realOutputStart
    ? raw.slice(realOutputStart, markerOutputIndex)
    : ''

  shell.write('exit\n')
  await delay(200)
  shell.kill()

  return {
    mode,
    exitCode: exitCodeMatch?.[1],
    rawModeRestored: readSttyFlag(sttyOutput, 'icanon'),
    echoRestored: readSttyFlag(sttyOutput, 'echo'),
    cursorShownAtEnd: lastModeState(rawAtFixtureExit, '\\[\\?25'),
    bracketedPasteDisabledAtEnd: lastModeState(rawAtFixtureExit, '\\[\\?2004') === false
      || lastModeState(rawAtFixtureExit, '\\[\\?2004') === undefined,
    sttyOutput,
  }
}

interface Assertion {
  readonly description: string
  readonly pass: boolean
  readonly detail?: string
}

function evaluate(result: ModeResult): Assertion[] {
  return [
    {
      description: `[${result.mode}] raw mode restored (stty reports "icanon", not "-icanon")`,
      pass: result.rawModeRestored === true,
      detail: `rawModeRestored=${String(result.rawModeRestored)}`,
    },
    {
      description: `[${result.mode}] terminal echo restored (stty reports "echo", not "-echo")`,
      pass: result.echoRestored === true,
      detail: `echoRestored=${String(result.echoRestored)}`,
    },
    {
      description: `[${result.mode}] cursor left visible (last DEC ?25 sequence is show, not hide)`,
      pass: result.cursorShownAtEnd === true,
      detail: `cursorShownAtEnd=${String(result.cursorShownAtEnd)}`,
    },
    {
      description: `[${result.mode}] bracketed paste left disabled (last DEC ?2004 sequence is off, or never enabled)`,
      pass: result.bracketedPasteDisabledAtEnd === true,
      detail: `bracketedPasteDisabledAtEnd=${String(result.bracketedPasteDisabledAtEnd)}`,
    },
  ]
}

async function main(): Promise<void> {
  const modes: Mode[] = ['normal', 'ctrlc', 'throw']
  const results: ModeResult[] = []
  for (const mode of modes) {
    console.log(`\n=== mode: ${mode} ===`)
    const result = await runMode(mode)
    results.push(result)
    console.log(`exitCode=${result.exitCode ?? '<not captured>'}`)
    console.log('stty -a output:')
    console.log(result.sttyOutput.trim())
  }

  console.log('\n--- assertions ---')
  const allAssertions = results.flatMap(evaluate)
  for (const assertion of allAssertions) {
    console.log(`${assertion.pass ? 'PASS' : 'FAIL'} - ${assertion.description}${assertion.detail ? ` (${assertion.detail})` : ''}`)
  }
  const failures = allAssertions.filter(assertion => !assertion.pass)
  if (failures.length > 0) {
    console.log(`\nQ3 VERDICT: gaps found — ${failures.length}/${allAssertions.length} assertions failed (see failures above for which exit path and which terminal-state facet)`)
    process.exitCode = 1
    return
  }
  console.log('\nQ3 VERDICT: PASS — all three exit paths restore raw mode, echo, cursor visibility, and bracketed paste.')
}

await main()
