import { describe, expect, it } from 'vitest'
import type { Key } from 'ink'
import {
  composerReducer, composerText, EMPTY_COMPOSER_STATE, isComposerBlank, mapKeyToAction, type ComposerState,
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

describe('mapKeyToAction', () => {
  it('Escape returns null (handled by the caller, not the composer)', () => {
    expect(mapKeyToAction('', key({ escape: true }))).toBeNull()
  })

  it('Enter without Shift returns submit', () => {
    expect(mapKeyToAction('', key({ return: true }))).toBe('submit')
  })

  it('Shift+Enter returns a newline action (kitty-keyboard path)', () => {
    expect(mapKeyToAction('', key({ return: true, shift: true }))).toEqual({ type: 'newline' })
  })

  it('a literal \\n byte (Ctrl+J stand-in) returns a newline action', () => {
    expect(mapKeyToAction('\n', key())).toEqual({ type: 'newline' })
  })

  it('Backspace returns a backspace action', () => {
    expect(mapKeyToAction('', key({ backspace: true }))).toEqual({ type: 'backspace' })
  })

  it('Delete returns a backspace action (Q2-proven convention)', () => {
    expect(mapKeyToAction('', key({ delete: true }))).toEqual({ type: 'backspace' })
  })

  it('arrow keys map to their directional actions', () => {
    expect(mapKeyToAction('', key({ leftArrow: true }))).toEqual({ type: 'left' })
    expect(mapKeyToAction('', key({ rightArrow: true }))).toEqual({ type: 'right' })
    expect(mapKeyToAction('', key({ upArrow: true }))).toEqual({ type: 'up' })
    expect(mapKeyToAction('', key({ downArrow: true }))).toEqual({ type: 'down' })
  })

  it('a Ctrl-combo (e.g. Ctrl-C) returns null rather than inserting the character', () => {
    expect(mapKeyToAction('c', key({ ctrl: true }))).toBeNull()
  })

  it('a Meta-combo returns null', () => {
    expect(mapKeyToAction('x', key({ meta: true }))).toBeNull()
  })

  it('empty input returns null', () => {
    expect(mapKeyToAction('', key())).toBeNull()
  })

  it('an ordinary printable character returns an insert action', () => {
    expect(mapKeyToAction('a', key())).toEqual({ type: 'insert', text: 'a' })
  })

  it('a pasted multi-character string returns one insert action carrying the whole string', () => {
    expect(mapKeyToAction('hello', key())).toEqual({ type: 'insert', text: 'hello' })
  })
})
