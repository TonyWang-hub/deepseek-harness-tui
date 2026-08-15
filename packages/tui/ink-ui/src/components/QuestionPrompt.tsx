/**
 * The question prompt: renders one pending `question` interaction's first
 * sub-question as an option list (arrow keys or a number key select; Enter
 * confirms the highlighted option) and answers it through
 * `PendingWait.respond()`, exactly like `ApprovalPrompt.tsx`.
 *
 * MVP scope: only the FIRST entry of `payload.questions` is answerable — an
 * `ask_user_question` call with more than one sub-question, or a sub-question
 * with no `options` (free text), shows an informational line instead of
 * blocking; see `README.md`'s Known Limitations. The scripted single-question
 * shape `scripted-interactions.client.spec.ts` exercises is the common case
 * this covers fully.
 *
 * Deliberately NOT wrapped in `React.memo` — see `Composer.tsx`'s module doc
 * for the verified `useInput`/`useEffectEvent`/`React.memo` staleness
 * interaction this component would otherwise hit too.
 * @module @deepseek-ai/dsh-tui-ink-ui/components/QuestionPrompt
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import { style } from '../ansi/style.ts'

export interface QuestionPromptProps {
  /** The pending question to render and answer. */
  readonly question: Extract<PendingInteraction, { kind: 'question' }>
  /** Whether this prompt currently owns keyboard input (see `Composer.tsx`'s `isActive` doc). Default `true`. */
  readonly isActive?: boolean
}

/** A single digit 1-9, for number-key option selection. */
function digitIndex(input: string): number | undefined {
  return /^[1-9]$/.test(input) ? Number(input) - 1 : undefined
}

/**
 * Render one pending question's first sub-question as a selectable option list.
 * @param props - see {@link QuestionPromptProps}.
 * @returns the prompt element.
 */
export function QuestionPrompt({ question, isActive = true }: QuestionPromptProps): React.JSX.Element {
  const item = question.payload.questions[0]
  const options = item?.options ?? []
  const [cursor, setCursor] = useState(0)
  const [answered, setAnswered] = useState(false)

  useInput((input, key) => {
    if (answered || item === undefined || options.length === 0) return
    if (key.upArrow) {
      setCursor(previous => (previous > 0 ? previous - 1 : previous))
      return
    }
    if (key.downArrow) {
      setCursor(previous => (previous < options.length - 1 ? previous + 1 : previous))
      return
    }
    const chosenIndex = digitIndex(input) ?? (key.return ? cursor : undefined)
    if (chosenIndex === undefined || chosenIndex >= options.length) return
    // chosenIndex is bounded by the check above (0 <= chosenIndex < options.length).
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- see comment above
    const option = options[chosenIndex]!
    setAnswered(true)
    question.respond({
      ok: true,
      value: {
        sessionId: question.sessionId,
        answer: { answers: [{ id: item.id, selected: [option.label] }] },
      },
    }).catch((error: unknown) => {
      // See ApprovalPrompt's identical catch: no second chance to answer once settled or a wire failure occurs.
      console.error('QuestionPrompt: respond() failed', error)
    })
  }, { isActive })

  if (item === undefined) {
    return <Text>{style.error('[question: malformed payload — no questions]')}</Text>
  }

  return (
    <Box flexDirection="column">
      <Text>{style.title(item.question)}</Text>
      {question.payload.questions.length > 1 && (
        <Text>{style.dim('[only the first of multiple sub-questions is answerable here]')}</Text>
      )}
      {options.length === 0
        ? <Text>{style.dim('[free-text questions are not yet supported by this composer]')}</Text>
        : options.map((option, index) => (
          <Text key={option.label}>
            {index === cursor ? style.title('›') : ' '}
            {` ${index + 1}. ${option.label}`}
          </Text>
        ))}
    </Box>
  )
}
