/**
 * Semantic terminal harness for the renderer's snapshot lane: an
 * `@xterm/headless` emulator behind a fake TTY stdout/stdin pair, plus a
 * cell-level projection of what a real terminal would be showing.
 *
 * Ported — as a pattern, not verbatim — from the deleted pi-tui renderer's
 * `packages/ui/tui/tests/headless-terminal.ts` (upstream mirror, last present
 * at `10bb9cbf4a^`). What carried over unchanged is the part that has nothing
 * to do with the rendering engine: feeding one real ANSI byte stream into a
 * real emulator, projecting cells to line text plus style intervals with
 * blank-run folding, and rejecting palette output that would look different
 * under another terminal theme ({@link HeadlessTerminal.themeViolations}).
 *
 * Three things differ from that original, because the engine underneath is
 * now Ink rather than pi-tui:
 *
 * 1. **The harness is a stream pair, not a `Terminal` implementation.** pi-tui
 *    rendered through an injected `Terminal` port, so the original harness
 *    implemented that interface (`start`/`stop`/`moveBy`/`setTitle`/…) and
 *    could report lifecycle counters and the window title in its projection.
 *    Ink owns its own escape-sequence emission and only accepts
 *    `stdout`/`stdin` streams, so this harness supplies those instead and its
 *    projection carries no lifecycle or title line — there is no port to
 *    observe them on. Cursor visibility, which pi-tui reported as a port call,
 *    is instead read back from the DEC private-mode bytes Ink writes.
 * 2. **The frame boundary is Ink's own flush, not a `?2026l` count.** The
 *    original blocked on counting synchronized-output end markers, the only
 *    frame signal pi-tui exposed. Ink 7.1.1 emits those same markers (see
 *    `ink/build/write-synchronized.js`) and this harness still counts them —
 *    the count is part of the projection, and a zero count would mean the
 *    interactive synchronized-output path silently stopped running — but
 *    waiting on them would be wrong here: Ink writes a frame's markers only
 *    when `logUpdate.willRender()` says the frame differs from the last one,
 *    so an update that settles to identical output would hang a
 *    marker-counting wait for its full timeout. {@link MountedInk.settle}
 *    instead awaits `Instance.waitUntilRenderFlush()`, which flushes Ink's
 *    throttled render and log timers and then waits for the stdout write
 *    callback — a boundary that is exact for a no-op update too.
 * 3. **Color depth is forced, not inherited.** `chalk`'s auto-detected level
 *    is 0 under vitest (stdout is not a TTY), which would erase every style
 *    interval from the projection and make the theme-invariance assertion
 *    vacuous. This module raises the shared `chalk` instance — the one both
 *    `src/ansi/style.ts` and Ink's own `colorize` resolve to — to truecolor,
 *    so named colors still emit 16-color SGR codes while any hex/rgb/ansi256
 *    call would emit exactly the RGB or extended-palette codes
 *    {@link HeadlessTerminal.themeViolations} rejects.
 */

import { Console } from 'node:console'
import { EventEmitter } from 'node:events'
import type { ReactElement } from 'react'
import chalk from 'chalk'
import { Terminal as XtermTerminal, type IBufferCell } from '@xterm/headless'
import { render as inkRender, type Instance } from 'ink'

// See `tests/support/fake-tty.ts` for the full explanation: vitest's global
// `console` is a Console INSTANCE with no `.Console` static, and Ink's default
// `patchConsole: true` calls `new console.Console(...)` unconditionally. Every
// mount in this lane goes through that path (the scrollback commit depends on
// it), so the alias is restored once at import.
const consoleWithConstructor = console as unknown as { Console?: typeof Console }
if (consoleWithConstructor.Console === undefined) consoleWithConstructor.Console = Console

// Truecolor, not level 1: level 1 would downsample a stray `chalk.hex(...)`
// to a 16-color code and hide exactly the theme dependency this lane exists
// to catch. See this module's doc, point 3.
chalk.level = 3

/** Synchronized-output end marker Ink writes after each frame it actually paints. */
const FRAME_END = '\u001b[?2026l'
/** DEC private mode Ink writes when it hides the cursor. */
const CURSOR_HIDE = '\u001b[?25l'
/** DEC private mode Ink writes when it shows the cursor again. */
const CURSOR_SHOW = '\u001b[?25h'

/** Hard bound on any wait in this harness, so a stalled render fails the test instead of hanging the run. */
const SETTLE_TIMEOUT_MS = 10_000

/** Scrollback rows the emulator retains, bounding a `includeScrollback` projection. */
const SCROLLBACK_ROWS = 1_000

const ANSI_COLORS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
] as const

interface RowSnapshot {
  text: string
  wrapped: boolean
  styles: string[]
}

