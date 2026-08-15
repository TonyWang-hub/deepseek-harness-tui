/**
 * Pure multiline-composer edit model: state, reducer, and the key-to-action
 * mapping, factored out of the Q2 reconnaissance fixture
 * (`tests/fixtures/q2-multiline-input-app.tsx`) so the editing semantics are
 * unit-testable without mounting Ink. `Composer.tsx` is a thin binding: it
 * calls {@link mapKeyToAction} from its `useInput` handler and
 * {@link composerReducer} from a `useReducer`.
 * @module @deepseek-ai/dsh-tui-ink-ui/input/edit-model
 */

import type { Key } from 'ink'
import type { Caret } from './layout.ts'

/** The composer's edit-model state: logical lines plus the logical caret. */
export interface ComposerState {
  readonly lines: readonly string[]
  readonly caret: Caret
}

/** The composer's state before any input: one empty logical line, caret at its start. */
export const EMPTY_COMPOSER_STATE: ComposerState = { lines: [''], caret: { row: 0, col: 0 } }

/** One edit-model transition. */
export type ComposerAction =
  | { readonly type: 'insert'; readonly text: string }
  | { readonly type: 'newline' }
  | { readonly type: 'backspace' }
  | { readonly type: 'left' }
  | { readonly type: 'right' }
  | { readonly type: 'up' }
  | { readonly type: 'down' }
  | { readonly type: 'clear' }
  | { readonly type: 'replaceState'; readonly state: ComposerState }

/**
 * Apply one action to the composer state. Every branch returns a fresh
 * state (no mutation), so a caller can safely hold a reference to the prior
 * state (e.g. for an undo stack, not built by this MVP).
 * @param state - current composer state.
 * @param action - the transition to apply.
 * @returns the next composer state.
 *
 * Every `state.lines[state.caret.row]` (or `row - 1`) access below reads
 * `!` rather than falling back on a default: this reducer is the only
 * writer of `caret.row`, and every transition keeps it within
 * `[0, lines.length)` (the `'up'`/`'down'`/`'left'`/`'right'` cases below
 * clamp instead of stepping out of range) — `noUncheckedIndexedAccess`
 * cannot see that invariant, but this function's own transitions enforce it.
 */
export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'insert': {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- caret.row is always a valid lines index; see the function doc
      const characters = Array.from(state.lines[state.caret.row]!)
      characters.splice(state.caret.col, 0, action.text)
      const lines = [...state.lines]
      lines[state.caret.row] = characters.join('')
      return { lines, caret: { row: state.caret.row, col: state.caret.col + Array.from(action.text).length } }
    }
    case 'newline': {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- caret.row is always a valid lines index; see the function doc
      const currentLine = state.lines[state.caret.row]!
      const characters = Array.from(currentLine)
      const before = characters.slice(0, state.caret.col).join('')
      const after = characters.slice(state.caret.col).join('')
      const lines = [...state.lines]
      lines.splice(state.caret.row, 1, before, after)
      return { lines, caret: { row: state.caret.row + 1, col: 0 } }
    }
    case 'backspace': {
      if (state.caret.col > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- caret.row is a valid lines index; see function doc
        const characters = Array.from(state.lines[state.caret.row]!)
        characters.splice(state.caret.col - 1, 1)
        const lines = [...state.lines]
        lines[state.caret.row] = characters.join('')
        return { lines, caret: { row: state.caret.row, col: state.caret.col - 1 } }
      }
      if (state.caret.row > 0) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- row > 0 here, so row - 1 and row are valid lines indices
        const previousLine = state.lines[state.caret.row - 1]!
        const mergedCol = Array.from(previousLine).length
        const lines = [...state.lines]
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- caret.row is a valid lines index; see function doc
        lines[state.caret.row - 1] = previousLine + state.lines[state.caret.row]!
        lines.splice(state.caret.row, 1)
        return { lines, caret: { row: state.caret.row - 1, col: mergedCol } }
      }
      return state
    }
    case 'left':
      return state.caret.col > 0
        ? { lines: state.lines, caret: { row: state.caret.row, col: state.caret.col - 1 } }
        : state
    case 'right': {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- caret.row is always a valid lines index; see the function doc
      const lineLength = Array.from(state.lines[state.caret.row]!).length
      return state.caret.col < lineLength
        ? { lines: state.lines, caret: { row: state.caret.row, col: state.caret.col + 1 } }
        : state
    }
    case 'up':
      return state.caret.row > 0
        ? { lines: state.lines, caret: { row: state.caret.row - 1, col: 0 } }
        : state
    case 'down':
      return state.caret.row < state.lines.length - 1
        ? { lines: state.lines, caret: { row: state.caret.row + 1, col: 0 } }
        : state
    case 'clear':
      return EMPTY_COMPOSER_STATE
    case 'replaceState':
      return action.state
    /* v8 ignore next 2 -- closed-union backstop; every ComposerAction tag is handled above */
    default:
      return state
  }
}

/**
 * Whether the composer holds no content worth sending (every logical line is empty).
 * @param state - current composer state.
 * @returns `true` when every logical line is empty.
 */
export function isComposerBlank(state: ComposerState): boolean {
  return state.lines.every(line => line.length === 0)
}

/**
 * The composer's content as one string, logical lines joined by `\n`.
 * @param state - current composer state.
 * @returns the joined text.
 */
