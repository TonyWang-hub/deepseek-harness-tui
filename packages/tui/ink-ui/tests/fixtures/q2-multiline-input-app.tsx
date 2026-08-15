/**
 * Q2 reconnaissance fixture — see `../q2-multiline-input.poc.ts`.
 *
 * A from-scratch borderless multiline input: no maintained Ink component
 * covers this (`ink-text-input` is single-line — Enter always submits, see
 * its source; the only multiline candidate found, `ink-multiline-input`
 * 0.1.0, is a few-weeks-old 0.x package with no configurable asymmetric
 * first-line/continuation-line prefix). This fixture proves the two
 * concrete difficulties the Agent Note's "Risks" section names:
 *
 * 1. First-line prefix (`❯ `, 2 columns) and continuation-line prefix
 *    (`    `, 4 columns) differ in display width, so the column budget
 *    available to wrapped text differs per row class.
 * 2. Wrapping must count display columns, not code points or UTF-16 units —
 *    `string-width` (already a transitive Ink dependency, and used directly
 *    here) gives each character's terminal column width so a CJK wide
 *    character never gets split across a wrap boundary or miscounted.
 *
 * The real terminal cursor (not a fake inverse-video block, unlike
 * `ink-text-input`) tracks the caret through `useCursor()`
 * (`ink/build/hooks/use-cursor.js`), which every Ink 7 component can call
 * directly — this fixture uses no cursor trick that a maintained package
 * did not already ship as first-party API.
 *
 * Editing model: printable characters insert at the caret; Backspace
 * deletes backward (merging into the previous logical line at column 0);
 * arrow keys move the caret across logical lines and columns; a literal LF
 * byte (`input === '\n'`, sent as Ctrl+J by the driver — no terminal
 * reliably reports Shift+Enter without the kitty keyboard protocol, out of
 * this PoC's scope) inserts a logical line break without submitting.
 * Ctrl+D dumps the logical `lines` array as JSON and exits, so the driver
 * can assert the edit model independently of the rendered screen.
 */
import process from 'node:process'
import React, { useState } from 'react'
import { Box, render, Text, useCursor, useInput } from 'ink'
import stringWidth from 'string-width'

const FIRST_PREFIX = '❯ '
const CONTINUATION_PREFIX = '    '
const FIRST_PREFIX_WIDTH = stringWidth(FIRST_PREFIX)
const CONTINUATION_PREFIX_WIDTH = stringWidth(CONTINUATION_PREFIX)
const COLUMNS = Number(process.argv[2] ?? '30')

interface Caret {
  readonly row: number
  readonly col: number
}

interface DisplayRow {
  readonly text: string
  readonly isFirst: boolean
}

interface Layout {
  readonly rows: readonly DisplayRow[]
  readonly cursorX: number
  readonly cursorY: number
}

/** Split one logical line into display rows within `budget` display columns, never splitting a wide character. */
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
 * budget, every later row — whether a wrap continuation or the next logical
 * line — uses the continuation budget), and locate the caret's display
 * column/row in the same pass.
 */
function layout(lines: readonly string[], caret: Caret): Layout {
  const rows: DisplayRow[] = []
  let cursorX = 0
  let cursorY = 0
  let cursorFound = false

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const isVeryFirstRowSoFar = rows.length === 0
    const budget = isVeryFirstRowSoFar ? COLUMNS - FIRST_PREFIX_WIDTH : COLUMNS - CONTINUATION_PREFIX_WIDTH
    const wrapped = wrapByWidth(lines[lineIndex] ?? '', budget)
    let consumedWidth = 0
    for (let segmentIndex = 0; segmentIndex < wrapped.length; segmentIndex++) {
      const segment = wrapped[segmentIndex] ?? ''
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
    cursorX = stringWidth(rows[rows.length - 1]?.text ?? '')
  }

  return { rows, cursorX, cursorY }
}

function App(): React.JSX.Element {
  const [lines, setLines] = useState<string[]>([''])
  const [caret, setCaret] = useState<Caret>({ row: 0, col: 0 })
  const { setCursorPosition } = useCursor()

  useInput((input, key) => {
    if (key.ctrl && input === 'd') {
      console.log(JSON.stringify(lines))
      process.exit(0)
    }
    if (input === '\n') {
      setLines((previous) => {
        const next = [...previous]
        const currentLine = next[caret.row] ?? ''
        const before = Array.from(currentLine).slice(0, caret.col).join('')
        const after = Array.from(currentLine).slice(caret.col).join('')
        next.splice(caret.row, 1, before, after)
        return next
      })
      setCaret(previous => ({ row: previous.row + 1, col: 0 }))
      return
    }
    if (key.backspace || key.delete) {
      setCaret((previousCaret) => {
        if (previousCaret.col > 0) {
          setLines((previousLines) => {
            const next = [...previousLines]
            const characters = Array.from(next[previousCaret.row] ?? '')
            characters.splice(previousCaret.col - 1, 1)
            next[previousCaret.row] = characters.join('')
            return next
          })
          return { row: previousCaret.row, col: previousCaret.col - 1 }
        }
        if (previousCaret.row > 0) {
          let mergedCol = 0
          setLines((previousLines) => {
            const next = [...previousLines]
            const previousLineText = next[previousCaret.row - 1] ?? ''
            mergedCol = Array.from(previousLineText).length
            next[previousCaret.row - 1] = previousLineText + (next[previousCaret.row] ?? '')
            next.splice(previousCaret.row, 1)
            return next
          })
          return { row: previousCaret.row - 1, col: mergedCol }
        }
        return previousCaret
      })
      return
    }
    if (key.leftArrow) {
      setCaret(previousCaret => (previousCaret.col > 0
        ? { row: previousCaret.row, col: previousCaret.col - 1 }
        : previousCaret))
      return
    }
    if (key.rightArrow) {
      setCaret((previousCaret) => {
        const lineLength = Array.from(lines[previousCaret.row] ?? '').length
        return previousCaret.col < lineLength ? { row: previousCaret.row, col: previousCaret.col + 1 } : previousCaret
      })
      return
    }
    if (key.upArrow) {
      setCaret(previousCaret => (previousCaret.row > 0 ? { row: previousCaret.row - 1, col: 0 } : previousCaret))
      return
    }
    if (key.downArrow) {
      setCaret(previousCaret => (previousCaret.row < lines.length - 1
        ? { row: previousCaret.row + 1, col: 0 }
        : previousCaret))
      return
    }
    if (key.return || key.ctrl || key.meta || input === '') return
    setLines((previousLines) => {
      const next = [...previousLines]
      const characters = Array.from(next[caret.row] ?? '')
      characters.splice(caret.col, 0, input)
      next[caret.row] = characters.join('')
      return next
    })
    setCaret(previousCaret => ({ row: previousCaret.row, col: previousCaret.col + Array.from(input).length }))
  })

  const built = layout(lines, caret)
  const cursorRowPrefixWidth = built.rows[built.cursorY]?.isFirst ? FIRST_PREFIX_WIDTH : CONTINUATION_PREFIX_WIDTH
  setCursorPosition({ x: cursorRowPrefixWidth + built.cursorX, y: built.cursorY })

  return (
    <Box flexDirection="column">
      {built.rows.map((row, index) => (
        <Text key={index}>{(row.isFirst ? FIRST_PREFIX : CONTINUATION_PREFIX) + row.text}</Text>
      ))}
    </Box>
  )
}

render(<App />)
