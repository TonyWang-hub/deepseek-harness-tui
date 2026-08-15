/**
 * Pure mapping from one settled `ConversationNode` (the client runtime's
 * append-only transcript node union) to the scrollback lines committed for
 * it. Every node kind renders here exactly once, in `render.ts`'s commit
 * loop, then is dropped from the Ink tree (the "Ink tree zero history" MVP
 * acceptance criterion) — a closed node's rendering is therefore a pure
 * function of the node and the terminal width, safe to memoize in
 * {@link module:transcript/row-cache}.
 * @module @deepseek-ai/dsh-tui-ink-ui/transcript/node-lines
 */

import type { AssistantBlock, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import { style } from '../ansi/style.ts'
import { contentBlocksToLines } from './content-text.ts'
import { renderToolResultCardLines } from './tool-cards.ts'

/** Closed-union backstop: every `ConversationNode.kind` is handled in {@link renderClosedNodeLines}'s switch. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a node/block kind is forged past the type system */
function assertNever(value: never): never {
  throw new Error(`unreachable ConversationNode kind: ${String((value as { kind?: unknown }).kind)}`)
}

/**
 * Render one settled transcript node to its scrollback lines.
 * @param node - the settled node (an entry of `ConversationSnapshot.nodes`).
 * @returns the lines to commit for this node (never empty — every kind renders at least a role/summary line).
 */
export function renderClosedNodeLines(node: ConversationNode): string[] {
  switch (node.kind) {
    case 'user':
      return [style.userRole('❯ you'), ...contentBlocksToLines(node.content)]
    case 'steering':
      return [style.userRole('❯ you (steer)'), ...contentBlocksToLines(node.content)]
    case 'context':
      return [style.dim(`[context${node.form !== null ? `: ${node.form}` : ''}]`), ...contentBlocksToLines(node.content).map(line => style.dim(line))]
    case 'assistant':
      return [style.assistantRole('● assistant'), ...renderAssistantBlocks(node.blocks)]
    case 'tool-result':
      return renderToolResultCardLines({
        callName: node.call?.name ?? null,
        callView: node.callView,
        resultView: node.resultView,
        content: node.content,
        isError: node.isError,
      })
    case 'command':
      return renderCommandNode(node)
    case 'compaction':
      return [style.dim(node.summary ?? `[compaction: ${node.shadowedItemCount ?? 0} item(s) shadowed]`)]
    case 'model-retry':
      return [style.dim(`[retry turn ${node.turn} step ${node.step}: ${node.retryState}]`)]
    case 'turn-error':
      return [style.error(`[turn error] ${node.message}${node.code !== undefined ? ` (${node.code})` : ''}`)]
    case 'turn-max-tokens':
      return [style.error(`[turn ${node.turn} step ${node.step}] max tokens reached`)]
    case 'unknown':
      return [style.dim(`[unknown event: ${node.type}]`)]
    /* v8 ignore next 2 -- closed-union backstop; every ConversationNode kind is handled above */
    default:
      return assertNever(node)
  }
}

/**
 * Render an assistant message's blocks: text/reasoning show their text, a
 * tool-call shows a one-line reference, an image/other shows a placeholder.
 * Exported for reuse by the activity model's streaming-tail preview, which
 * renders the SAME block union while a message is still partial.
 * @param blocks - the message's (possibly partial) content blocks.
 * @returns display lines.
 */
export function renderAssistantBlocks(blocks: readonly AssistantBlock[]): string[] {
  const lines: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        lines.push(...block.text.split('\n'))
        break
      case 'reasoning':
        lines.push(...block.text.split('\n').map(line => style.dim(`(thinking) ${line}`)))
        break
      case 'tool-call':
        lines.push(style.dim(`→ calling ${block.name}`))
        break
      case 'image':
        lines.push(style.dim('[image]'))
        break
      case 'other':
        lines.push(style.dim('[other]'))
        break
      /* v8 ignore next 2 -- closed-union backstop; every AssistantBlock kind is handled above */
      default:
        return assertNever(block)
    }
  }
  return lines
}

/** Render a slash-command node: the command line plus its outcome (success text, error, or still-pending). */
function renderCommandNode(node: Extract<ConversationNode, { kind: 'command' }>): string[] {
  const line = node.args !== null && node.args.length > 0 ? `/${node.name ?? node.commandId} ${node.args}` : `/${node.name ?? node.commandId}`
  const lines = [style.dim(line)]
  if (node.outcome === null) return lines
  if (node.outcome.kind === 'error') {
    lines.push(style.error(node.outcome.text ?? '[command failed]'))
  } else if (node.outcome.text !== undefined) {
    lines.push(style.dim(node.outcome.text))
  }
  return lines
}