/** Options accepted by {@link HeadlessTerminal.snapshot}. */
export interface TerminalSnapshotOptions {
  /** Include the whole active buffer (scrollback included) instead of only the visible viewport. */
  includeScrollback?: boolean
}

/**
 * A fake TTY output stream that feeds every write into the emulator. Declares
 * `fd` and `writableLength` explicitly: `fd` for the same `process.stdout`
 * typing reason `tests/support/fake-tty.ts` documents, and `writableLength`
 * so Ink's `waitUntilRenderFlush()` takes its write-callback branch
 * (`getWritableStreamState` in `ink/build/ink.js`) rather than settling on a
 * bare macrotask yield.
 */
interface TerminalWriteStream extends NodeJS.WriteStream {
  readonly fd: 1
  readonly writableLength: number
}

/**
 * A fake TTY input stream driven by {@link TerminalReadStream.feed}. Ink
 * consumes stdin through the `'readable'` event plus a `read()` loop, so this
 * implements that exact protocol — see `tests/support/fake-tty.ts` for why a
 * `'data'` listener would never be called.
 */
interface TerminalReadStream extends NodeJS.ReadStream {
  readonly fd: 0
  /** Queue one chunk, then emit `'readable'` so Ink's `read()` loop drains it. */
  feed(chunk: string): void
}

/**
 * Race `work` against a deadline so a stalled Ink render or emulator parse
 * fails loudly instead of hanging the suite.
 * @param work - the promise to bound.
 * @param label - what is being awaited, named in the timeout error.
 * @returns `work`'s value.
 */
async function withDeadline<T>(work: Promise<T>, label: string): Promise<T> {
  let fail!: (error: Error) => void
  const guard = new Promise<never>((_resolve, reject) => { fail = reject })
  const timer = setTimeout(() => { fail(new Error(`${label} did not settle within ${SETTLE_TIMEOUT_MS}ms`)) }, SETTLE_TIMEOUT_MS)
  try {
    return await Promise.race([work, guard])
  } finally {
    clearTimeout(timer)
  }
}

function occurrenceCount(value: string, needle: string): number {
  let count = 0
  let offset = 0
  while (true) {
    const match = value.indexOf(needle, offset)
    if (match < 0) return count
    count += 1
    offset = match + needle.length
  }
}

function colorLabel(cell: IBufferCell, kind: 'fg' | 'bg'): string | undefined {
  const isDefault = kind === 'fg' ? cell.isFgDefault() : cell.isBgDefault()
  if (isDefault) return undefined
  const isRgb = kind === 'fg' ? cell.isFgRGB() : cell.isBgRGB()
  const value = kind === 'fg' ? cell.getFgColor() : cell.getBgColor()
  if (isRgb) return `${kind}=#${value.toString(16).padStart(6, '0')}`
  const name = ANSI_COLORS[value]
  return `${kind}=${name ?? `ansi-${value}`}`
}

function styleLabel(cell: IBufferCell): string {
  const labels = [
    colorLabel(cell, 'fg'),
    colorLabel(cell, 'bg'),
    cell.isBold() !== 0 ? 'bold' : undefined,
    cell.isDim() !== 0 ? 'dim' : undefined,
    cell.isItalic() !== 0 ? 'italic' : undefined,
    cell.isUnderline() !== 0 ? 'underline' : undefined,
    cell.isBlink() !== 0 ? 'blink' : undefined,
    cell.isInverse() !== 0 ? 'inverse' : undefined,
    cell.isInvisible() !== 0 ? 'invisible' : undefined,
    cell.isStrikethrough() !== 0 ? 'strike' : undefined,
    cell.isOverline() !== 0 ? 'overline' : undefined,
  ].filter((label): label is string => label !== undefined)
  return labels.join(' ')
}

function snapshotRow(terminal: XtermTerminal, row: number): RowSnapshot {
  const line = terminal.buffer.active.getLine(row)
  if (line === undefined) return { text: '', wrapped: false, styles: [] }
  const styles: string[] = []
  let activeStyle = ''
  let activeStart = 0
  for (let column = 0; column <= terminal.cols; column++) {
    const cell = column < terminal.cols ? line.getCell(column) : undefined
    const style = cell === undefined ? '' : styleLabel(cell)
    if (style === activeStyle) continue
    if (activeStyle !== '') styles.push(`${activeStart}-${column - 1} ${activeStyle}`)
    activeStyle = style
    activeStart = column
  }
  return {
    text: line.translateToString(true),
    wrapped: line.isWrapped,
    styles,
  }
}

