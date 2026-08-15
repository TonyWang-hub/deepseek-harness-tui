/**
 * Shared measurement harness for the terminal performance gate: controlled
 * TTY streams the renderer mounts on, corpus materialization into a real
 * persistence root, and the reporting helpers every shard prints its table
 * with.
 *
 * The renderer is mounted on a **controlled stdout** rather than an
 * `@xterm/headless` terminal. `mountTuiRenderer` already accepts
 * `stdout`/`stdin` overrides, and every metric this gate measures is a
 * property of what the renderer *writes* and when (echo latency, live-region
 * size), not of how a terminal emulator would lay those bytes out — an
 * emulator in the loop would add its own parse cost to every latency sample
 * and measure xterm, not the renderer. Semantic terminal projection is the
 * snapshot lane's job, not this gate's.
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/harness
 */

import { Console } from 'node:console'
import { EventEmitter } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import { parseCorpus, realizeCorpus } from './corpus.client.ts'

// Vitest replaces `globalThis.console` with its own captured-output Console
// INSTANCE, which has no `.Console` static property; Ink's default
// `patchConsole: true` calls `new console.Console(stdout, stderr)`
// unconditionally, so a real `mountTuiRenderer()` mount under vitest throws
// `console.Console is not a constructor` unless this is restored. Same
// module-level side effect as `packages/tui/ink-ui/tests/support/fake-tty.ts`,
// duplicated here deliberately: this gate must not import that package's test
// tree (a parallel lane owns it).
const consoleWithConstructor = console as unknown as { Console?: typeof Console }
if (consoleWithConstructor.Console === undefined) consoleWithConstructor.Console = Console

/** A controlled output stream that records every write and notifies observers synchronously. */
export interface PerfWriteStream extends NodeJS.WriteStream {
  /** Everything written so far, concatenated in write order. */
  readonly buffer: string
  /** The most recent `write()` call's raw text, cursor-only writes included. */
  readonly lastWrite: string
  /**
   * The most recent `write()` whose ANSI-stripped text is non-empty — the
   * last rendered frame. Ink's `log-update` repaints the whole live region in
   * one write when the frame content changes, but follows it with
   * cursor-only writes when only the cursor moved, so `lastWrite` alone is
   * not the frame.
   */
  readonly lastFrame: string
  /** Number of `write()` calls so far. */
  readonly writeCount: number
  /** File descriptor, declared so this satisfies `process.stdout`'s exact type. */
  readonly fd: 1
  /**
   * Observe every subsequent write.
   * @param listener - called synchronously with the decoded chunk.
   * @returns an unsubscribe function.
   */
  onWrite(listener: (chunk: string) => void): () => void
  /** Drop the accumulated buffer (keeps observers attached). */
  reset(): void
}

/** A controlled input stream driven by {@link PerfReadStream.feed}. */
export interface PerfReadStream extends NodeJS.ReadStream {
  /** File descriptor, declared for the same `process.stdin`-typing reason as {@link PerfWriteStream.fd}. */
  readonly fd: 0
  /**
   * Queue one chunk, then emit `'readable'` so Ink's `read()` loop drains it.
   * `feed`, not `push`: `NodeJS.ReadStream` already declares a real
   * `push(chunk): boolean`.
   * @param chunk - the raw bytes to deliver as one keypress event.
   */
  feed(chunk: string): void
}

/**
 * Create a controlled TTY output stream.
 * @param columns - reported terminal width.
 * @param rows - reported terminal height.
 * @returns the stream.
 */
export function createPerfStdout(columns = 120, rows = 40): PerfWriteStream {
  const emitter = new EventEmitter() as unknown as PerfWriteStream
  let accumulated = ''
  let last = ''
  let lastFrame = ''
  let writes = 0
  const listeners = new Set<(chunk: string) => void>()
  Object.defineProperty(emitter, 'buffer', { get: () => accumulated })
  Object.defineProperty(emitter, 'lastWrite', { get: () => last })
  Object.defineProperty(emitter, 'lastFrame', { get: () => lastFrame })
  Object.defineProperty(emitter, 'writeCount', { get: () => writes })
  Object.assign(emitter, {
    columns,
    rows,
    isTTY: true,
    fd: 1,
    write: (chunk: string | Uint8Array): boolean => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      accumulated += text
      last = text
      if (stripAnsi(text).trim() !== '') lastFrame = text
      writes += 1
      for (const listener of listeners) listener(text)
      return true
    },
    onWrite: (listener: (chunk: string) => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reset: (): void => {
      accumulated = ''
    },
  })
  return emitter
}

/**
 * Create a controlled TTY input stream.
 * @returns the stream.
 */
export function createPerfStdin(): PerfReadStream {
  const emitter = new EventEmitter() as unknown as PerfReadStream
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

// CSI/OSC/DCS escape sequences Ink writes around every frame; stripped before
// a frame is matched or its lines counted, so a metric measures rendered text
// rather than cursor bookkeeping.
const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -\/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_])/gu

/**
 * Strip ANSI escape sequences from terminal output.
 * @param text - raw terminal bytes as a string.
 * @returns the same text with escape sequences removed.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

/** The Host `SessionPersistence` members this harness calls, reached structurally. */
interface SessionPersistenceLike {
  create(meta: Record<string, unknown>): Promise<void>
  append(id: string, events: readonly unknown[]): Promise<void>
}

