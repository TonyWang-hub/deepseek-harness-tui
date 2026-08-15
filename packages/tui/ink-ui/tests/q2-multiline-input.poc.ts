/**
 * Q2 reconnaissance PoC: can a from-scratch multiline input handle the two
 * concrete difficulties the Agent Note's "Risks" section names — asymmetric
 * first-line/continuation-line prefix widths, and CJK-aware column
 * wrapping — with the real terminal cursor (not a fake inverse-video block)
 * tracking the caret?
 *
 * Drives `fixtures/q2-multiline-input-app.tsx` under a real pty at a
 * deliberately narrow width (20 columns) so both prefix classes and
 * width-driven wrapping are exercised in one pass, sends a keystroke script
 * chosen so the expected caret position and wrapped rows can be hand-derived
 * (worked in this file's `EXPECATIONS` comment below), and checks the
 * projected screen and the real xterm cursor against that derivation. It
 * then dumps the fixture's internal logical-line model (Ctrl+D) to check the
 * edit model independently of rendering.
 *
 * NOT a vitest spec — see `q1-scrollback-commit.poc.ts`'s module doc for why.
 * Run manually:
 *
 *   pnpm exec tsx packages/tui/ink-ui/tests/q2-multiline-input.poc.ts
 */
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import * as pty from 'node-pty'
import xtermHeadless from '@xterm/headless'

const { Terminal } = xtermHeadless

