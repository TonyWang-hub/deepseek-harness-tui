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
const BUNDLED_ANSWER_TEXT = 'PTY smoke: the bundled-write turn streamed and committed to scrollback.'
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

describe('pty smoke: mountTuiRenderer end to end over a real pty', () => {
  let overrideDir: string

  afterAll(async () => {
    if (overrideDir !== undefined) await rm(overrideDir, { recursive: true, force: true })
  })

  it('streams a scripted turn to scrollback and restores the terminal on Ctrl-C', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-tui-pty-smoke-'))
    const overrideFile = join(overrideDir, 'replay.override.json')
    // Two scripted replies, consumed in call order by the SAME session: the
    // first serves the split-write turn below, the second serves the
    // bundled-write regression turn — one real Loader boot for both, rather
    // than paying a second full boot's cost for a second pty test.
    await writeFile(overrideFile, JSON.stringify([textEntry(FINAL_ANSWER_TEXT), textEntry(BUNDLED_ANSWER_TEXT)]))

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

    await waitUntil(() => raw, buffer => buffer.includes(READY_MARKER), 40_000 * CI_WAIT_SCALE)
    await delay(500) // let the first Ink frame (the empty composer) settle before typing

    shell.write('hello there')
    await delay(200)
    shell.write('\r')

    await waitUntil(() => raw, buffer => buffer.includes(FINAL_ANSWER_TEXT), 15_000 * CI_WAIT_SCALE)
    const rawAtTurnEnd = raw

    // REGRESSION for the "text stuck in the composer, zero response" product
    // bug: a real deterministic repro (`. .env && node /tmp/tui-demo.mjs`
    // against the real DeepSeek API) sent the prompt and its trailing Enter
    // as ONE `node-pty` `write()` call — unlike the turn just above, which
    // deliberately writes the text and `\r` as TWO SEPARATE `shell.write()`
    // calls with a delay between them. That split means every pty smoke run
    // before this addition always handed Ink a lone, unmerged `\r` — the one
    // case Ink's own `parseKeypress` recognizes as `key.return` — and never
    // exercised the merged-event path a real fast burst or a scripted/pasted
    // send produces.
    //
    // Root cause (fixed in `@deepseek-ai/dsh-tui-ink-ui`'s
    // `input/edit-model.ts`): Ink's input parser (`ink/build/input-parser.js`)
    // only splits a raw stdin chunk on escape sequences and backspace bytes;
    // a plain run with an embedded or trailing `\r` reaches `useInput`'s
    // handler as ONE event with `key.return` unset, and the composer used to
    // insert that whole run — Enter byte included — as literal text instead
    // of submitting. `foldKeypressEvent` now walks a merged run
    // character-by-character so a `\r` inside it still submits.
    await delay(200)
    shell.write('bundled prompt\r') // text and Enter in ONE write, no delay between them
    await waitUntil(() => raw, buffer => buffer.includes(BUNDLED_ANSWER_TEXT), 15_000 * CI_WAIT_SCALE)
    const rawAfterBundledTurn = raw
    expect(rawAfterBundledTurn).toContain(BUNDLED_ANSWER_TEXT)
    // The submitted prompt text itself must not still be sitting in the
    // composer row below the streamed answer (the bug's exact symptom).
    const composerRowAfterBundledTurn = rawAfterBundledTurn.slice(
      rawAfterBundledTurn.lastIndexOf(BUNDLED_ANSWER_TEXT) + BUNDLED_ANSWER_TEXT.length,
    )
    expect(composerRowAfterBundledTurn).not.toContain('bundled prompt')

    await delay(150)
    shell.write('\x03') // Ctrl-C: Ink's own exitOnCtrlC path

    // Wait for the disposal marker FIRST, as its own condition: the fixture
    // prints it synchronously (from a real POSIX TTY write, which Node
    // performs synchronously) before `main()` returns and the process exits,
    // strictly before bash's chained `echo` can run — so this ordering is a
    // real program-order guarantee, not a race. Bare `buffer.includes(EXIT_MARKER_PREFIX)`
    // (the previous check here) was a genuine test bug, not an environment
    // one: bash's cooked-mode local echo repeats the shell command — which
    // contains the literal, unsubstituted text `echo ___EXITCODE_$?___` — back
    // into the pty the instant it was typed, long before the node process
    // even starts, let alone exits. That made the old wait resolve
    // immediately and let this disposal check run as a genuine race against
    // real completion, which a slower CI runner loses. Waiting on the
    // disposal marker directly removes that race instead of only papering
    // over it with a longer sleep.
    await waitUntil(() => raw, buffer => buffer.includes(DISPOSED_MARKER), 15_000 * CI_WAIT_SCALE)

    // The real exit-code signal is the SUBSTITUTED numeric form; matching it
    // (not the bare prefix) also avoids the same cooked-mode-echo false match.
    const exitMarkerPattern = new RegExp(`${EXIT_MARKER_PREFIX}(\\d+)___`)
    await waitUntil(() => raw, buffer => exitMarkerPattern.test(buffer), 15_000 * CI_WAIT_SCALE)
    const exitCodeMatch = exitMarkerPattern.exec(raw)

    shell.write(`stty -a; echo ${STTY_MARKER}\n`)
    await waitUntil(() => raw, buffer => buffer.includes(STTY_MARKER), 5_000 * CI_WAIT_SCALE)
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
    // Each final assertion below carries the full captured `raw` as its
    // message: a bare `expect().toBe()` diff truncates a long string (vitest's
    // own default), which previously hid the real failure behind an
    // uninformative "expected '...' to contain '...'" snippet — see this
    // suite's own module doc and the near-identical note in
    // `packages/bundle/tui-app/tests/pty-smoke.spec.ts`.
    expect(exitCodeMatch?.[1], `raw pty stream:\n${raw}`).toBe('0')
    expect(readSttyFlag(sttyOutput, 'icanon'), `raw pty stream:\n${raw}`).toBe(true)
    expect(readSttyFlag(sttyOutput, 'echo'), `raw pty stream:\n${raw}`).toBe(true)
  }, 90_000 * CI_WAIT_SCALE)
})
