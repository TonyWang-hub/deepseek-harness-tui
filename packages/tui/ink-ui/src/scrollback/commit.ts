/**
 * Commit a closed step's rendered lines to the real terminal scrollback. The
 * Q1 reconnaissance PoC (`tests/q1-scrollback-commit.poc.ts`) proved the ONE
 * mechanism that keeps Ink's live-region cursor bookkeeping synchronized
 * with the real cursor: routing the commit through `console.log()`, which
 * `render()`'s default `patchConsole: true` reroutes through
 * `Ink#writeToStdout` — clear, write, then `restoreLastOutput()` to repaint
 * the live region immediately. A hand-rolled `instance.clear()` +
 * `process.stdout.write()` (the naive reading of the design) was proven to
 * desync and lose committed lines; see the PoC's README section ("Q1") for
 * the full evidence.
 *
 * This function must only be called while an Ink instance created with
 * `patchConsole: true` (the default `render()` behavior) is mounted; before
 * mount or after unmount, `console.log` is the unpatched native function and
 * this call is an ordinary (harmless, but not scrollback-synchronized) log
 * line.
 * @module @deepseek-ai/dsh-tui-ink-ui/scrollback/commit
 */

/**
 * Commit one closed step's lines to scrollback.
 * @param lines - the step's rendered lines (from `transcript/node-lines.ts` or `transcript/tool-cards.ts`); joined with `\n`.
 */
export function commitToScrollback(lines: readonly string[]): void {
  if (lines.length === 0) return
  console.log(lines.join('\n'))
}