function renderRows(rows: readonly RowSnapshot[], firstRow: number): string[] {
  const rendered: string[] = []
  let blankStart: number | undefined
  const flushBlanks = (end: number): void => {
    if (blankStart === undefined) return
    rendered.push(blankStart === end ? `${blankStart}| <blank>` : `${blankStart}-${end}| <blank>`)
    blankStart = undefined
  }
  for (let index = 0; index < rows.length; index++) {
    const absoluteRow = firstRow + index
    const row = rows[index] as RowSnapshot
    if (row.text === '' && row.styles.length === 0 && !row.wrapped) {
      blankStart ??= absoluteRow
      continue
    }
    flushBlanks(absoluteRow - 1)
    rendered.push(`${absoluteRow}${row.wrapped ? '~' : ''}| ${JSON.stringify(row.text)}`)
    for (const style of row.styles) rendered.push(`  style ${style}`)
  }
  flushBlanks(firstRow + rows.length - 1)
  return rendered
}

/**
 * A real terminal emulator behind the stdout/stdin pair an Ink instance
 * renders into. Every byte the renderer writes is parsed exactly as a user's
 * terminal would parse it, so {@link snapshot} pins what is on screen rather
 * than what the component tree intended.
 */
export class HeadlessTerminal {
  /** Stdout to hand `render()`; every write lands in the emulator. */
  readonly stdout: TerminalWriteStream
  /** Stdin to hand `render()`; drive it with `stdin.feed()`. */
  readonly stdin: TerminalReadStream
  /** Synchronized frames Ink has finished painting (its `?2026l` markers). */
  frames = 0
  private cursorVisible = true
  private readonly emulator: XtermTerminal
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(columns: number, rows: number) {
    this.emulator = new XtermTerminal({
      cols: columns,
      rows,
      scrollback: SCROLLBACK_ROWS,
      allowProposedApi: true,
      // Ink ends a frame row with a bare LF, exactly as a program writing to a
      // real TTY does: the terminal driver's own ONLCR translation supplies the
      // carriage return. `@xterm/headless` parses the raw stream with no driver
      // in front of it, so without this every frame row after the first would
      // start at the previous row's end column instead of the left margin.
      convertEol: true,
      drawBoldTextInBrightColors: false,
      logLevel: 'off',
    })
    this.stdout = createWriteStream(this, columns, rows)
    this.stdin = createReadStream()
  }

  /** Terminal width in columns. */
  get columns(): number {
    return this.emulator.cols
  }

  /** Terminal height in rows. */
  get rows(): number {
    return this.emulator.rows
  }

  /**
   * Parse one chunk of renderer output. Empty writes (Ink's own flush probe)
   * ride the existing parse chain rather than entering the emulator, whose
   * write callback is only guaranteed for non-empty data.
   * @param data - raw bytes the renderer wrote.
   * @returns the parse barrier for this chunk.
   */
  write(data: string): Promise<void> {
    this.frames += occurrenceCount(data, FRAME_END)
    const hide = data.lastIndexOf(CURSOR_HIDE)
    const show = data.lastIndexOf(CURSOR_SHOW)
    if (hide >= 0 || show >= 0) this.cursorVisible = show > hide
    if (data === '') return this.pendingWrite
    const parsed = new Promise<void>((resolve) => { this.emulator.write(data, resolve) })
    this.pendingWrite = parsed
    return parsed
  }

  /** Await every emulator parse queued so far, including any queued while waiting. */
  async flush(): Promise<void> {
    await withDeadline((async () => {
      let pending: Promise<void>
      do {
        pending = this.pendingWrite
        await pending
      } while (pending !== this.pendingWrite)
    })(), 'terminal parse queue')
  }

  /**
   * Reject palette output that would become theme-specific in a user's terminal.
   * @returns one `row:column` location per RGB, extended-palette, or explicit-background cell.
   */
  themeViolations(): string[] {
    const violations: string[] = []
    const buffer = this.emulator.buffer.active
    for (let row = 0; row < buffer.length; row++) {
      const line = buffer.getLine(row)
      if (line === undefined) continue
      for (let column = 0; column < this.columns; column++) {
        const cell = line.getCell(column)
        if (cell === undefined) continue
        const reasons = [
          cell.isFgRGB() ? 'rgb-fg' : undefined,
          cell.isBgRGB() ? 'rgb-bg' : undefined,
          cell.isFgPalette() && cell.getFgColor() > 15 ? `extended-fg-${cell.getFgColor()}` : undefined,
          cell.isBgPalette() && cell.getBgColor() > 15 ? `extended-bg-${cell.getBgColor()}` : undefined,
          !cell.isBgDefault() ? 'explicit-bg' : undefined,
        ].filter((reason): reason is string => reason !== undefined)
        if (reasons.length > 0) violations.push(`${row}:${column} ${reasons.join(',')}`)
      }
    }
    return violations
  }

