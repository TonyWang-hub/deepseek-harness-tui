/**
 * Pure mapping from the provider-neutral tool render-intent union
 * (`@deepseek-ai/dsh-tools/presentation`'s `ToolCallView`/`ToolResultView`) to
 * scrollback lines. MVP card coverage per the D2.2 brief: `generic` (the
 * documented fallback for every unknown `card` value, and for `read`/
 * `search`/`web`, which stay on the generic path here — a TODO for a later
 * cut), `terminal` (sanitized output passthrough), and `diff` (±-line
 * coloring). Imports only the narrow `/presentation` and `/types` subpaths of
 * `dsh-tools`/`dsh-llm`, never their package roots, so this Client-aggregate
 * package's TypeScript program never sees either package's Cordis `Context`
 * augmentation (the same convention `dsh-client-runtime`'s own client half
 * already uses for these two subpaths).
 * @module @deepseek-ai/dsh-tui-ink-ui/transcript/tool-cards
 */

import { diffLines } from 'diff'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type {
  DiffResultView, FileDiff, TerminalResultView, ToolCallKind, ToolCallView, ToolResultView,
} from '@deepseek-ai/dsh-tools/presentation'
import { style } from '../ansi/style.ts'
import { sanitizeTerminalOutput } from '../ansi/sanitize-terminal.ts'
import { contentBlocksToLines } from './content-text.ts'

/** Bracketed category label shown before a generic card's title; `other` is the default. */
const KIND_LABEL: Record<ToolCallKind, string> = {
  read: 'read',
  edit: 'edit',
  delete: 'delete',
  move: 'move',
  search: 'search',
  execute: 'execute',
  fetch: 'fetch',
  other: 'other',
}

/** Render a `ToolCallKind` as a dim bracketed label, e.g. `[edit]`. */
function kindLabel(kind: ToolCallKind | undefined): string {
  return style.dim(`[${KIND_LABEL[kind ?? 'other']}]`)
}

/** Render a call's `rawInput` (string as-is, object as pretty JSON) as display lines. */
function rawInputLines(rawInput: unknown): string[] {
  if (rawInput === undefined) return []
  if (typeof rawInput === 'string') return rawInput.length === 0 ? [] : rawInput.split('\n')
  return JSON.stringify(rawInput, null, 2).split('\n')
}

/** The settled state this module needs off a `ToolResultNode`, decoupled from the full node shape. */
export interface ToolResultCardInput {
  /** The call's model-facing tool name, or `null` when window truncation dropped the call head. */
  readonly callName: string | null
  /** The call-time render intent, or `null` when absent or window-truncated. */
  readonly callView: ToolCallView | null
  /** The result-time render intent, or `null` to fall back to the generic card over `content`. */
  readonly resultView: ToolResultView | null
  /** The model-facing result content, used by the generic-card fallback. */
  readonly content: readonly ContentBlock[]
  /** Whether the tool call ended in an error. */
  readonly isError: boolean
}

/**
 * Render a settled tool call's full card, dispatching on `resultView.card`.
 * An unrecognized or absent `resultView.card` (including `search`/`read`/
 * `web`, deferred to a later cut) falls through to the generic card — the
 * render-intent contract's documented default.
 * @param input - the settled call's card-relevant fields.
 * @returns the card's scrollback lines.
 */
export function renderToolResultCardLines(input: ToolResultCardInput): string[] {
  if (input.resultView?.card === 'terminal') return renderTerminalCardLines(input.resultView, input.callView)
  if (input.resultView?.card === 'diff') return renderDiffCardLines(input.resultView)
  return renderGenericCardLines(input)
}

