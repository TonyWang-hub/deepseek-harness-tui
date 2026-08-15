/**
 * PTY-driven automated smoke: the D2.2 acceptance criterion "a pty-driven
 * automated smoke test" for `mountTuiRenderer` — start, type a prompt,
 * stream, scrollback carries the final text, Ctrl-C exits cleanly with the
 * terminal state restored. Not a snapshot-lane test (that lane is separate
 * later work; this test's own evidence is the raw pty byte stream and a
 * real `stty -a`, mirroring `tests/q1-scrollback-commit.poc.ts` (scrollback
 * commit) and `tests/q3-terminal-restoration.poc.ts` (terminal restoration)
 * from `@deepseek-ai/dsh-tui-ink-ui`, but as an ordinary vitest spec rather
 * than a manually-run PoC: this is the shipped renderer's own acceptance
 * evidence, not reconnaissance.
 *
 * Spawns a real `bash` in its own pty (the Q3 pattern) so the pty session
 * survives past the fixture's exit and `stty -a` reads the terminal's
 * actual post-exit termios state, not a value read from inside the
 * (now-dead) fixture process. Bash-requiring — excluded on Windows in
 * `vitest.shared.ts`'s `windowsUnsupportedPackages`, matching every other
 * bash-requiring suite.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as pty from 'node-pty'
import { afterAll, describe, expect, it } from 'vitest'
import { REPO_ROOT } from './compose.client.ts'

const FIXTURE = fileURLToPath(new URL('./fixtures/pty-smoke-app.ts', import.meta.url))
const COLS = 80
const ROWS = 24
const FINAL_ANSWER_TEXT = 'PTY smoke: the scripted turn streamed and committed to scrollback.'
const READY_MARKER = '___READY___'
const DISPOSED_MARKER = '___SMOKE_DISPOSED___'
const EXIT_MARKER_PREFIX = '___EXITCODE_'
const STTY_MARKER = '___STTY_DONE___'

/** One scripted `finish: stop` model reply carrying only final text. */
function textEntry(text: string): unknown {
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }
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

describe('pty smoke: mountTuiRenderer end to end over a real pty', () => {
  let overrideDir: string

  afterAll(async () => {
    if (overrideDir !== undefined) await rm(overrideDir, { recursive: true, force: true })
  })

  it('streams a scripted turn to scrollback and restores the terminal on Ctrl-C', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-tui-pty-smoke-'))
    const overrideFile = join(overrideDir, 'replay.override.json')
    await writeFile(overrideFile, JSON.stringify([textEntry(FINAL_ANSWER_TEXT)]))

    const shell = pty.spawn('/bin/bash', ['--norc', '--noprofile'], {
      name: 'xterm-256color',
      cols: COLS,
      rows: ROWS,
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: '0', PS1: 'SMOKE$ ' },
    })

    let raw = ''
    shell.onData((chunk) => { raw += chunk })

    await delay(400) // let bash finish its own startup before the first command

    const command = `${process.execPath} --import tsx/esm ${FIXTURE} ${overrideFile}; echo ${EXIT_MARKER_PREFIX}$?___\n`
    shell.write(command)

    await waitUntil(() => raw, buffer => buffer.includes(READY_MARKER), 20_000)
    await delay(500) // let the first Ink frame (the empty composer) settle before typing

    shell.write('hello there')
    await delay(200)
    shell.write('\r')

    await waitUntil(() => raw, buffer => buffer.includes(FINAL_ANSWER_TEXT), 15_000)
    const rawAtTurnEnd = raw

    await delay(150)
    shell.write('\x03') // Ctrl-C: Ink's own exitOnCtrlC path

    await waitUntil(() => raw, buffer => buffer.includes(EXIT_MARKER_PREFIX), 15_000)
    const exitCodeMatch = new RegExp(`${EXIT_MARKER_PREFIX}(\\d+)___`).exec(raw)
    // The exit marker only prints after the fixture's own `echo` runs, which
    // bash sequences after the fixture process fully exits — so its
    // presence already implies `___SMOKE_DISPOSED___` was printed first
    // (the fixture prints it, then disposes nothing further, then returns).
    // Assert it directly anyway: it is the one signal that `tree.dispose()`
    // itself resolved, not just that the process exited for some other reason.
    expect(raw).toContain(DISPOSED_MARKER)

    shell.write(`stty -a; echo ${STTY_MARKER}\n`)
    await waitUntil(() => raw, buffer => buffer.includes(STTY_MARKER), 5_000)
    await delay(100)

    // Skip past the echoed command line (cooked-mode local echo repeats
    // "stty -a" verbatim before it runs) to reach the real output, and take
    // the LAST marker occurrence (its actual printed line) — same technique
    // as `tests/q3-terminal-restoration.poc.ts`.
    const echoedCommandIndex = raw.indexOf('stty -a')
    const realOutputStart = echoedCommandIndex >= 0 ? raw.indexOf('\n', echoedCommandIndex) + 1 : -1
    const markerOutputIndex = raw.lastIndexOf(STTY_MARKER)
    const sttyOutput = realOutputStart > 0 && markerOutputIndex > realOutputStart
      ? raw.slice(realOutputStart, markerOutputIndex)
      : ''

    shell.write('exit\n')
    await delay(200)
    shell.kill()

    expect(rawAtTurnEnd).toContain(FINAL_ANSWER_TEXT)
    expect(exitCodeMatch?.[1]).toBe('0')
    expect(readSttyFlag(sttyOutput, 'icanon')).toBe(true)
    expect(readSttyFlag(sttyOutput, 'echo')).toBe(true)
  }, 60_000)
})
