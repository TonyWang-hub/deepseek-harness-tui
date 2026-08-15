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

/**
 * Map one `useInput` event to a composer transition, or `'submit'`
 * (Enter without Shift — a real Shift+Enter needs the kitty keyboard
 * protocol; `key.shift` is only populated under it, see the module doc),
 * or `null` for an event the composer does not handle itself (Escape,
 * Ctrl-C, unmapped navigation keys) so the caller's own handler runs instead.
 *
 * A literal `\n` byte (`input === '\n'`, sent as Ctrl+J by a terminal or a
 * pasted multi-line string's line boundary) inserts a newline without
 * submitting, exactly like Shift+Enter under the kitty protocol — the Q2
 * reconnaissance fixture's proven stand-in for terminals that cannot report
 * Shift+Enter distinctly.
 * @param input - the raw input string `useInput` reports.
 * @param key - the decoded key flags `useInput` reports.
 * @returns the action to apply, `'submit'`, or `null`.
 */
export function mapKeyToAction(input: string, key: Key): ComposerAction | 'submit' | null {
  if (key.escape) return null
  if (key.return) return key.shift ? { type: 'newline' } : 'submit'
  if (input === '\n') return { type: 'newline' }
  if (key.backspace || key.delete) return { type: 'backspace' }
  if (key.leftArrow) return { type: 'left' }
  if (key.rightArrow) return { type: 'right' }
  if (key.upArrow) return { type: 'up' }
  if (key.downArrow) return { type: 'down' }
  if (key.ctrl || key.meta || input === '') return null
  return { type: 'insert', text: input }
}
