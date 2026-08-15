/**
 * Q1 reconnaissance fixture — see `../q1-scrollback-commit.poc.ts`.
 *
 * Renders a bounded "live region" (one line: the running step) and, on a
 * timer, "commits" a step the way the Agent Note's Rendering section
 * proposes instead of `<Static>`: push the completed line straight into the
 * terminal's own scrollback and let the live region repaint below it, with
 * no growing history kept inside Ink (unlike `<Static>`, whose
 * `fullStaticOutput` string in `ink/build/ink.js`'s `onRender` accumulates
 * every child forever).
 *
 * Two commit strategies, selected by `argv[3]`:
 *
 * - `raw-write` (the naive reading of the Note): call `instance.clear()`,
 *   then `process.stdout.write()` the committed line directly, and let the
 *   next state-driven render repaint the live region.
 * - `console-log` (Ink's own idiom): call `console.log()`. `render()`
 *   defaults `patchConsole: true`, which routes console output through
 *   `Ink#writeToStdout` (`ink/build/ink.js`) — the exact clear/write/restore
 *   sequence `raw-write` hand-rolls, except it also calls
 *   `restoreLastOutput()` before returning, which replays the live region
 *   immediately so log-update's own cursor bookkeeping never drifts from
 *   the real cursor position.
 */
import process from 'node:process'
import React, { useEffect, useState } from 'react'
import { render, Text } from 'ink'

const TOTAL_STEPS = Number(process.argv[2] ?? '5')
const MODE = process.argv[3] === 'console-log' ? 'console-log' : 'raw-write'
const STEP_DELAY_MS = 120

function commit(stepIndex: number): void {
  const line = `✓ committed step ${stepIndex}`
  if (MODE === 'console-log') {
    console.log(line)
    return
  }
  instance.clear()
  process.stdout.write(`${line}\n`)
}

function App(): React.JSX.Element {
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (stepIndex >= TOTAL_STEPS) {
      // Marker the driver waits for before it starts reading the pty buffer.
      process.stdout.write('___POC_ALL_DONE___\n')
      const timer = setTimeout(() => { instance.unmount() }, 30)
      return () => { clearTimeout(timer) }
    }
    const timer = setTimeout(() => {
      commit(stepIndex)
      setStepIndex(index => index + 1)
    }, STEP_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [stepIndex])

  return <Text>{`▶ running step ${stepIndex} of ${TOTAL_STEPS}...`}</Text>
}

// `instance` is read from `commit()`/`App`'s effect, but only once those
// closures actually run (asynchronously, on a timer) — well after this
// assignment below has executed, so the module-level `const` here is not a
// temporal-dead-zone read from the closures defined above it.
const instance = render(<App />)
