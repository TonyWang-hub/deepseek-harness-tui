/**
 * Direct unit coverage of `apply()` itself: a hand-built Host `Context`
 * providing a minimal `HostConnectionLike` stub, mounted through
 * `ctx.plugin()` exactly like `client-apply.client.spec.ts` mounts the
 * Connection client half. The real-composition slices
 * (`connect-and-reconnect.client.spec.ts`, `scripted-interactions.client.spec.ts`)
 * exercise this same `apply()` through a real Loader-booted Host tree, whose
 * plugin resolution goes through the package's BUILT `lib/index.js` — a
 * separate module instance vitest's coverage instrumentation never sees.
 * This file imports `../src/index.ts` directly so the function body itself
 * is covered.
 */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { apply, inject, name } from '../src/index.ts'
import type { HostConnectionLike } from '../src/types.ts'

/** A `{ fetch }` stub that answers every request 404 — apply() never awaits the connect loop's own success. */
function fetchStub(): { fetch: typeof fetch } {
  return { fetch: () => Promise.resolve(new Response('not found', { status: 404 })) }
}

/**
 * A minimal fake TTY `process.stdout`, for exercising `Config.render`'s
 * `process.stdout.isTTY` gate without a real terminal. Declares `fd: 1`:
 * `vi.spyOn(process, 'stdout', 'get')` targets `NodeJS.WriteStream & { fd: 1 }`,
 * `process.stdout`'s exact type, under `exactOptionalPropertyTypes`.
 */
function fakeTtyStdout(): NodeJS.WriteStream & { fd: 1 } {
  const emitter = new EventEmitter() as unknown as NodeJS.WriteStream & { fd: 1 }
  Object.assign(emitter, { columns: 80, rows: 24, isTTY: true, fd: 1, write: () => true })
  return emitter
}

describe('tui-runtime apply()', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the stable plugin identity', () => {
    expect(name).toBe('tui-runtime')
    expect(inject).toEqual(['connection'])
  })

  it('boots the Client tree over the injected HostConnectionLike and provides ctx.tuiRuntime', async () => {
    const ctx = new Context()
    const hostConnection: HostConnectionLike = { inProcessHandler: () => fetchStub() }
    ctx.provide('connection', hostConnection)
    // `render: false`: these fixtures build a bare Host `Context` with no
    // real terminal/session tree behind it, so mounting a real Ink renderer
    // would be meaningless (and `process.stdout.isTTY` is false under
    // vitest anyway, which alone would skip it — passed explicitly here so
    // this test's intent does not depend on that environmental fact).
    const fiber = ctx.plugin({ apply, inject }, { render: false })
    await fiber.await()
    try {
      const handle = ctx.get('tuiRuntime')
      if (handle === undefined) throw new Error('ctx.tuiRuntime was not provided')
      const clientConnection = handle.clientCtx.get('connection') as ConnectionHandle | undefined
      expect(clientConnection).toBeDefined()
      expect(clientConnection?.isLoopback).toBe(true)
    } finally {
      await fiber.dispose()
    }
  })

  it('disposes the Client tree when the Host row unmounts', async () => {
    const ctx = new Context()
    const hostConnection: HostConnectionLike = { inProcessHandler: () => fetchStub() }
    ctx.provide('connection', hostConnection)
    // `render: false`: these fixtures build a bare Host `Context` with no
    // real terminal/session tree behind it, so mounting a real Ink renderer
    // would be meaningless (and `process.stdout.isTTY` is false under
    // vitest anyway, which alone would skip it — passed explicitly here so
    // this test's intent does not depend on that environmental fact).
    const fiber = ctx.plugin({ apply, inject }, { render: false })
    await fiber.await()
    const handle = ctx.get('tuiRuntime')
    if (handle === undefined) throw new Error('ctx.tuiRuntime was not provided')
    const clientCtx = handle.clientCtx
    await fiber.dispose()
    expect(clientCtx.get('connection')).toBeUndefined()
  })

  it('attempts the renderer mount when config.render is true and process.stdout is a TTY, and cleans up if it fails', async () => {
    // This fixture's `fetchStub()` answers every request 404 (including
    // `session.create`), so `mountTuiRenderer` itself fails here — this
    // test's own scope is `config.render && process.stdout.isTTY` selecting
    // the mount attempt and apply()'s own cleanup on a failed mount, not a
    // successful end-to-end render (`pty-smoke.client.spec.ts` in this same
    // package proves that with a real host tree and a real pty).
    vi.spyOn(process, 'stdout', 'get').mockReturnValue(fakeTtyStdout())
    const ctx = new Context()
    const hostConnection: HostConnectionLike = { inProcessHandler: () => fetchStub() }
    ctx.provide('connection', hostConnection)
    const fiber = ctx.plugin({ apply, inject }, { render: true })
    await expect(fiber.await()).rejects.toThrow('session.create')
    expect(ctx.get('tuiRuntime')).toBeUndefined()
  })
})
