/**
 * One still-running tool call's activity-region row: a spinner (self-timed —
 * independent of the publication scheduler's stream/structural cadence, the
 * ordinary Ink pattern for a purely cosmetic local animation) plus the
 * call's title. `React.memo` over primitive props (not one nested object)
 * skips a re-render for a row whose call has not changed since the last
 * repaint, even though its parent list re-renders at the scheduler's rate.
 * @module @deepseek-ai/dsh-tui-ink-ui/components/ToolRunningRow
 */

import React, { useEffect, useState } from 'react'
import { Text } from 'ink'
import { SPINNER_FRAME_INTERVAL_MS, spinnerFrameAt } from '../spinner.ts'

export interface ToolRunningRowProps {
  /** The row's title (category label plus call title). */
  readonly title: string
  /** Unix epoch ms the call started, so the spinner's phase is stable across re-renders. */
  readonly startedAtMs: number
}

function ToolRunningRowComponent({ title, startedAtMs }: ToolRunningRowProps): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, SPINNER_FRAME_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [])
  return <Text>{`${spinnerFrameAt(now - startedAtMs)} ${title}`}</Text>
}

/** Memoized row: re-renders only when `title` or `startedAtMs` actually changes (its own spinner tick is internal state). */
export const ToolRunningRow: React.MemoExoticComponent<typeof ToolRunningRowComponent> = React.memo(ToolRunningRowComponent)
