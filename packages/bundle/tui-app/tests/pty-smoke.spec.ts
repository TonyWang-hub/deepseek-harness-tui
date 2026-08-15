/**
 * PTY-driven real-composition smoke: boots the REAL `dsh --profile tui`
 * composition — `dsh-base` and this package's own `cordis.patch.yml`, resolved
 * through the shipped profile mechanism (`PROFILE_TEMPLATES.tui`), never an
 * ad-hoc row list — under a real pty, types a prompt, and asserts the
 * scripted reply streamed and committed to scrollback, then that Ctrl-C exits
 * cleanly with the terminal restored. Mirrors
 * `packages/tui/runtime/tests/pty-smoke.client.spec.ts`'s own technique (a
 * real `bash` pty, the same readiness/disposed/exit-code marker protocol, the
 * same `stty -a` restoration check) but through this bundle's real patch
 * composition instead of `compose.client.ts`'s test-only row list. Bash-
 * requiring — excluded on Windows in `vitest.shared.ts`'s
 * `windowsUnsupportedPackages`, matching every other bash-requiring suite.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as pty from 'node-pty'
import { afterAll, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/tui-app-smoke.ts', import.meta.url))
const COLS = 80
const ROWS = 24
const FINAL_ANSWER_TEXT = 'tui-app pty smoke: the scripted turn streamed and committed to scrollback.'
const READY_MARKER = '___READY___'
const DISPOSED_MARKER = '___SMOKE_DISPOSED___'
const EXIT_MARKER_PREFIX = '___EXITCODE_'
const STTY_MARKER = '___STTY_DONE___'

/**
 * Multiplies every real-time wait ceiling below when running on a shared CI
 * runner (`process.env.CI`), which is measurably slower and more contended
 * than a local dev machine — a genuine environment-varying tunable, not a
 * silent magic number: each wait keeps its own local-machine value and only
 * scales up under CI.
 */
const CI_WAIT_SCALE = process.env.CI !== undefined ? 2 : 1

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

describe('pty smoke: dsh --profile tui end to end over a real pty', () => {
  let overrideDir: string

  afterAll(async () => {
    if (overrideDir !== undefined) await rm(overrideDir, { recursive: true, force: true })
  })

  it('streams a scripted turn to scrollback and restores the terminal on Ctrl-C', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-tui-app-pty-smoke-'))
    const overrideFile = join(overrideDir, 'replay.override.json')
    await writeFile(overrideFile, JSON.stringify([textEntry(FINAL_ANSWER_TEXT)]))

    const shell = pty.spawn('/bin/bash', ['--norc', '--noprofile'], {
      name: 'xterm-256color',
      cols: COLS,
      rows: ROWS,
      cwd: REPO_ROOT,
      // BASH_SILENCE_DEPRECATION_WARNING: macOS's bundled bash prints "The
      // default interactive shell is now zsh." to every interactive session
      // regardless of --norc/--noprofile (it is not sourced from an rc file);
      // silencing it keeps that noise out of `raw` so a real assertion
      // failure's diff is not padded with an unrelated banner.
      env: { ...process.env, FORCE_COLOR: '0', PS1: 'SMOKE$ ', BASH_SILENCE_DEPRECATION_WARNING: '1' },
    })

    let raw = ''
    shell.onData((chunk) => { raw += chunk })

    await delay(400) // let bash finish its own startup before the first command

    const command = `${process.execPath} --import tsx/esm ${FIXTURE} ${overrideFile}; echo ${EXIT_MARKER_PREFIX}$?___\n`
    shell.write(command)

    await waitUntil(() => raw, buffer => buffer.includes(READY_MARKER), 60_000 * CI_WAIT_SCALE)
    await delay(500) // let the first Ink frame (the empty composer) settle before typing

    shell.write('hello there')
    await delay(200)
    shell.write('\r')

    await waitUntil(() => raw, buffer => buffer.includes(FINAL_ANSWER_TEXT), 15_000 * CI_WAIT_SCALE)
    const rawAtTurnEnd = raw

    await delay(150)
    shell.write('\x03') // Ctrl-C: this bundle's tui-runner requests exit once Ink's own exitOnCtrlC path resolves

    // Wait for the disposal marker FIRST, as its own condition, rather than a
    // bare `expect().toContain()` after the exit-marker wait below: the
    // fixture prints it synchronously (from a real POSIX TTY write, which
    // Node performs synchronously) before the process exits, so it precedes
    // the exit-code echo in real program order — waiting on it directly gives
    // a full-buffer diagnostic on failure instead of vitest's default
    // truncated diff (see `packages/tui/runtime/tests/pty-smoke.client.spec.ts`'s
    // identical structure).
    await waitUntil(() => raw, buffer => buffer.includes(DISPOSED_MARKER), 15_000 * CI_WAIT_SCALE)

    // Waiting on EXIT_MARKER_PREFIX's bare text would resolve instantly and
    // wrongly: bash's own cooked-mode local echo repeats the shell command
    // (which contains the literal, unsubstituted `echo ___EXITCODE_$?___`)
    // back into the pty the moment it was typed, long before the node
    // process actually exits. The real signal is the substituted numeric
    // form, which only bash's `echo` produces after the process exits.
    const exitMarkerPattern = new RegExp(`${EXIT_MARKER_PREFIX}(\\d+)___`)
    await waitUntil(() => raw, buffer => exitMarkerPattern.test(buffer), 30_000 * CI_WAIT_SCALE)
    const exitCodeMatch = exitMarkerPattern.exec(raw)

    shell.write(`stty -a; echo ${STTY_MARKER}\n`)
    await waitUntil(() => raw, buffer => buffer.includes(STTY_MARKER), 5_000 * CI_WAIT_SCALE)
    await delay(100)

    // Skip past the echoed command line (cooked-mode local echo repeats
    // "stty -a" verbatim before it runs) to reach the real output, and take
    // the LAST marker occurrence (its actual printed line).
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
    // Each final assertion below carries the full captured `raw` as its
    // message: a bare `expect().toBe()` diff truncates a long string (vitest's
    // own default), which previously hid the real failure behind an
    // uninformative "expected '...' to contain '...'" snippet.
    expect(exitCodeMatch?.[1], `raw pty stream:\n${raw}`).toBe('0')
    expect(readSttyFlag(sttyOutput, 'icanon'), `raw pty stream:\n${raw}`).toBe(true)
    expect(readSttyFlag(sttyOutput, 'echo'), `raw pty stream:\n${raw}`).toBe(true)
  }, 120_000 * CI_WAIT_SCALE)
})
