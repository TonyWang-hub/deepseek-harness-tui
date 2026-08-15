/**
 * The one-line stdout protocol between `resident-state.perf.client.ts` and
 * the `rss-probe.client.ts` child process it spawns.
 *
 * A module of its own because the probe's own module body IS its main: it
 * reads `process.argv` and measures at import time, so a parent that imported
 * the probe for its marker would run the probe inside the test process. This
 * module carries no side effects.
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/probe-protocol
 */

/** Marker the parent greps the probe's JSON result out of its stdout by. */
export const PROBE_RESULT_MARKER = '___DSH_TUI_PERF_PROBE___'

/** One probe's measurement. */
export interface ProbeResult {
  /** Which composition was measured. */
  readonly mode: 'headless' | 'render'
  /** Resident set size in bytes after the corpus settled. */
  readonly rss: number
  /** V8 heap in use in bytes after the corpus settled. */
  readonly heapUsed: number
  /** Bytes outside the V8 heap (buffers, native). */
  readonly external: number
  /** Client-side retained-state counters (see `retainedState`). */
  readonly retained: Readonly<Record<string, string | number>>
  /** Non-empty lines in the renderer's last frame; `-1` in headless mode. */
  readonly liveRegionLines: number
}
