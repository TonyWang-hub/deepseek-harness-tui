/**
 * The bounded activity region: the ONLY part of the transcript the Ink tree
 * ever holds — the streaming assistant tail, running-tool rows, and exactly
 * one focused pending interaction (an approval or a question), with the
 * composer beneath. Closed nodes never reach this component; they commit to
 * scrollback and are dropped (`render.ts`).
 *
 * The rows above the composer wrap-account for the real terminal width (a
 * long streaming line, a wide tool title) in a way this component cannot
 * recompute from its own data without duplicating Ink's own text-wrapping
 * algorithm. Instead it measures its rendered height with `measureElement`
 * (`ink/measure-element.js`), whose `y`/`height` are already "relative to the
 * Ink output origin" — the exact coordinate system `useCursor` documents
 * (`ink/build/hooks/use-cursor.js`) — and feeds that measured row count to the
 * composer as `rowOffset`, so its cursor lands where the terminal actually
 * draws it instead of at the composer's own first row.
 * @module @deepseek-ai/dsh-tui-ink-ui/components/ActivityRegion
 */

import React, { useEffect, useRef, useState } from 'react'
import { Box, measureElement, Text, type DOMElement } from 'ink'
import type { ActivityModel } from '../activity/activity-model.ts'
import { style } from '../ansi/style.ts'
import { ApprovalPrompt } from './ApprovalPrompt.tsx'
import { Composer } from './Composer.tsx'
import { QuestionPrompt } from './QuestionPrompt.tsx'
import { ToolRunningRow } from './ToolRunningRow.tsx'

export interface ActivityRegionProps {
  /** The current bounded live view (see `activity/activity-model.ts`). */
  readonly activity: ActivityModel
  /** Called with the composer's submitted text; wired to `SessionFace.prompt` by `render.ts`. */
  readonly onSubmit: (text: string) => void
}

/**
 * Render the activity region.
 * @param props - see {@link ActivityRegionProps}.
 * @returns the region element.
 */
export function ActivityRegion({ activity, onSubmit }: ActivityRegionProps): React.JSX.Element {
  const approval = activity.pendingApprovals[0]
  const question = approval === undefined ? activity.pendingQuestions[0] : undefined
  const composerActive = approval === undefined && question === undefined

  const aboveComposerRef = useRef<DOMElement | null>(null)
  const [composerRowOffset, setComposerRowOffset] = useState(0)
  // Runs after every render (no dependency array), mirroring `useBoxMetrics`'s
  // own re-measure timing (`ink/build/hooks/use-box-metrics.js`): Yoga only
  // computes this render's real layout in `resetAfterCommit`, after this
  // passive effect's render already committed, so the height read here is
  // one render behind on the render where content above the composer first
  // changes and settles on the very next one — the harness's `settle()`
  // (`tests/support/headless-terminal.ts`) double-flushes for exactly this.
  useEffect(() => {
    /* v8 ignore next -- ref is null only before first commit, before any passive effect runs */
    if (aboveComposerRef.current === null) return
    setComposerRowOffset(measureElement(aboveComposerRef.current).height)
  })

  return (
    <Box flexDirection="column">
      <Box ref={aboveComposerRef} flexDirection="column">
        {activity.streamingLines.length > 0 && (
          <Box flexDirection="column">
            {activity.streamingTruncated && <Text>{style.dim('⋯')}</Text>}
            {activity.streamingLines.map((line, index) => <Text key={index}>{line}</Text>)}
          </Box>
        )}
        {activity.runningTools.map(row => (
          <ToolRunningRow key={row.callId} title={row.title} startedAtMs={row.startedAtMs} />
        ))}
        {activity.queueCount > 0 && <Text>{style.dim(`(${activity.queueCount} queued)`)}</Text>}
        {approval !== undefined && <ApprovalPrompt approval={approval} isActive />}
        {question !== undefined && <QuestionPrompt question={question} isActive />}
      </Box>
      <Composer onSubmit={onSubmit} isActive={composerActive} rowOffset={composerRowOffset} />
    </Box>
  )
}
