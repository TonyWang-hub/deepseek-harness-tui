/**
 * Pure derivation of the bounded "activity region" — the only part of the
 * transcript the Ink tree ever holds live — from a `ConversationSnapshot`:
 * the streaming assistant tail (height-limited to the actual terminal size),
 * running tool rows, and the pending approval/question queues. Closed
 * (settled) nodes never appear here; they are committed to scrollback and
 * dropped (see `render.ts` and `transcript/node-lines.ts`).
 * @module @deepseek-ai/dsh-tui-ink-ui/activity/activity-model
 */

import type { ConversationSnapshot, PendingInteraction, RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client'
import { renderAssistantBlocks } from '../transcript/node-lines.ts'
import { runningToolTitle } from '../transcript/tool-cards.ts'

/** One still-running tool call's activity-region row. */
export interface RunningToolRow {
  readonly callId: string
  readonly title: string
  /** Unix epoch ms the call started (`RunningToolCall.time`), used to pick the spinner frame. */
  readonly startedAtMs: number
}

/** The bounded live view the Ink tree renders. */
export interface ActivityModel {
  /** The current turn's streaming assistant text, tail-limited to {@link streamingTailBudget}. */
  readonly streamingLines: readonly string[]
  /** Whether {@link streamingLines} dropped earlier lines to fit the budget. */
  readonly streamingTruncated: boolean
  /** Still-running tool calls, in call order. */
  readonly runningTools: readonly RunningToolRow[]
  /** Pending approval interactions, in arrival order; the activity region focuses the first. */
  readonly pendingApprovals: readonly Extract<PendingInteraction, { kind: 'approval' }>[]
  /** Pending question interactions, in arrival order; the activity region focuses the first. */
  readonly pendingQuestions: readonly Extract<PendingInteraction, { kind: 'question' }>[]
  /** Count of transient inbox occurrences (queued/steering/context), shown as a one-line hint. */
  readonly queueCount: number
}

/**
 * Reserved rows below the streaming tail for running-tool rows, the
 * approval/question prompt, and the composer, before the budget floor
 * applies. A layout constant of this region's own geometry (mirrors
 * `CHAT_DIFF_MAX_LINES`'s "design constant, not a deployment choice" — see
 * `dsh-client-ui-tool`'s `diff-card-model.ts`), not a `Config` field.
 */
const RESERVED_CHROME_ROWS = 6

/** Minimum streaming-tail budget even on a very short terminal. */
const MIN_STREAMING_TAIL_LINES = 3

/**
 * Compute how many streaming-tail lines fit given the real terminal height,
 * reserving rows for the rest of the activity region's chrome.
 * @param terminalRows - the terminal's current row count (`stdout.rows`).
 * @returns the streaming-tail line budget (at least {@link MIN_STREAMING_TAIL_LINES}).
 */
export function streamingTailBudget(terminalRows: number): number {
  const available = terminalRows - RESERVED_CHROME_ROWS
  return available > MIN_STREAMING_TAIL_LINES ? available : MIN_STREAMING_TAIL_LINES
}

/** Keep only the last `max` lines, in order. */
function tail(lines: readonly string[], max: number): { lines: readonly string[]; truncated: boolean } {
  if (lines.length <= max) return { lines, truncated: false }
  return { lines: lines.slice(lines.length - max), truncated: true }
}

function runningToolRow(call: RunningToolCall): RunningToolRow {
  return { callId: call.callId, title: runningToolTitle(call.callView, call.name), startedAtMs: call.time }
}

/**
 * Build the activity model for one repaint.
 * @param snapshot - the session's current conversation snapshot.
 * @param terminalRows - the terminal's current row count, sizing the streaming tail.
 * @returns the bounded live view.
 */
export function buildActivityModel(snapshot: ConversationSnapshot, terminalRows: number): ActivityModel {
  const partialLines = snapshot.partial === null ? [] : renderAssistantBlocks(snapshot.partial.blocks)
  const { lines: streamingLines, truncated: streamingTruncated } = tail(partialLines, streamingTailBudget(terminalRows))
  return {
    streamingLines,
    streamingTruncated,
    runningTools: snapshot.runningCalls.map(runningToolRow),
    pendingApprovals: snapshot.pending.filter((entry): entry is Extract<PendingInteraction, { kind: 'approval' }> => entry.kind === 'approval'),
    pendingQuestions: snapshot.pending.filter((entry): entry is Extract<PendingInteraction, { kind: 'question' }> => entry.kind === 'question'),
    queueCount: snapshot.queue.length,
  }
}
