/**
 * The multiline composer: a from-scratch borderless multiline input (Q2
 * reconnaissance verdict — no maintained Ink package covers asymmetric
 * first-line/continuation prefixes with CJK-aware wrapping; see
 * `tests/q2-multiline-input.poc.ts`). This component is a thin Ink binding
 * over the Ink-free edit model (`input/edit-model.ts`) and layout algorithm
 * (`input/layout.ts`): it owns no editing logic itself, only the
 * `useReducer`/`useInput`/`useCursor` wiring.
 *
 * Enter submits (empty content is a no-op per the D2.2 acceptance
 * criterion); Shift+Enter inserts a newline where the kitty keyboard
 * protocol reports it distinctly, and a literal `\n` byte (Ctrl+J) is the
 * documented stand-in everywhere else — no terminal reliably reports
 * Shift+Enter without that protocol (see `input/edit-model.ts`'s module doc).
 * Every `useInput` event — including one where Ink merged pasted/bulk text
 * together with a trailing or embedded Enter byte into a single `input`
 * string — is folded through `foldKeypressEvent` (`input/edit-model.ts`),
 * which submits/breaks lines at each control byte in the batch rather than
 * only recognizing a lone, unmerged `\r` (see that function's doc).
 *
 * Deliberately NOT wrapped in `React.memo`: verified against this package's
 * exact Ink 7.1.1/React 19.2.8 pin, `useInput`'s handler (`ink/build/hooks/use-input.js`,
 * built on React's `useEffectEvent` for its "always the latest closure"
 * guarantee) reads a STALE closure over this component's own state on every
 * call after the first once the component is memoized — `React.memo`
 * defeats `useEffectEvent`'s freshness guarantee for a component with no
 * changing props (this component takes only `onSubmit`/`isActive`, so a
 * memoized instance never sees a props-driven re-render at all, and
 * `useEffectEvent`'s update path apparently rides that same re-render).
 * Confirmed with a minimal reproduction outside this package's own code
 * before ruling it a framework interaction rather than a bug here; do not
 * reapply `React.memo` to this component without re-verifying against
 * whatever Ink/React versions are current at the time.
 * @module @deepseek-ai/dsh-tui-ink-ui/components/Composer
 */

import React, { useReducer } from 'react'
import { Box, Text, useCursor, useInput, useStdout } from 'ink'
import stringWidth from 'string-width'
import { composerReducer, EMPTY_COMPOSER_STATE, foldKeypressEvent } from '../input/edit-model.ts'
import { layoutMultilineInput, type PrefixWidths } from '../input/layout.ts'

/** First-line prefix, per the D2.2 brief. */
const FIRST_PREFIX = '❯ '
/** Continuation-line prefix — the same display width as {@link FIRST_PREFIX}, per the D2.2 brief. */
const CONTINUATION_PREFIX = '  '

const PREFIX_WIDTHS: PrefixWidths = {
  first: stringWidth(FIRST_PREFIX),
  continuation: stringWidth(CONTINUATION_PREFIX),
}

/** Fallback terminal width when `stdout.columns` is unavailable (e.g. a non-TTY test double). */
const FALLBACK_COLUMNS = 80

export interface ComposerProps {
  /** Called with the joined (`\n`-separated) text on submit; never called for a blank submit. */
  readonly onSubmit: (text: string) => void
  /**
   * Whether the composer currently owns keyboard input. `false` while an
   * approval or question prompt is focused instead — exactly one of
   * Composer/ApprovalPrompt/QuestionPrompt is active at a time, so a
   * keystroke is never handled twice. Default `true`.
   */
  readonly isActive?: boolean
  /**
   * Rows the activity region renders above this composer in the current
   * frame (the streaming tail, running-tool rows, and the queued-input hint —
   * whatever `ActivityRegion` measures itself to occupy before mounting the
   * composer). `useCursor`'s position is relative to Ink's own output origin
   * (`ink/build/hooks/use-cursor.js`), not to this component's local rows, so
   * the caller's real frame offset — not this component's own row index —
   * must land in the position it reports. Default `0`.
   */
  readonly rowOffset?: number
}

/**
 * Render the multiline composer.
 * @param props - see {@link ComposerProps}.
 * @returns the composer element.
 */
export function Composer({ onSubmit, isActive = true, rowOffset = 0 }: ComposerProps): React.JSX.Element {
  const [state, dispatch] = useReducer(composerReducer, EMPTY_COMPOSER_STATE)
  const { stdout } = useStdout()
  const { setCursorPosition } = useCursor()
  const columns = stdout.columns > 0 ? stdout.columns : FALLBACK_COLUMNS

  useInput((input, key) => {
    const { state: nextState, submissions } = foldKeypressEvent(state, input, key)
    for (const text of submissions) onSubmit(text)
    if (nextState !== state) dispatch({ type: 'replaceState', state: nextState })
  }, { isActive })

  const layout = layoutMultilineInput(state.lines, state.caret, columns, PREFIX_WIDTHS)
  const cursorRow = layout.rows[layout.cursorY]
  const cursorPrefixWidth = cursorRow?.isFirst === true ? PREFIX_WIDTHS.first : PREFIX_WIDTHS.continuation
  setCursorPosition(isActive ? { x: cursorPrefixWidth + layout.cursorX, y: rowOffset + layout.cursorY } : undefined)

  return (
    <Box flexDirection="column">
      {layout.rows.map((row, index) => (
        <Text key={index}>{(row.isFirst ? FIRST_PREFIX : CONTINUATION_PREFIX) + row.text}</Text>
      ))}
    </Box>
  )
}
