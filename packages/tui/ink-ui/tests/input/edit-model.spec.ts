import { describe, expect, it } from 'vitest'
import type { Key } from 'ink'
import {
  composerReducer, composerText, EMPTY_COMPOSER_STATE, foldKeypressEvent, isComposerBlank, type ComposerState,
} from '../../src/input/edit-model.ts'

/** A fully-false Key, overridden per test. */
function key(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  }
}

describe('composerReducer', () => {
  it('insert: appends a character at the caret and advances it', () => {
    const next = composerReducer(EMPTY_COMPOSER_STATE, { type: 'insert', text: 'a' })
    expect(next).toEqual({ lines: ['a'], caret: { row: 0, col: 1 } })
  })

  it('insert: inserts a multi-character string (a paste) and advances by its length', () => {
    const next = composerReducer(EMPTY_COMPOSER_STATE, { type: 'insert', text: 'abc' })
    expect(next).toEqual({ lines: ['abc'], caret: { row: 0, col: 3 } })
  })

  it('insert: inserts in the middle of an existing line', () => {
    const state: ComposerState = { lines: ['ac'], caret: { row: 0, col: 1 } }
    const next = composerReducer(state, { type: 'insert', text: 'b' })
    expect(next).toEqual({ lines: ['abc'], caret: { row: 0, col: 2 } })
  })

  it('newline: splits the current line at the caret into two logical lines', () => {
    const state: ComposerState = { lines: ['abcd'], caret: { row: 0, col: 2 } }
    const next = composerReducer(state, { type: 'newline' })
    expect(next).toEqual({ lines: ['ab', 'cd'], caret: { row: 1, col: 0 } })
  })

  it('backspace: deletes the character before the caret on the same line', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 2 } }
    const next = composerReducer(state, { type: 'backspace' })
    expect(next).toEqual({ lines: ['ac'], caret: { row: 0, col: 1 } })
  })

  it('backspace: at column 0 of a non-first line merges into the previous line', () => {
    const state: ComposerState = { lines: ['ab', 'cd'], caret: { row: 1, col: 0 } }
    const next = composerReducer(state, { type: 'backspace' })
    expect(next).toEqual({ lines: ['abcd'], caret: { row: 0, col: 2 } })
  })

  it('backspace: at column 0 of the first line is a no-op', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 0 } }
    expect(composerReducer(state, { type: 'backspace' })).toEqual(state)
  })

  it('left: moves the caret back one column', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 2 } }
    expect(composerReducer(state, { type: 'left' })).toEqual({ lines: ['abc'], caret: { row: 0, col: 1 } })
  })

  it('left: at column 0 is a no-op', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 0 } }
    expect(composerReducer(state, { type: 'left' })).toEqual(state)
  })

  it('right: advances the caret one column', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 1 } }
    expect(composerReducer(state, { type: 'right' })).toEqual({ lines: ['abc'], caret: { row: 0, col: 2 } })
  })

  it('right: at the end of the line is a no-op', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 3 } }
    expect(composerReducer(state, { type: 'right' })).toEqual(state)
  })

  it('up: moves the caret to the start of the previous logical line', () => {
    const state: ComposerState = { lines: ['ab', 'cd'], caret: { row: 1, col: 1 } }
    expect(composerReducer(state, { type: 'up' })).toEqual({ lines: ['ab', 'cd'], caret: { row: 0, col: 0 } })
  })

  it('up: on the first line is a no-op', () => {
    const state: ComposerState = { lines: ['ab'], caret: { row: 0, col: 1 } }
    expect(composerReducer(state, { type: 'up' })).toEqual(state)
  })

  it('down: moves the caret to the start of the next logical line', () => {
    const state: ComposerState = { lines: ['ab', 'cd'], caret: { row: 0, col: 1 } }
    expect(composerReducer(state, { type: 'down' })).toEqual({ lines: ['ab', 'cd'], caret: { row: 1, col: 0 } })
  })

  it('down: on the last line is a no-op', () => {
    const state: ComposerState = { lines: ['ab'], caret: { row: 0, col: 1 } }
    expect(composerReducer(state, { type: 'down' })).toEqual(state)
  })

  it('clear: resets to the empty composer state', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 3 } }
    expect(composerReducer(state, { type: 'clear' })).toEqual(EMPTY_COMPOSER_STATE)
  })

  it('replaceState: adopts the given state verbatim', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 3 } }
    const replacement: ComposerState = { lines: ['xyz', 'w'], caret: { row: 1, col: 1 } }
    expect(composerReducer(state, { type: 'replaceState', state: replacement })).toEqual(replacement)
  })
})