const FIXTURE = fileURLToPath(new URL('./fixtures/q2-multiline-input-app.tsx', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const COLUMNS = 20
const ROWS = 12
const KEYSTROKE_DELAY_MS = 30

interface Assertion {
  readonly description: string
  readonly pass: boolean
  readonly detail?: string
}

/*
 * EXPECTATIONS (hand-derived; see fixture module doc for the layout algorithm):
 *
 * FIRST_PREFIX = '❯ ' (width 2), CONTINUATION_PREFIX = '    ' (width 4).
 * First-row budget = 20 - 2 = 18. Continuation-row budget = 20 - 4 = 16.
 *
 * Keystrokes: "你好ab" (widths 2,2,1,1 = 6, fits row 0), Ctrl+J (new logical
 * line), "0123456789ABCDEFGHIJ" (20 ASCII chars on the new, non-first,
 * logical line — continuation budget 16 wraps it into "0123456789ABCDEF"
 * (16) + "GHIJ" (4)), then 3x leftArrow (caret column 20 -> 17).
 *
 * Expected rendered rows:
 *   row 0: "❯ 你好ab"
 *   row 1: "    0123456789ABCDEF"  (4 + 16 = 20 columns, exactly fills the row)
 *   row 2: "    GHIJ"
 *
 * Expected caret after the 3 leftArrows: logical (row 1, col 17), which maps
 * to display row 2 (the second wrap segment, chars 16..20), position 17-16=1
 * into "GHIJ" -> cursorX = 4 (continuation prefix) + 1 ("G") = 5, cursorY = 2.
 *
 * Expected Ctrl+D dump: `["你好ab", "0123456789ABCDEFGHIJ"]`.
 */
const EXPECTED_ROWS = ['❯ 你好ab', '    0123456789ABCDEF', '    GHIJ']
const EXPECTED_CURSOR = { x: 5, y: 2 }
const EXPECTED_DUMP = ['你好ab', '0123456789ABCDEFGHIJ']

async function projectScreen(raw: string): Promise<{ rows: string[]; cursorX: number; cursorY: number }> {
  const terminal = new Terminal({ cols: COLUMNS, rows: ROWS, scrollback: 100, allowProposedApi: true })
  await new Promise<void>((resolve) => { terminal.write(raw, resolve) })
  const buffer = terminal.buffer.active
  const rows: string[] = []
  for (let row = 0; row < ROWS; row++) {
    const line = buffer.getLine(row)
    const text = line ? line.translateToString(true) : ''
    if (text.trim() !== '') rows.push(text)
  }
  const cursorX = buffer.cursorX
  const cursorY = buffer.cursorY
  terminal.dispose()
  return { rows, cursorX, cursorY }
}

async function main(): Promise<void> {
  const child = pty.spawn(process.execPath, ['--import', 'tsx/esm', FIXTURE, String(COLUMNS)], {
    name: 'xterm-256color',
    cols: COLUMNS,
    rows: ROWS,
    cwd: REPO_ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
  })

  let raw = ''
  child.onData((chunk) => { raw += chunk })

  await delay(1500) // let tsx transpile + Ink/React/yoga boot and the first frame render
  child.write('你好ab')
  await delay(KEYSTROKE_DELAY_MS)
  child.write('\n') // Ctrl+J equivalent byte (LF) — see fixture module doc
  await delay(KEYSTROKE_DELAY_MS)
  child.write('0123456789ABCDEFGHIJ')
  await delay(KEYSTROKE_DELAY_MS)
  child.write('[D[D[D') // 3x leftArrow
  await delay(200)

  const preDumpRaw = raw
  const screen = await projectScreen(preDumpRaw)

  const dumpMarkerIndex = raw.length
  child.write('\x04') // Ctrl+D: dump lines as JSON and exit
  const exited = new Promise<void>((resolve) => { child.onExit(() => { resolve() }) })
  await Promise.race([exited, delay(5_000)])
  await delay(100)
  const dumpPortion = raw.slice(dumpMarkerIndex)

  const assertions: Assertion[] = []

  assertions.push({
    description: 'rendered rows match the hand-derived wrap (asymmetric prefixes + CJK-aware width)',
    pass: JSON.stringify(screen.rows) === JSON.stringify(EXPECTED_ROWS),
    detail: `actual=${JSON.stringify(screen.rows)} expected=${JSON.stringify(EXPECTED_ROWS)}`,
  })

  assertions.push({
    description: 'row 1 (continuation wrap) is exactly 20 columns — the continuation budget boundary lands with no overflow or off-by-one',
    pass: screen.rows[1] !== undefined && screen.rows[1].length === COLUMNS,
    detail: `row1.length=${screen.rows[1]?.length}`,
  })

  assertions.push({
    description: 'real xterm cursor position matches the hand-derived caret after 3x leftArrow',
    pass: screen.cursorX === EXPECTED_CURSOR.x && screen.cursorY === EXPECTED_CURSOR.y,
    detail: `actual=(${screen.cursorX},${screen.cursorY}) expected=(${EXPECTED_CURSOR.x},${EXPECTED_CURSOR.y})`,
  })

  let dumpedLines: unknown
  try {
    // The JSON dump shares its raw pty line with Ink's teardown escape codes
    // (cursor-hide, clear-N-lines, column-reset all land before the '[' on
    // the same physical line — Ink never inserts a newline before console
    // output it did not write itself). Strip CSI/OSC sequences first so the
    // bracket search does not need to assume line-start placement.
    const stripped = dumpPortion.replaceAll(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    const match = /\[".*"\]/.exec(stripped)
    dumpedLines = match ? JSON.parse(match[0]) : undefined
  } catch (error) {
    dumpedLines = `<parse error: ${String(error)}>`
  }
  assertions.push({
    description: 'internal logical-line model (Ctrl+D dump) matches the keystroke script independent of rendering',
    pass: JSON.stringify(dumpedLines) === JSON.stringify(EXPECTED_DUMP),
    detail: `actual=${JSON.stringify(dumpedLines)} expected=${JSON.stringify(EXPECTED_DUMP)}`,
  })

  for (const assertion of assertions) {
    console.log(`${assertion.pass ? 'PASS' : 'FAIL'} - ${assertion.description}${assertion.detail ? ` (${assertion.detail})` : ''}`)
  }
  const failures = assertions.filter(assertion => !assertion.pass)
  if (failures.length > 0) {
    console.log(`\nQ2 VERDICT: FAIL (${failures.length}/${assertions.length} assertions failed)`)
    process.exitCode = 1
    return
  }
  console.log('\nQ2 VERDICT: PASS')
}

await main()
