/**
 * The top-level Ink component: a pure function of the current activity
 * model plus the two control callbacks (`render.ts` re-renders it
 * imperatively via `instance.rerender()` on every scheduled publish — this
 * component holds no session subscription itself). Esc cancels the running
 * turn; Ctrl-C is handled by Ink itself (`exitOnCtrlC`, proven by the Q3
 * reconnaissance PoC to restore terminal state on every exit path) and needs
 * no code here.
 * @module @deepseek-ai/dsh-tui-ink-ui/components/App
 */

import React from 'react'
import { useInput } from 'ink'
import type { ActivityModel } from '../activity/activity-model.ts'
import { ActivityRegion } from './ActivityRegion.tsx'

export interface AppProps {
  /** The current bounded live view. */
  readonly activity: ActivityModel
  /** Called with the composer's submitted text. */
  readonly onSubmit: (text: string) => void
  /** Called when Esc requests cancelling the running turn. */
  readonly onCancel: () => void
}

/**
 * Render the application root.
 * @param props - see {@link AppProps}.
 * @returns the root element.
 */
export function App({ activity, onSubmit, onCancel }: AppProps): React.JSX.Element {
  useInput((_input, key) => {
    if (key.escape) onCancel()
  })
  return <ActivityRegion activity={activity} onSubmit={onSubmit} />
}