  /**
   * Serialize terminal cells and metadata into a stable, reviewable expected output.
   * @param options - see {@link TerminalSnapshotOptions}.
   * @returns the projection text, one trailing newline included.
   */
  async snapshot(options: TerminalSnapshotOptions = {}): Promise<string> {
    await this.flush()
    const buffer = this.emulator.buffer.active
    const firstRow = options.includeScrollback === true ? 0 : buffer.viewportY
    const rowCount = options.includeScrollback === true ? buffer.length : this.rows
    const rows = Array.from({ length: rowCount }, (_unused, index) => snapshotRow(this.emulator, firstRow + index))
    const cursorBufferRow = buffer.baseY + buffer.cursorY
    const cursorViewportRow = cursorBufferRow - buffer.viewportY
    return [
      `terminal ${this.columns}x${this.rows} buffer=${buffer.type} length=${buffer.length} base=${buffer.baseY} viewport=${buffer.viewportY}`,
      `frames synchronized=${this.frames}`,
      `cursor ${this.cursorVisible ? 'visible' : 'hidden'} column=${buffer.cursorX} viewportRow=${cursorViewportRow} bufferRow=${cursorBufferRow}`,
      options.includeScrollback === true ? 'buffer' : 'viewport',
      ...renderRows(rows, firstRow),
      '',
    ].join('\n')
  }

  /** Drain the parse queue and release the emulator. */
  async dispose(): Promise<void> {
    await this.flush()
    this.emulator.dispose()
  }
}

function createWriteStream(terminal: HeadlessTerminal, columns: number, rows: number): TerminalWriteStream {
  const emitter = new EventEmitter() as unknown as TerminalWriteStream
  Object.assign(emitter, {
    columns,
    rows,
    isTTY: true,
    fd: 1,
    writableLength: 0,
    write: (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      const callback = rest.at(-1)
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      const parsed = terminal.write(text)
      if (typeof callback === 'function') void parsed.then(() => { (callback as () => void)() })
      return true
    },
  })
  return emitter
}

function createReadStream(): TerminalReadStream {
  const emitter = new EventEmitter() as unknown as TerminalReadStream
  const queue: Buffer[] = []
  Object.assign(emitter, {
    isTTY: true,
    fd: 0,
    setEncoding: () => {},
    setRawMode: () => {},
    resume: () => {},
    pause: () => {},
    ref: () => {},
    unref: () => {},
    read: (): Buffer | null => queue.shift() ?? null,
    feed: (chunk: string): void => {
      queue.push(Buffer.from(chunk))
      emitter.emit('readable')
    },
  })
  return emitter
}

/** An Ink application mounted over a {@link HeadlessTerminal}. */
export interface MountedInk {
  /**
   * Replace the rendered element and settle the resulting frame.
   * @param element - the next root element.
   */
  rerender(element: ReactElement): Promise<void>
  /**
   * Deliver raw input bytes as a user's keystrokes and settle the result.
   * @param input - the bytes to feed Ink's stdin.
   */
  type(input: string): Promise<void>
  /** Settle every pending render and emulator parse (see this module's doc, point 2). */
  settle(): Promise<void>
  /** Unmount Ink — restoring the console it patched — and release the emulator. */
  dispose(): Promise<void>
}

/**
 * Mount an Ink application over a headless terminal, with the real
 * interactive path the renderer ships on: synchronized output, cursor
 * control, and `patchConsole` (the mechanism `scrollback/commit.ts` commits
 * through). `interactive` is forced rather than detected because Ink treats
 * any CI environment as non-interactive regardless of `isTTY`, which would
 * drop every escape sequence this lane exists to observe.
 * @param terminal - the terminal to render into.
 * @param element - the initial root element.
 * @returns the mounted application handle.
 */
export async function mountInk(terminal: HeadlessTerminal, element: ReactElement): Promise<MountedInk> {
  const instance: Instance = inkRender(element, {
    stdout: terminal.stdout,
    stdin: terminal.stdin,
    interactive: true,
  })

  async function settle(): Promise<void> {
    // Twice: the first pass flushes the render Ink already has queued, the
    // second covers a passive effect (a spinner tick, a composer state
    // update from a keystroke) that pass released. Each is individually
    // deadline-bounded.
    for (let pass = 0; pass < 2; pass++) {
      await withDeadline(instance.waitUntilRenderFlush(), 'ink render flush')
      await terminal.flush()
    }
  }

  await settle()

  return {
    async rerender(next: ReactElement): Promise<void> {
      instance.rerender(next)
      await settle()
    },
    async type(input: string): Promise<void> {
      terminal.stdin.feed(input)
      await settle()
    },
    settle,
    async dispose(): Promise<void> {
      instance.unmount()
      // `settle()`, not `waitUntilExit()`: on an unmounting instance
      // `waitUntilRenderFlush()` awaits the same exit promise internally, while
      // `waitUntilExit()` also registers a process `beforeExit` listener that
      // would accumulate one per mount across a whole checkpoint matrix.
      await settle()
      await terminal.dispose()
    },
  }
}
