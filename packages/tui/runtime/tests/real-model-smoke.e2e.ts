/**
 * Real-API e2e smoke: the same "process-wide, single-session" host tree
 * `compose.client.ts`'s `bootHostTree` assembles for every keyless
 * `*.client.spec.ts` in this directory, but with `dsh-base`'s own
 * `llm-deepseek` row left mounted (`realModel: true`) instead of the
 * `llm-replay` override those specs use — so the composition sends one
 * prompt to the real DeepSeek API and completes a real conversation turn.
 * Self-skips without `DEEPSEEK_API_KEY` (repo e2e convention:
 * `docs/testing.md` § "The with-key policy"); `vitest.e2e.config.ts` loads
 * the repo-root `.env` before this file runs.
 *
 * Assertion strategy: the final assistant text is read from the Host tree's
 * own `session/event` stream, never from the client-side face nor the
 * agent's own self-report — an e2e concern independent of transcript-content
 * assertions (`tui-runtime` does mount the Chat business Definitions via
 * `registerConversationNodes`, so the client-side face is no longer empty;
 * see `cordis-yml-file-boot.client.spec.ts` for client-face transcript
 * assertions over a scripted, deterministic turn).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import '@deepseek-ai/dsh-tui-runtime'
import { bootHostTree, type ComposedTree } from './compose.client.ts'

const hasKey = Boolean(process.env.DEEPSEEK_API_KEY)

const PROMPT_TEXT = '用一句话回答：1+1=?'

/** `net.Server`-shaped active handle (mirrors `cordis-yml-file-boot.client.spec.ts`'s own check). */
interface ServerLikeHandle {
  listening?: unknown
  address?: unknown
}

function activeServerHandles(): unknown[] {
  const getActiveHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles
  if (getActiveHandles === undefined) throw new Error('process._getActiveHandles is unavailable on this Node build')
  return getActiveHandles.call(process).filter((handle): handle is ServerLikeHandle => {
    if (typeof handle !== 'object' || handle === null) return false
    const candidate = handle as ServerLikeHandle
    return typeof candidate.listening === 'boolean' && typeof candidate.address === 'function'
  })
}

describe.skipIf(!hasKey)('tui-runtime: real DeepSeek API turn through the dual-Context composition', () => {
  let tree: ComposedTree
  let clientCtx: Context
  let connection: ConnectionHandle

  beforeAll(async () => {
    tree = await bootHostTree({ realModel: true })
    clientCtx = tree.ctx.tuiRuntime.clientCtx
    connection = clientCtx.get('connection') as ConnectionHandle
    await vi.waitFor(() => {
      expect(connection.hostDescription.getSnapshot()).not.toBeUndefined()
    }, { timeout: 5_000, interval: 20 })
  }, 30_000)

  afterAll(async () => {
    await tree.dispose()
  })

  it('opens no listening socket for the whole real-model host tree', () => {
    expect(activeServerHandles()).toEqual([])
  })

  it('prompts the real DeepSeek API, completes the turn, and reads the final assistant text back from the Host session-event stream', async () => {
    const created = await connection.api.sessions.create({})
    if (!created.result.ok) throw new Error(`session.create failed: ${created.result.error.code}`)
    const sessionId: SessionId = created.result.value.sessionId

    const sessions = clientCtx.get('sessions') as ISessions
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().ids).toContain(sessionId)
    }, { timeout: 5_000, interval: 20 })
    sessions.open(sessionId)
    const scope = sessions.scope(sessionId)
    if (scope === undefined) throw new Error('sessions.scope(sessionId) is undefined after open()')
    const face = sessions.sessionOf(scope)
    if (face === undefined) throw new Error('sessions.sessionOf(scope) is undefined after open()')

    // Authoritative Host-side completion signal (see the module doc's
    // "Assertion strategy" note): listen to the Host tree's own
    // `session/event` stream for the assistant's final text and the turn end.
    let hostFinalText: string | undefined
    const turnStartedAt = Date.now()
    let turnEndedAt: number | undefined
    const hostTurnEnded = new Promise<void>((resolve) => {
      const off = (tree.ctx as unknown as { on: (event: string, fn: (...args: unknown[]) => void) => () => void }).on(
        'session/event',
        (...args: unknown[]) => {
          const event = args[1] as { type: string; data?: { message?: { content?: { type: string; text?: string }[] } } }
          if (event.type === 'assistant/message') {
            const textBlock = event.data?.message?.content?.find(block => block.type === 'text')
            if (textBlock?.text !== undefined) hostFinalText = textBlock.text
          }
          if (event.type !== 'turn/end') return
          turnEndedAt = Date.now()
          off()
          resolve()
        },
      )
    })

    const prompted = await connection.api.sessions.prompt({
      sessionId, mode: 'queue', content: [{ type: 'text', text: PROMPT_TEXT }],
    })
    if (!prompted.result.ok) throw new Error(`session.prompt failed: ${prompted.result.error.code}`)

    await Promise.race([
      hostTurnEnded,
      new Promise((_resolve, reject) => {
        setTimeout(() => { reject(new Error('turn/end did not fire within 90s')) }, 90_000)
      }),
    ])

    await vi.waitFor(() => {
      expect(face.getSnapshot().running).toBe(false)
      expect(face.getSnapshot().pending).toEqual([])
    }, { timeout: 5_000, interval: 20 })

    // Real-API e2e evidence for the harness operator: turn text and timing.
    // Never a credential — DEEPSEEK_API_KEY resolves inside llm-deepseek's own
    // adapter and is never read, echoed, or logged by this test.
    console.log(JSON.stringify({
      sessionId,
      prompt: PROMPT_TEXT,
      finalText: hostFinalText,
      turnDurationMs: turnEndedAt === undefined ? undefined : turnEndedAt - turnStartedAt,
    }))

    expect(hostFinalText).not.toBeUndefined()
    expect((hostFinalText ?? '').trim().length).toBeGreaterThan(0)
  }, 100_000)
})
