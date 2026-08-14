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
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { apply, inject, name } from '../src/index.ts'
import type { HostConnectionLike } from '../src/types.ts'

/** A `{ fetch }` stub that answers every request 404 — apply() never awaits the connect loop's own success. */
function fetchStub(): { fetch: typeof fetch } {
  return { fetch: () => Promise.resolve(new Response('not found', { status: 404 })) }
}

describe('tui-runtime apply()', () => {
  it('exposes the stable plugin identity', () => {
    expect(name).toBe('tui-runtime')
    expect(inject).toEqual(['connection'])
  })

  it('boots the Client tree over the injected HostConnectionLike and provides ctx.tuiRuntime', async () => {
    const ctx = new Context()
    const hostConnection: HostConnectionLike = { inProcessHandler: () => fetchStub() }
    ctx.provide('connection', hostConnection)
    const fiber = ctx.plugin({ apply, inject })
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
    const fiber = ctx.plugin({ apply, inject })
    await fiber.await()
    const handle = ctx.get('tuiRuntime')
    if (handle === undefined) throw new Error('ctx.tuiRuntime was not provided')
    const clientCtx = handle.clientCtx
    await fiber.dispose()
    expect(clientCtx.get('connection')).toBeUndefined()
  })
})
