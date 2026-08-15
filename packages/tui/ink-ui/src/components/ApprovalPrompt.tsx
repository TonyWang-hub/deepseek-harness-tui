/**
 * The approval prompt: renders one pending `approval` interaction and
 * answers it through `PendingWait.respond()` — the same carrier the web
 * face uses (`scripted-interactions.client.spec.ts`), never a second
 * `UserQuestionProvider`/approval listener (the Host ApiProxy already
 * registers the sole ones; a terminal-side registration would be a
 * `DUPLICATE_PROVIDER` error — see the official-terminal-application Agent
 * Note's "Interaction surface").
 *
 * Deliberately NOT wrapped in `React.memo` — see `Composer.tsx`'s module doc
 * for the verified `useInput`/`useEffectEvent`/`React.memo` staleness
 * interaction this component would otherwise hit too.
 * @module @deepseek-ai/dsh-tui-ink-ui/components/ApprovalPrompt
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import { style } from '../ansi/style.ts'

export interface ApprovalPromptProps {
  /** The pending approval to render and answer. */
  readonly approval: Extract<PendingInteraction, { kind: 'approval' }>
  /** Whether this prompt currently owns keyboard input (see `Composer.tsx`'s `isActive` doc). Default `true`. */
  readonly isActive?: boolean
}

/**
 * Render one pending approval as a y/n prompt.
 * @param props - see {@link ApprovalPromptProps}.
 * @returns the prompt element.
 */
export function ApprovalPrompt({ approval, isActive = true }: ApprovalPromptProps): React.JSX.Element {
  const [answered, setAnswered] = useState(false)

  useInput((input) => {
    if (answered) return
    const key = input.toLowerCase()
    if (key !== 'y' && key !== 'n') return
    setAnswered(true)
    approval.respond({
      ok: true,
      value: {
        sessionId: approval.sessionId,
        approvalId: approval.payload.approvalId,
        outcome: key === 'y' ? 'allowed-once' : 'rejected',
      },
    }).catch((error: unknown) => {
      // respond() rejects only if this PendingWait was already settled (a
      // race this component's own `answered` guard already prevents from
      // this side) or the wire receipt itself failed; either way there is no
      // second chance to answer from here, so this is a diagnostic, not a
      // recoverable path.
      console.error('ApprovalPrompt: respond() failed', error)
    })
  }, { isActive })

  return (
    <Box flexDirection="column">
      <Text>
        {style.title(`Approve ${approval.payload.toolName}?`)}
        {approval.payload.reason !== undefined ? ` — ${approval.payload.reason}` : ''}
      </Text>
      <Text>{style.dim('[y] allow once   [n] reject')}</Text>
    </Box>
  )
}
