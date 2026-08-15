/**
 * The bounded activity region: the ONLY part of the transcript the Ink tree
 * ever holds — the streaming assistant tail, running-tool rows, and exactly
 * one focused pending interaction (an approval or a question), with the
 * composer beneath. Closed nodes never reach this component; they commit to
 * scrollback and are dropped (`render.ts`).
 * @module @deepseek-ai/dsh-tui-ink-ui/components/ActivityRegion
 */

import React from 'react'
import { Box, Text } from 'ink'
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

  return (
    <Box flexDirection="column">
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
      <Composer onSubmit={onSubmit} isActive={composerActive} />
    </Box>
  )
}