/**
 * Materialize a generated corpus into a booted Host tree's persistence root
 * as one cold, resumable session.
 *
 * Reached through `ctx.get('sessionPersistence')` with the local structural
 * type above rather than an import of `@deepseek-ai/dsh-session-persistence`:
 * that package's root merges Host-only services into the cordis `Context`,
 * and this file belongs to the CLIENT typecheck aggregate — the same
 * `HostConnectionLike` pattern `packages/tui/runtime/src/types.ts` already
 * uses for the one Host member the plugin itself calls.
 * @param ctx - a booted Host tree root context.
 * @param corpusText - generated corpus text with `{{sessionId}}`/`{{cwd}}` placeholders.
 * @param sessionId - the session id to stamp and create.
 * @param cwd - the workspace directory to stamp into the header.
 * @param batchSize - events per `append` call; bounds peak serialization memory.
 * @returns the number of events written.
 */
export async function seedCorpusSession(
  ctx: Context,
  corpusText: string,
  sessionId: string,
  cwd: string,
  batchSize = 5_000,
): Promise<number> {
  const persistence = ctx.get('sessionPersistence') as SessionPersistenceLike | undefined
  if (persistence === undefined) throw new Error('seedCorpusSession: the booted tree provides no sessionPersistence')
  const { header, events } = parseCorpus(realizeCorpus(corpusText, sessionId, cwd))
  const { type: _headerTag, ...meta } = header
  await persistence.create(meta)
  for (let offset = 0; offset < events.length; offset += batchSize) {
    await persistence.append(sessionId, events.slice(offset, offset + batchSize))
  }
  return events.length
}

/**
 * Wait until a predicate holds, polling on an interval, with a hard timeout.
 * Every wait in this gate is bounded: a hung benchmark must fail its shard,
 * never hang the run.
 * @param predicate - checked immediately and then on each interval.
 * @param options - timeout, poll interval, and a label for the failure message.
 * @returns milliseconds elapsed until the predicate first held.
 */
export async function waitUntil(
  predicate: () => boolean,
  options: { readonly timeoutMs: number; readonly intervalMs?: number; readonly label: string },
): Promise<number> {
  const startedAt = performance.now()
  const interval = options.intervalMs ?? 5
  for (;;) {
    if (predicate()) return performance.now() - startedAt
    if (performance.now() - startedAt > options.timeoutMs) {
      throw new Error(`waitUntil: ${options.label} did not hold within ${String(options.timeoutMs)}ms`)
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
}

/**
 * Wait for the renderer to write output matching a predicate, measuring the
 * latency from now to that write.
 * @param stdout - the controlled output stream the renderer is mounted on.
 * @param matches - tested against the ANSI-stripped text written since this call.
 * @param options - timeout and a label for the failure message.
 * @returns milliseconds from this call to the matching write.
 */
export function waitForOutput(
  stdout: PerfWriteStream,
  matches: (recent: string) => boolean,
  options: { readonly timeoutMs: number; readonly label: string },
): Promise<number> {
  const startedAt = performance.now()
  return new Promise((resolve, reject) => {
    let recent = ''
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`waitForOutput: ${options.label} did not appear within ${String(options.timeoutMs)}ms`))
    }, options.timeoutMs)
    const settle = (): void => {
      clearTimeout(timer)
      unsubscribe()
      resolve(performance.now() - startedAt)
    }
    const unsubscribe = stdout.onWrite((chunk) => {
      recent += stripAnsi(chunk)
      if (matches(recent)) settle()
    })
  })
}

/**
 * Percentile of a sample set, by nearest-rank on the sorted values.
 * @param samples - the raw samples (not required to be sorted).
 * @param percentile - the percentile in `[0, 100]`.
 * @returns the sample at that percentile, or `NaN` for an empty set.
 */
export function percentileOf(samples: readonly number[], percentile: number): number {
  if (samples.length === 0) return Number.NaN
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil((percentile / 100) * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!
}

/** One measured metric beside its Agent Note threshold. */
export interface MetricRow {
  /** Metric name as the Agent Note states it. */
  readonly metric: string
  /** Measured value, already formatted with its unit. */
  readonly measured: string
  /** The Note's stated threshold, or `'—'` where the Note states none. */
  readonly threshold: string
  /** `'PASS'`, `'FAIL'`, or `'REPORT'` when there is no threshold to judge against. */
  readonly verdict: 'PASS' | 'FAIL' | 'REPORT'
}

/**
 * Print one shard's metric table. Written straight to `process.stdout`
 * (the perf lane sets `disableConsoleIntercept`), so a table survives even
 * when a later assertion in the same shard fails.
 * @param title - the shard's title.
 * @param rows - the measured metrics.
 */
export function reportMetrics(title: string, rows: readonly MetricRow[]): void {
  const lines = [
    '',
    `### ${title}`,
    '',
    '| metric | measured | Note threshold | verdict |',
    '| --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.metric} | ${row.measured} | ${row.threshold} | ${row.verdict} |`),
    '',
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}

/**
 * Print an arbitrary key/value block beside a metric table (corpus shape,
 * environment facts).
 * @param title - the block's title.
 * @param facts - the key/value pairs.
 */
export function reportFacts(title: string, facts: Readonly<Record<string, string | number>>): void {
  const lines = [
    '',
    `### ${title}`,
    '',
    ...Object.entries(facts).map(([key, value]) => `- ${key}: ${String(value)}`),
    '',
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}
