import { describe, expect, it } from 'vitest'
import stringWidth from 'string-width'
import { layoutMultilineInput } from '../../src/input/layout.ts'

// Same hand-derived scenario as the Q2 reconnaissance PoC
// (`tests/q2-multiline-input.poc.ts`): FIRST_PREFIX '❯ ' (width 2),
// CONTINUATION_PREFIX '    ' (width 4), 20 columns.
const PREFIXES = { first: 2, continuation: 4 }
const COLUMNS = 20

describe('layoutMultilineInput', () => {
  it('wraps asymmetric first/continuation budgets and locates the caret (Q2 hand-derived scenario)', () => {
    const lines = ['你好ab', '0123456789ABCDEFGHIJ']
    const layout = layoutMultilineInput(lines, { row: 1, col: 17 }, COLUMNS, PREFIXES)
    expect(layout.rows.map(row => row.text)).toEqual(['你好ab', '0123456789ABCDEF', 'GHIJ'])
    expect(layout.rows.map(row => row.isFirst)).toEqual([true, false, false])
    expect(layout.cursorX).toBe(1)
    expect(layout.cursorY).toBe(2)
  })

  it('never splits a wide character across a wrap boundary and never exceeds the row budget', () => {
    // A budget (16, continuation) that does not evenly divide the character
    // width (2) plus a total width (18) that does not divide evenly either:
    // an off-by-one implementation would either overflow a row's width or
    // drop/duplicate a character at the wrap boundary.
    const line = '你'.repeat(9)
    const layout = layoutMultilineInput(['', line], { row: 1, col: 0 }, COLUMNS, PREFIXES)
    for (const row of layout.rows.slice(1)) {
      expect(stringWidth(row.text)).toBeLessThanOrEqual(COLUMNS - PREFIXES.continuation)
    }
    expect(layout.rows.slice(1).map(row => row.text).join('')).toBe(line)
  })

  it('lays out a single empty logical line as one empty row', () => {
    const layout = layoutMultilineInput([''], { row: 0, col: 0 }, COLUMNS, PREFIXES)
    expect(layout.rows).toEqual([{ text: '', isFirst: true }])
    expect(layout.cursorX).toBe(0)
    expect(layout.cursorY).toBe(0)
  })

  it('places the caret at the end of the last row when the caret is beyond every rendered row (defensive fallback)', () => {
    // caret.row references a line index beyond `lines.length`, so the
    // cursor-locating pass never finds a match and falls through to the
    // "last row, full width" fallback.
    const layout = layoutMultilineInput(['abc'], { row: 5, col: 0 }, COLUMNS, PREFIXES)
    expect(layout.cursorY).toBe(0)
    expect(layout.cursorX).toBe(3)
  })

  it('locates the caret at the boundary between two wrap segments (caret.col exactly at the budget lands at the end of the first segment)', () => {
    // Continuation budget is 16; a caret at column 16 (the inclusive
    // `<=` comparison) resolves to the END of the first wrap segment
    // (row 1, full width), not the start of the second (row 2, column 0).
    const layout = layoutMultilineInput(['', '0'.repeat(20)], { row: 1, col: 16 }, COLUMNS, PREFIXES)
    expect(layout.cursorY).toBe(1)
    expect(layout.cursorX).toBe(16)
  })

  it('locates the caret on an earlier logical line while later lines exist', () => {
    const layout = layoutMultilineInput(['abc', 'def'], { row: 0, col: 1 }, COLUMNS, PREFIXES)
    expect(layout.cursorY).toBe(0)
    expect(layout.cursorX).toBe(1)
  })

  it('lays out multiple logical lines, each starting a new row at the continuation budget', () => {
    const layout = layoutMultilineInput(['a', 'b', 'c'], { row: 2, col: 1 }, COLUMNS, PREFIXES)
    expect(layout.rows.map(row => row.text)).toEqual(['a', 'b', 'c'])
    expect(layout.rows.map(row => row.isFirst)).toEqual([true, false, false])
    expect(layout.cursorY).toBe(2)
    expect(layout.cursorX).toBe(1)
  })
})
