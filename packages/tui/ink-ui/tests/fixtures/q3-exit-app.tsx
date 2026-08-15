/**
 * Q3 reconnaissance fixture — see `../q3-terminal-restoration.poc.ts`.
 *
 * Engages raw mode (`useInput`) and bracketed paste (`usePaste`) — the two
 * terminal modes the Agent Note's "Terminal ownership" section names — then
 * exits through one of three paths selected by `argv[2]`:
 *
 * - `normal`: calls `useApp().exit()` after a delay (the ordinary teardown path).
 * - `ctrlc`: does nothing on its own; the driver sends a real Ctrl+C byte
 *   (`\x03`) over the pty, exercising Ink's `exitOnCtrlC` handling
 *   (`ink/build/components/App.js`'s `handleInput`/`handleExit`).
 * - `throw`: schedules an uncaught exception, exercising whichever cleanup
 *   path (if any) runs when Node's default uncaught-exception handler tears
 *   the process down — signal-exit (an Ink dependency) hooks the process
 *   `exit` event, which normally still fires after an uncaught exception
 *   unwinds; this fixture is how that assumption gets checked against a
 *   real process, not just read off Ink's source.
 */
import process from 'node:process'
import React from 'react'
import { render, Text, useApp, useInput, usePaste } from 'ink'

const MODE = process.argv[2] ?? 'normal'

function App(): React.JSX.Element {
  const { exit } = useApp()
  useInput(() => {}) // engages raw mode for this component's lifetime
  usePaste(() => {}) // engages bracketed paste for this component's lifetime

  React.useEffect(() => {
    process.stdout.write('___READY___\n')
    if (MODE === 'normal') {
      const timer = setTimeout(() => { exit() }, 200)
      return () => { clearTimeout(timer) }
    }
    if (MODE === 'throw') {
      const timer = setTimeout(() => {
        throw new Error('Q3 PoC: deliberate uncaught exception')
      }, 200)
      return () => { clearTimeout(timer) }
    }
    // 'ctrlc': nothing to schedule — the driver sends the interrupt byte.
    return undefined
  }, [exit])

  return <Text>Q3 fixture running (mode: {MODE})</Text>
}

render(<App />)