/** The default card: title, category label, raw input, and content. */
function renderGenericCardLines(input: ToolResultCardInput): string[] {
  const resultView = input.resultView?.card === 'generic' ? input.resultView : null
  // `kind`/`rawInput` are GenericCallView-only fields (TerminalCallView and
  // DiffCallView carry neither) — narrow before reading them; `title` is
  // common to every ToolCallView variant, so it reads off `callView` directly.
  const call = input.callView?.card === 'generic' ? input.callView : null
  const title = resultView?.title ?? input.callView?.title ?? input.callName ?? 'tool call'
  const lines: string[] = [`${kindLabel(call?.kind)} ${style.title(title)}${input.isError ? ` ${style.error('(error)')}` : ''}`]
  lines.push(...rawInputLines(call?.rawInput).map(line => style.dim(line)))
  const contentLines = resultView?.content !== undefined
    ? contentBlocksToLines(resultView.content)
    : contentBlocksToLines(input.content)
  lines.push(...contentLines)
  return lines
}

/** The terminal card: command header, sanitized output, and an exit-status pill. */
function renderTerminalCardLines(resultView: TerminalResultView, callView: ToolCallView | null): string[] {
  const call = callView?.card === 'terminal' ? callView : null
  const command = resultView.title ?? call?.title ?? ''
  const lines: string[] = [style.title(`$ ${command}`)]
  if (call?.description !== undefined && call.description.length > 0) lines.push(style.dim(call.description))
  if (resultView.output !== undefined && resultView.output.length > 0) {
    lines.push(...sanitizeTerminalOutput(resultView.output).split('\n'))
  }
  if (resultView.exitCode !== undefined) {
    lines.push(resultView.exitCode === 0 ? style.dim(`[exit ${resultView.exitCode}]`) : style.error(`[exit ${resultView.exitCode}]`))
  } else if (resultView.signal !== undefined) {
    lines.push(style.error(`[signal ${resultView.signal}]`))
  }
  return lines
}

/** One file's diff, rendered lines plus its own added/removed counts. */
interface FileDiffRender {
  readonly lines: string[]
  readonly added: number
  readonly removed: number
}

/** One file's diff rendered as ±-colored lines via `diff`'s `diffLines` (an "exact changed-row comparison", not a whole-block replace). */
function renderFileDiff(diff: FileDiff): FileDiffRender {
  const lines: string[] = [style.title(diff.path)]
  let added = 0
  let removed = 0
  for (const change of diffLines(diff.oldText ?? '', diff.newText)) {
    const body = change.value.endsWith('\n') ? change.value.slice(0, -1) : change.value
    if (body.length === 0) continue
    for (const line of body.split('\n')) {
      if (change.added) {
        lines.push(style.diffAdd(`+ ${line}`))
        added++
      } else if (change.removed) {
        lines.push(style.diffDel(`- ${line}`))
        removed++
      } else {
        lines.push(style.diffContext(`  ${line}`))
      }
    }
  }
  return { lines, added, removed }
}

/** The diff card: one header+±lines block per file, plus an added/removed/file-count footer. */
function renderDiffCardLines(resultView: DiffResultView): string[] {
  const lines: string[] = [style.title(resultView.title ?? 'Diff')]
  let added = 0
  let removed = 0
  const paths = new Set<string>()
  for (const diff of resultView.diffs) {
    paths.add(diff.path)
    const rendered = renderFileDiff(diff)
    lines.push(...rendered.lines)
    added += rendered.added
    removed += rendered.removed
  }
  lines.push(style.dim(`└ +${added} -${removed} · ${paths.size} file${paths.size === 1 ? '' : 's'}`))
  return lines
}

/**
 * One-line title for a still-running tool call in the bounded activity
 * region (no full card while running — only a title and, in
 * `ToolRunningRow.tsx`, a spinner prefix).
 * @param callView - the call's render intent, or `null` when absent.
 * @param fallbackName - the tool's model-facing name, used when `callView` is `null`.
 * @returns the row's title text (category label plus title).
 */
export function runningToolTitle(callView: ToolCallView | null, fallbackName: string): string {
  // `kind` is a GenericCallView-only field; a running terminal/diff call has
  // no category label to show (its own card kind IS the category).
  const kind = callView?.card === 'generic' ? callView.kind : undefined
  const title = callView?.title ?? fallbackName
  return `${kindLabel(kind)} ${title}`
}