export function composerText(state: ComposerState): string {
  return state.lines.join('\n')
}

/** The result of folding one raw `useInput(input, key)` event through the composer. */
export interface KeypressFold {
  /** The composer state after applying every transition the event produced. */
  readonly state: ComposerState
  /**
   * Text submitted by each bare Enter byte the event contained, in
   * submission order. Empty (never blank strings — a blank composer at a
   * submit point is a no-op, not an empty submission) when the event
   * submitted nothing.
   */
  readonly submissions: readonly string[]
}

/**
 * `state` unchanged, nothing submitted — the fold for an event the composer
 * does not act on itself (Escape, Ctrl-combo, Meta-combo, an empty `input`).
 */
function unchanged(state: ComposerState): KeypressFold {
  return { state, submissions: [] }
}

/** Submit `state`'s text unless it is blank, returning the post-submit (cleared) state either way. */
function submitOrNoop(state: ComposerState): KeypressFold {
  if (isComposerBlank(state)) return unchanged(state)
  return { state: EMPTY_COMPOSER_STATE, submissions: [composerText(state)] }
}

/**
 * Fold one raw `useInput(input, key)` event into the composer, handling the
 * case where Ink merged several logical keystrokes into one `input` string.
 *
 * Ink's own input parser (`ink/build/input-parser.js`'s `parseKeypresses`)
 * splits a raw stdin chunk into escape sequences and individual backspace
 * bytes, but leaves any other run of characters — including an embedded or
 * trailing `\r`/`\n` — as ONE unsplit string ("Other control characters like
 * `\r` and `\t` are NOT split because they can legitimately appear inside
 * pasted text", per that module's own comment). `useInput` then calls its
 * handler once for that whole run, and Ink's `parseKeypress` only sets
 * `key.return` when the ENTIRE chunk was the single byte `\r`. A chunk that
 * arrives as text with a `\r` glued to it — exactly what one `write()` call
 * carrying "prompt text, then Enter" produces, whether from a paste, an
 * automation driver, or a terminal delivering a fast keystroke burst as a
 * single `read()` — previously reached the composer with `key.return` unset
 * and was inserted verbatim, `\r` included: Enter was silently swallowed,
 * nothing submitted, and the text stayed in the composer forever (the
 * pattern this function's regression tests and `Composer.spec.tsx`'s bundled
 * write test both cover).
 *
 * A single already-decoded special key (`key.return`, an arrow, backspace,
 * …) takes the direct path Ink's own decoding already recognized. Otherwise,
 * when `input` contains no `\r`/`\n` at all, it is one plain `insert` exactly
 * as before. Only a run containing `\r` or `\n` is walked character by
 * character: a bare `\r` (not immediately followed by `\n` — a `\r\n` pair,
 * as pasted Windows-style line endings produce, is one newline, not a
 * submit) submits the composer's current text and clears it, so any
 * characters after it in the same run continue into a fresh composer; a
 * `\n` (or the second half of a `\r\n` pair) inserts a newline; every other
 * run of characters between control bytes is one `insert`.
 * @param state - the composer state before this event.
 * @param input - the raw input string `useInput` reports.
 * @param key - the decoded key flags `useInput` reports.
 * @returns the folded state and any text submitted along the way.
 */
export function foldKeypressEvent(state: ComposerState, input: string, key: Key): KeypressFold {
  if (key.escape) return unchanged(state)
  if (key.return) return key.shift ? { state: composerReducer(state, { type: 'newline' }), submissions: [] } : submitOrNoop(state)
  if (input === '\n') return { state: composerReducer(state, { type: 'newline' }), submissions: [] }
  if (key.backspace || key.delete) return { state: composerReducer(state, { type: 'backspace' }), submissions: [] }
  if (key.leftArrow) return { state: composerReducer(state, { type: 'left' }), submissions: [] }
  if (key.rightArrow) return { state: composerReducer(state, { type: 'right' }), submissions: [] }
  if (key.upArrow) return { state: composerReducer(state, { type: 'up' }), submissions: [] }
  if (key.downArrow) return { state: composerReducer(state, { type: 'down' }), submissions: [] }
  if (key.ctrl || key.meta || input === '') return unchanged(state)
  if (!input.includes('\r') && !input.includes('\n')) {
    return { state: composerReducer(state, { type: 'insert', text: input }), submissions: [] }
  }

  const characters = Array.from(input)
  let currentState = state
  const submissions: string[] = []
  let textRun = ''
  const flushTextRun = (): void => {
    if (textRun === '') return
    currentState = composerReducer(currentState, { type: 'insert', text: textRun })
    textRun = ''
  }
  for (let index = 0; index < characters.length; index++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index is always < characters.length inside this loop
    const character = characters[index]!
    if (character === '\r' && characters[index + 1] === '\n') {
      flushTextRun()
      currentState = composerReducer(currentState, { type: 'newline' })
      index++ // consume the paired '\n' too
    } else if (character === '\r') {
      flushTextRun()
      const submitted = submitOrNoop(currentState)
      currentState = submitted.state
      submissions.push(...submitted.submissions)
    } else if (character === '\n') {
      flushTextRun()
      currentState = composerReducer(currentState, { type: 'newline' })
    } else {
      textRun += character
    }
  }
  flushTextRun()
  return { state: currentState, submissions }
}
