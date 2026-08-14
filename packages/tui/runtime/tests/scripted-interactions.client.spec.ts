/**
 * Real-composition slice: a scripted model turn that asks one ask-user
 * question and requires one approval, both answered from the Client
 * Runtime's pending-interaction carrier (`PendingWait.respond()`) exactly as
 * a terminal renderer would — never through a hand-registered
 * `UserQuestionProvider`/approval listener (the Host ApiProxy already
 * registers the sole ones; this package must not shadow them).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions, PendingInteraction } from '@deepseek-ai/dsh-client-runtime/client'
import '@deepseek-ai/dsh-tui-runtime'
import { bootHostTree, type ComposedTree } from './compose.client.ts'

/** One scripted `finish: tool-calls` model reply carrying exactly one tool call. */
function toolCallEntry(id: string, name: string, args: Record<string, unknown>): unknown {
  const argsJson = JSON.stringify(args)
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argsJson },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argsJson } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
  }
}

/** One scripted `finish: stop` model reply carrying only final text. */
function textEntry(text: string): unknown {
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }
}

/**
 * The scripted turn: ask_user_question, then bash without escalation
 * (sandbox denies it under the composition's read-only mode — no
 * interaction, just an error tool result), then bash WITH
 * `sandbox_permissions`/`justification` (the escalation retry the denial
 * message instructs — this is what routes through `ctx.approval.request()`),
 * then final text. Matches the shipped bash tool's real escalation contract,
 * exercised for real by `apps/web/tests/approval-composer.e2e.ts`.
 */
const SCRIPT = [
  toolCallEntry('call-ask-1', 'ask_user_question', {
    questions: [{ id: 'mode', question: 'Which mode?', options: [{ label: 'fast' }, { label: 'thorough' }] }],
  }),
  toolCallEntry('call-bash-1', 'bash', { command: 'echo hi > notes.txt', description: 'Write notes.txt' }),
  toolCallEntry('call-bash-2', 'bash', {
    command: 'echo hi > notes.txt',
    description: 'Write notes.txt',
    sandbox_permissions: 'workspace-write',
    justification: 'the user asked to write the file',
  }),
  textEntry('Done.'),
]

describe('tui-runtime: scripted turn answers ask-user and approval through the pending carrier', () => {
  let tree: ComposedTree
  let clientCtx: Context
  let connection: ConnectionHandle
  let overrideFile: string

  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tui-runtime-replay-'))
    overrideFile = join(dir, 'replay.override.json')
    await writeFile(overrideFile, JSON.stringify(SCRIPT))
    tree = await bootHostTree({ llmReplay: { overrideFile } })
    clientCtx = tree.ctx.tuiRuntime.clientCtx
    connection = clientCtx.get('connection') as ConnectionHandle
    await vi.waitFor(() => {
      expect(connection.hostDescription.getSnapshot()).not.toBeUndefined()
    }, { timeout: 5_000, interval: 20 })
  }, 30_000)

  afterAll(async () => {
    await tree.dispose()
    await rm(join(overrideFile, '..'), { recursive: true, force: true })
  })

  it('answers one ask-user question and one approval from the pending carrier, and completes the turn', async () => {
    const created = await connection.api.sessions.create({})
    if (!created.result.ok) throw new Error(`session.create failed: ${created.result.error.code}`)
    const sessionId: SessionId = created.result.value.sessionId

    const sessions = clientCtx.get('sessions') as ISessions
    // host/session-added arrives over the already-open Host stream; the
    // session.create RPC may settle slightly before or after it, so wait for
    // the list projection rather than assuming ordering.
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().ids).toContain(sessionId)
    }, { timeout: 5_000, interval: 20 })
    sessions.open(sessionId)
    const scope = sessions.scope(sessionId)
    if (scope === undefined) throw new Error('sessions.scope(sessionId) is undefined after open()')
    const face = sessions.sessionOf(scope)
    if (face === undefined) throw new Error('sessions.sessionOf(scope) is undefined after open()')

    // Authoritative Host-side completion signal for this turn (independent
    // of any Client-side chat/view projection, which stays empty without a
    // mounted ui-conversation event/view registration — out of scope for
    // this dual-context-bootstrap package, which ships no renderer).
    const hostTurnEnded = new Promise<void>((resolve) => {
      const off = (tree.ctx as unknown as { on: (event: string, fn: (...args: unknown[]) => void) => () => void }).on(
        'session/event',
        (...args: unknown[]) => {
          const event = args[1] as { type: string }
          if (event.type !== 'turn/end') return
          off()
          resolve()
        },
      )
    })

    const prompted = await connection.api.sessions.prompt({
      sessionId, mode: 'queue', content: [{ type: 'text', text: 'Please write notes.txt for me.' }],
    })
    if (!prompted.result.ok) throw new Error(`session.prompt failed: ${prompted.result.error.code}`)

    const findPending = (kind: PendingInteraction['kind']): PendingInteraction | undefined =>
      face.getSnapshot().pending.find(entry => entry.kind === kind)

    await vi.waitFor(() => {
      expect(findPending('question')).not.toBeUndefined()
    }, { timeout: 10_000, interval: 20 })
    const question = findPending('question')
    if (question === undefined || question.kind !== 'question') throw new Error('question pending wait missing')
    await question.respond({
      ok: true,
      value: {
        sessionId,
        answer: { answers: question.payload.questions.map(item => ({ id: item.id, selected: ['fast'] })) },
      },
    })

    await vi.waitFor(() => {
      expect(findPending('approval')).not.toBeUndefined()
    }, { timeout: 10_000, interval: 20 })
    const approval = findPending('approval')
    if (approval === undefined || approval.kind !== 'approval') throw new Error('approval pending wait missing')
    await approval.respond({
      ok: true,
      value: { sessionId, approvalId: approval.payload.approvalId, outcome: 'allowed-once' },
    })

    await Promise.race([
      hostTurnEnded,
      new Promise((_resolve, reject) => {
        setTimeout(() => { reject(new Error('turn/end did not fire within 10s')) }, 10_000)
      }),
    ])

    // Once the Host settles the turn, the Client's own pending/running state
    // (pumped over the same mux/host streams this test's connection already
    // reads) reflects it within one microtask tick.
    await vi.waitFor(() => {
      expect(face.getSnapshot().pending).toEqual([])
      expect(face.getSnapshot().running).toBe(false)
    }, { timeout: 5_000, interval: 20 })
  }, 30_000)
})
