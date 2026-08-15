/**
 * Display-column layout for the multiline composer: wraps each logical line
 * into terminal rows under an asymmetric first-line/continuation-line prefix
 * budget, and locates the caret's display row/column in the same pass. Ported
 * from the Q2 reconnaissance fixture
 * (`tests/fixtures/q2-multiline-input-app.tsx`) into a reusable, Ink-free
 * module — the fixture proved the algorithm against a real pty and terminal
 * cursor; this module is the same algorithm, generalized over configurable
 * prefixes instead of the fixture's hardcoded `❯ `/`    ` pair.
 * @module @deepseek-ai/dsh-tui-ink-ui/input/layout
 */

import stringWidth from 'string-width'

/** Zero-based logical caret position: which logical line, and the character offset within it. */
export interface Caret {
  readonly row: number
  readonly col: number
}

/** One rendered terminal row: its text (prefix excluded) and whether it is the very first rendered row. */
export interface DisplayRow {
  readonly text: string
  readonly isFirst: boolean
}

/** The laid-out rows plus the caret's display column/row. */
export interface Layout {
  readonly rows: readonly DisplayRow[]
  readonly cursorX: number
  readonly cursorY: number
}

/** Display-column widths of the first-line and continuation-line prefixes. */
export interface PrefixWidths {
  readonly first: number
  readonly continuation: number
}

/**
 * Split one logical line into display rows within `budget` display columns,
 * never splitting a wide (e.g. CJK) character across a wrap boundary.
 * @param text - one logical line's text.
 * @param budget - display columns available per row.
 * @returns the wrapped rows (always at least one, possibly empty-string).
 */
function wrapByWidth(text: string, budget: number): string[] {
  const characters = Array.from(text)
  if (characters.length === 0) return ['']
  const rows: string[] = []
  let current = ''
  let currentWidth = 0
  for (const character of characters) {
    const width = stringWidth(character)
    if (currentWidth + width > budget && current !== '') {
      rows.push(current)
      current = ''
      currentWidth = 0
    }
    current += character
    currentWidth += width
  }
  rows.push(current)
  return rows
}

/**
 * Lay out every logical line into display rows (row 0 uses the first-line
 * budget; every later row — a wrap continuation or the next logical line —
 * uses the continuation budget), and locate the caret's display column/row.
 * @param lines - logical lines (the composer's edit-model text).
 * @param caret - logical caret position.
 * @param columns - total terminal width available to the composer.
 * @param prefixes - display-column widths of the first-line/continuation prefixes.
 * @returns the laid-out rows and the caret's display position.
 */
export function layoutMultilineInput(
  lines: readonly string[],
  caret: Caret,
  columns: number,
  prefixes: PrefixWidths,
): Layout {
  const rows: DisplayRow[] = []
  let cursorX = 0
  let cursorY = 0
  let cursorFound = false

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const budget = rows.length === 0 ? columns - prefixes.first : columns - prefixes.continuation
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- lineIndex is bounded by the for-loop condition above
    const wrapped = wrapByWidth(lines[lineIndex]!, budget)
    let consumedWidth = 0
    for (const segment of wrapped) {
      rows.push({ text: segment, isFirst: rows.length === 0 })
      if (!cursorFound && lineIndex === caret.row) {
        const segmentCharacters = Array.from(segment).length
        if (caret.col <= consumedWidth + segmentCharacters) {
          cursorX = Array.from(segment.slice(0, Math.max(0, caret.col - consumedWidth))).reduce(
            (sum, character) => sum + stringWidth(character),
            0,
          )
          cursorY = rows.length - 1
          cursorFound = true
        }
      }
      consumedWidth += Array.from(segment).length
    }
  }

  if (!cursorFound && rows.length > 0) {
    cursorY = rows.length - 1
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- rows.length > 0 was just checked above
    cursorX = stringWidth(rows[rows.length - 1]!.text)
  }

  return { rows, cursorX, cursorY }
}