describe('isComposerBlank / composerText', () => {
  it('isComposerBlank is true for the initial empty state', () => {
    expect(isComposerBlank(EMPTY_COMPOSER_STATE)).toBe(true)
  })

  it('isComposerBlank is true across multiple empty logical lines', () => {
    expect(isComposerBlank({ lines: ['', ''], caret: { row: 0, col: 0 } })).toBe(true)
  })

  it('isComposerBlank is false once any line has content', () => {
    expect(isComposerBlank({ lines: ['', 'x'], caret: { row: 0, col: 0 } })).toBe(false)
  })

  it('composerText joins logical lines with \\n', () => {
    expect(composerText({ lines: ['a', 'b'], caret: { row: 0, col: 0 } })).toBe('a\nb')
  })
})

describe('foldKeypressEvent', () => {
  it('Escape leaves the state unchanged and submits nothing (handled by the caller, not the composer)', () => {
    const state: ComposerState = { lines: ['abc'], caret: { row: 0, col: 3 } }
    expect(foldKeypressEvent(state, '', key({ escape: true }))).toEqual({ state, submissions: [] })
  })

  it('Enter without Shift submits non-blank content and clears the state', () => {
    const state: ComposerState = { lines: ['hi'], caret: { row: 0, col: 2 } }
    expect(foldKeypressEvent(state, '', key({ return: true }))).toEqual({
      state: EMPTY_COMPOSER_STATE,
      submissions: ['hi'],
    })
  })

  it('Enter on a blank composer is a no-op (no submission)', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, '', key({ return: true }))).toEqual({
      state: EMPTY_COMPOSER_STATE,
      submissions: [],
    })
  })

  it('Shift+Enter inserts a newline action (kitty-keyboard path) rather than submitting', () => {
    const state: ComposerState = { lines: ['hi'], caret: { row: 0, col: 2 } }
    expect(foldKeypressEvent(state, '', key({ return: true, shift: true }))).toEqual({
      state: composerReducer(state, { type: 'newline' }),
      submissions: [],
    })
  })

  it('a literal \\n byte (Ctrl+J stand-in) inserts a newline without submitting', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, '\n', key())).toEqual({
      state: composerReducer(EMPTY_COMPOSER_STATE, { type: 'newline' }),
      submissions: [],
    })
  })

  it('Backspace applies a backspace transition', () => {
    const state: ComposerState = { lines: ['hi'], caret: { row: 0, col: 2 } }
    expect(foldKeypressEvent(state, '', key({ backspace: true }))).toEqual({
      state: composerReducer(state, { type: 'backspace' }),
      submissions: [],
    })
  })

  it('Delete applies a backspace transition (Q2-proven convention)', () => {
    const state: ComposerState = { lines: ['hi'], caret: { row: 0, col: 2 } }
    expect(foldKeypressEvent(state, '', key({ delete: true }))).toEqual({
      state: composerReducer(state, { type: 'backspace' }),
      submissions: [],
    })
  })

  it('arrow keys apply their directional transitions', () => {
    const state: ComposerState = { lines: ['hi'], caret: { row: 0, col: 1 } }
    expect(foldKeypressEvent(state, '', key({ leftArrow: true }))).toEqual({ state: composerReducer(state, { type: 'left' }), submissions: [] })
    expect(foldKeypressEvent(state, '', key({ rightArrow: true }))).toEqual({ state: composerReducer(state, { type: 'right' }), submissions: [] })
    expect(foldKeypressEvent(state, '', key({ upArrow: true }))).toEqual({ state: composerReducer(state, { type: 'up' }), submissions: [] })
    expect(foldKeypressEvent(state, '', key({ downArrow: true }))).toEqual({ state: composerReducer(state, { type: 'down' }), submissions: [] })
  })

  it('a Ctrl-combo (e.g. Ctrl-C) leaves the state unchanged rather than inserting the character', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, 'c', key({ ctrl: true }))).toEqual({ state: EMPTY_COMPOSER_STATE, submissions: [] })
  })

  it('a Meta-combo leaves the state unchanged', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, 'x', key({ meta: true }))).toEqual({ state: EMPTY_COMPOSER_STATE, submissions: [] })
  })

  it('empty input leaves the state unchanged', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, '', key())).toEqual({ state: EMPTY_COMPOSER_STATE, submissions: [] })
  })

  it('an ordinary printable character inserts it', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, 'a', key())).toEqual({
      state: composerReducer(EMPTY_COMPOSER_STATE, { type: 'insert', text: 'a' }),
      submissions: [],
    })
  })

  it('a pasted multi-character string with no control bytes is one insert carrying the whole string', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, 'hello', key())).toEqual({
      state: composerReducer(EMPTY_COMPOSER_STATE, { type: 'insert', text: 'hello' }),
      submissions: [],
    })
  })

  it('REGRESSION: text with a trailing bare CR merged into one input event still submits (the bundled-write bug)', () => {
    // Reproduces what Ink actually delivers when a driver, a paste, or a fast
    // keystroke burst puts "type text, press Enter" into a single stdin
    // chunk: `useInput` invokes its handler ONCE with the whole run as
    // `input`, and `key.return` is never set (only a lone unmerged `\r`
    // sets it) — see `foldKeypressEvent`'s doc. Before this fix, this exact
    // event inserted the string `'hello\r'` verbatim and never submitted.
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, 'hello\r', key())).toEqual({
      state: EMPTY_COMPOSER_STATE,
      submissions: ['hello'],
    })
  })

  it('REGRESSION: CJK text with a trailing bare CR merged into one input event still submits', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, '请原样输出四个字的暗号：芝麻开门\r', key())).toEqual({
      state: EMPTY_COMPOSER_STATE,
      submissions: ['请原样输出四个字的暗号：芝麻开门'],
    })
  })

  it('a bare CR in the middle of a merged run submits, then continues typing into a fresh composer', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, 'first\rsecond', key())).toEqual({
      state: composerReducer(EMPTY_COMPOSER_STATE, { type: 'insert', text: 'second' }),
      submissions: ['first'],
    })
  })

  it('a CR immediately followed by LF in a merged run is one newline, not a submit (pasted CRLF line endings)', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, 'a\r\nb', key())).toEqual({
      state: { lines: ['a', 'b'], caret: { row: 1, col: 1 } },
      submissions: [],
    })
  })

  it('a bare LF (not part of a CRLF pair) inside a merged run inserts a newline, not a submit', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, 'ab\ncd', key())).toEqual({
      state: { lines: ['ab', 'cd'], caret: { row: 1, col: 2 } },
      submissions: [],
    })
  })

  it('a bare CR at the very start of a merged run (blank composer) is a no-op, then the rest is typed', () => {
    expect(foldKeypressEvent(EMPTY_COMPOSER_STATE, '\rhi', key())).toEqual({
      state: composerReducer(EMPTY_COMPOSER_STATE, { type: 'insert', text: 'hi' }),
      submissions: [],
    })
  })
})
