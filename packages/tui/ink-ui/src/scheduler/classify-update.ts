/**
 * Classify a `ConversationSnapshot` transition as `'stream'` or
 * `'structural'` for {@link PublicationScheduler.schedule}: a session's
 * `ObservableSnapshot.subscribe` callback fires for every change with no
 * reason payload, so `render.ts` diffs the previous and next snapshot's
 * counts to decide. A `'structural'` change is one a user must see without
 * frame-rate delay — a pending interaction appearing or resolving, a turn
 * starting/ending, a tool call starting/finishing, a closed node committing,
 * or the transient inbox changing; everything else (a token delta inside an
 * already-open partial) is `'stream'`.
 * @module @deepseek-ai/dsh-tui-ink-ui/scheduler/classify-update
 */

import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { PublicationReason } from './publication-scheduler.ts'

/** The snapshot fields this classification reads (a `Pick` keeps test fixtures small). */
export type ClassifiableSnapshot = Pick<
  ConversationSnapshot, 'pending' | 'running' | 'turnEnds' | 'nodes' | 'queue' | 'runningCalls'
>

/**
 * Decide whether a snapshot transition is structural or an ordinary stream update.
 * @param previous - the snapshot before this change.
 * @param next - the snapshot after this change.
 * @returns `'structural'` when a count this function tracks changed; `'stream'` otherwise.
 */
export function classifySnapshotUpdate(previous: ClassifiableSnapshot, next: ClassifiableSnapshot): PublicationReason {
  if (previous.pending.length !== next.pending.length) return 'structural'
  if (previous.running !== next.running) return 'structural'
  if (previous.turnEnds.size !== next.turnEnds.size) return 'structural'
  if (previous.nodes.length !== next.nodes.length) return 'structural'
  if (previous.queue.length !== next.queue.length) return 'structural'
  if (previous.runningCalls.length !== next.runningCalls.length) return 'structural'
  return 'stream'
}
