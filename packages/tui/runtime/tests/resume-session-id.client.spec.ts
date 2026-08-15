/**
 * `Config.resumeSessionId` passthrough: proves `apply()` forwards a
 * configured id to `mountTuiRenderer`'s `MountOptions.sessionId` unchanged,
 * and omits the key entirely (never `sessionId: undefined`) when unset — the
 * one behavior `apply.client.spec.ts` does not cover, since its own renderer
 * assertions exercise the real `mountTuiRenderer` against a 404 fetch stub.
 * This file mocks `@deepseek-ai/dsh-tui-ink-ui` instead, so it must not share
 * a module registry with a suite that relies on the real renderer.
 */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { HostConnectionLike } from '../src/types.ts'

const mountTuiRenderer = vi.fn(async (_clientCtx: unknown, _options?: Record<string, unknown>) => ({
  sessionId: 'fake-session-id',
  waitUntilExit: async () => {},
  dispose: async () => {},
}))

vi.mock('@deepseek-ai/dsh-tui-ink-ui', () => ({ mountTuiRenderer }))

/** A `{ fetch }` stub — the mocked renderer above never calls it. */
function fetchStub(): { fetch: typeof fetch } {
  return { fetch: () => Promise.resolve(new Response('not found', { status: 404 })) }
}

/** A minimal fake TTY `process.stdout` (see `apply.client.spec.ts`'s own copy). */
function fakeTtyStdout(): NodeJS.WriteStream & { fd: 1 } {
  const emitter = new EventEmitter() as unknown as NodeJS.WriteStream & { fd: 1 }
  Object.assign(emitter, { columns: 80, rows: 24, isTTY: true, fd: 1, write: () => true })
  return emitter
}

describe('tui-runtime apply(): Config.resumeSessionId passthrough', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mountTuiRenderer.mockClear()
  })

  it('forwards a configured resumeSessionId as MountOptions.sessionId', async () => {
    vi.spyOn(process, 'stdout', 'get').mockReturnValue(fakeTtyStdout())
    const { apply, inject } = await import('../src/index.ts')
    const ctx = new Context()
    const hostConnection: HostConnectionLike = { inProcessHandler: () => fetchStub() }
    ctx.provide('connection', hostConnection)
    ctx.provide('apiProxy', {})
    const fiber = ctx.plugin({ apply, inject }, { render: true, resumeSessionId: 'session-to-resume' })
    await fiber.await()
    try {
      expect(mountTuiRenderer).toHaveBeenCalledTimes(1)
      expect(mountTuiRenderer).toHaveBeenCalledWith(expect.anything(), { sessionId: 'session-to-resume' })
    } finally {
      await fiber.dispose()
    }
  }, 20_000)

  it('omits sessionId entirely (never sessionId: undefined) when resumeSessionId is unset', async () => {
    vi.spyOn(process, 'stdout', 'get').mockReturnValue(fakeTtyStdout())
    const { apply, inject } = await import('../src/index.ts')
    const ctx = new Context()
    const hostConnection: HostConnectionLike = { inProcessHandler: () => fetchStub() }
    ctx.provide('connection', hostConnection)
    ctx.provide('apiProxy', {})
    const fiber = ctx.plugin({ apply, inject }, { render: true })
    await fiber.await()
    try {
      expect(mountTuiRenderer).toHaveBeenCalledTimes(1)
      const options = mountTuiRenderer.mock.calls[0]?.[1] as Record<string, unknown>
      expect(options).toEqual({})
      expect('sessionId' in options).toBe(false)
    } finally {
      await fiber.dispose()
    }
  }, 20_000)
})
