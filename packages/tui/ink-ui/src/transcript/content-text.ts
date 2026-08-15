/**
 * Flatten harness content blocks (`@deepseek-ai/dsh-llm/types`'s `ContentBlock`
 * union) to plain display lines, shared by the transcript's node and
 * tool-card renderers so a text/reasoning block always prints the same way
 * wherever it appears.
 * @module @deepseek-ai/dsh-tui-ink-ui/transcript/content-text
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'

/**
 * Render content blocks as display lines: `text`/`reasoning` blocks show
 * their text; every other block kind (including a future merge-extended one
 * this package's version does not know) shows a `[kind]` placeholder — the
 * documented generic fallback for a merge-extensible union.
 * @param content - the content blocks to render.
 * @returns display lines (empty for empty/absent content).
 */
export function contentBlocksToLines(content: readonly ContentBlock[] | undefined): string[] {
  if (content === undefined || content.length === 0) return []
  const text = content
    .map(block => (block.type === 'text' || block.type === 'reasoning' ? block.text : `[${block.type}]`))
    .join('\n')
  return text.split('\n')
}
