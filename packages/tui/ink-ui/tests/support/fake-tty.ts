/**
 * Minimal fake TTY streams for `render.ts` orchestration tests: unlike
 * `ink-testing-library`'s own `render()` wrapper (used for isolated
 * component tests below), these are passed directly to `mountTuiRenderer`'s
 * `stdout`/`stdin` options so a test can exercise the REAL `patchConsole:
 * true` path `render.ts` relies on for the Q1-proven scrollback commit
 * (`ink-testing-library` hardcodes `patchConsole: false`, which would defer
 * the very mechanism these tests need to observe). Modeled on
 * `ink-testing-library`'s own fake-stream shapes (`node_modules/ink-testing-library/build/index.js`).
 */
import { Console } from 'node:console'
import { EventEmitter } from 'node:events'

// Vitest replaces `globalThis.console` with its own captured-output Console
// INSTANCE, which — unlike Node's real global `console` — has no `.Console`
// static property (that alias exists only on Node's bootstrap-provided
// singleton, not on the `Console` class itself). Ink's `patchConsole` calls
// `new console.Console(stdout, stderr)` (`patch-console`'s own
// implementation) unconditionally whenever `render()`'s default
// `patchConsole: true` is in effect, so a real `mountTuiRenderer()` mount
// under vitest throws `console.Console is not a constructor` unless this is
// restored. A module-level side effect (not a per-test hook) because every
// spec that imports this fake-TTY support module mounts a real Ink instance.
const consoleWithConstructor = console as unknown as { Console?: typeof Console }
if (consoleWithConstructor.Console === undefined) consoleWithConstructor.Console = Console

/**
 * A fake output stream that accumulates every `write()` call's raw text.
 * Declares its own `fd` (not inherited from `NodeJS.WriteStream`, which
 * leaves it optional): `vi.spyOn(process, 'stdout', 'get')` targets
 * `NodeJS.WriteStream & { fd: 1 }`, `process.stdout`'s exact type, which
 * `exactOptionalPropertyTypes` then requires this fake to satisfy exactly.
 */
export interface FakeWriteStream extends NodeJS.WriteStream {
  /** All text written so far, concatenated in write order. */
  readonly buffer: string
  readonly fd: 1
}

/**
 * Create a fake TTY output stream.
 * @param columns - reported terminal width.
 * @param rows - reported terminal height.
 * @returns the fake stream.
 */
export function createFakeStdout(columns = 80, rows = 24): FakeWriteStream {
  const emitter = new EventEmitter() as unknown as FakeWriteStream
  let accumulated = ''
  Object.defineProperty(emitter, 'buffer', { get: () => accumulated })
  Object.assign(emitter, {
    columns,
    rows,
    isTTY: true,
    fd: 1,
    write: (chunk: string | Uint8Array): boolean => {
      accumulated += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    },
  })
  return emitter
}

/**
 * A fake input stream a test feeds via its own {@link FakeReadStream.feed}.
 * Ink's own input loop (`ink/build/components/App.js`) consumes stdin
 * through the readable-stream `'readable'` event plus a `read()` loop, NOT a
 * raw `'data'` listener — this fake must implement that exact protocol
 * (queue the fed chunk, emit `'readable'`, and answer `read()` with the
 * queued chunk then `null`) or Ink never sees any input at all. `feed()`,
 * not `push()`: `NodeJS.ReadStream` already declares a real `push(chunk):
 * boolean` (the Readable-stream internal buffering method) that a same-named
 * member here would incompatibly override. Declares its own `fd` for the
 * same `process.stdin`-typing reason as {@link FakeWriteStream}'s.
 */
export interface FakeReadStream extends NodeJS.ReadStream {
  readonly fd: 0
  /** Queue one chunk, then emit `'readable'` so Ink's `read()` loop drains it. */
  feed(chunk: string): void
}

/**
 * Create a fake TTY input stream.
 * @returns the fake stream.
 */
export function createFakeStdin(): FakeReadStream {
  const emitter = new EventEmitter() as unknown as FakeReadStream
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
