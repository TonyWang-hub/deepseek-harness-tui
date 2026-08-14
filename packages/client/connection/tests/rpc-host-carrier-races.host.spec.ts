/**
 * Adversarial lifecycle coverage for the in-process carrier's Host half:
 * registry behavior in a composition with NO webServer (the terminal
 * composition this split exists to enable), duplicate-channel registration,
 * dispatch racing registration withdrawal, use-after-dispose of a handler
 * reference, and a withdraw/recompose storm over the generation-owned ApiProxy
 * fallback.
 *
 * Companion to `rpc-host-in-process.host.spec.ts`, which covers the happy
 * paths of the same surface; this file covers only what happens when the
 * lifecycle is adversarial. Host-aggregate file, so it imports `../src/index.ts`
 * and Host-half package subpaths only, never any Client package's `src`
 * directory — tsconfig.host.json's exclude list forbids that import.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { WebServer, WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject, type HostConnectionHandle } from '../src/index.ts'

/** Structural webServer fake (mirrors rpc-host-in-process.host.spec.ts's own). */
function fakeHttpServer(
  routes: WebRoute[],
  upgrades: WebUpgradeRoute[],
): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port'> {
  return {
    register(route) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(route) {
      upgrades.push(route)
      return () => { upgrades.splice(upgrades.indexOf(route), 1) }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}

function ok<T>(request: RpcRequest<unknown>, value: T): Promise<RpcResponse<T>> {
  return Promise.resolve({ rpcId: request.rpcId, result: { ok: true, value } })
}

/**
 * Long-lived event stream: yields nothing and stays open until the caller's
 * signal aborts. A stream that ends on its own would confound "the
 * generation-abort ended it" with "the stub simply finished".
 */
async function *openUntilAborted<F>(signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }) })
}

/** Fully-typed ApiProxy whose event streams stay open until aborted; `tag` identifies the generation. */
function longLivedApiProxy(tag: string): ApiProxy {
  const err = <T>(r: RpcRequest<unknown>): Promise<RpcResponse<T>> =>
    Promise.resolve({ rpcId: r.rpcId, result: { ok: false, error: { code: 'internal' as const, message: 'stub', details: {} } } })
  return {
    sessions: {
      list: r => ok(r, { items: [] }),
      search: r => ok(r, { items: [], hasMore: false }),
      create: r => ok(r, { sessionId: 's-new' as never }),
      history: r => ok(r, { events: [], hasMore: false, modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }),
      models: r => ok(r, { current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' }, routable: true, groups: [], failures: [] }),
      selectModel: r => ok(r, { selected: { provider: r.payload.provider, model: r.payload.model } }),
      rename: r => ok(r, { title: 'renamed', seq: 0 }),
      fork: r => ok(r, { sessionId: 's-fork' as never }),
      prompt: r => ok(r, { accepted: true as const }),
      attachment: r => ok(r, { attachment: { attachmentId: 'a' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, data: 'AA==' }),
      updateQueue: r => ok(r, { accepted: true as const }),
      cancel: r => ok(r, { accepted: true as const }),
    },
    subagents: {
      list: r => ok(r, { entries: [], parentAvailable: false }),
      history: r => ok(r, { events: [], hasMore: false }),
      prompt: r => ok(r, { messageId: 'message-1' as never }),
      interrupt: r => ok(r, { accepted: true as const }),
    },
    host: {
      describe: r => ok(r, { version: tag, cwd: '/t', attachedSessions: 0, canOpenPath: true }),
      pickDirectory: r => ok(r, { path: null }),
      listDirectory: r => ok(r, { path: '/t', home: '/t', crumbs: [], entries: [], truncated: false }),
      createDirectory: r => ok(r, { path: '/t/new' }),
      openPath: r => ok(r, { opened: true as const }),
    },
    workspace: {
      list: r => ok(r, { items: [], archivedSessionIds: [] }),
      create: r => ok(r, { workspace: { workspaceId: 'w1' as never, path: '/t', title: 't', sessionIds: [], createdAt: '0', updatedAt: '0' }, created: true }),
      rename: r => ok(r, { workspace: { workspaceId: 'w1' as never, path: '/t', title: 't', sessionIds: [], createdAt: '0', updatedAt: '0' } }),
      delete: r => ok(r, { deleted: true as const }),
      insertBefore: r => ok(r, { workspaceIds: [r.payload.workspaceId] }),
      insertSessionBefore: r => ok(r, { workspace: { workspaceId: 'w1' as never, path: '/t', title: 't', sessionIds: [], createdAt: '0', updatedAt: '0' } }),
      archiveSession: r => ok(r, { archivedSessionIds: [r.payload.sessionId] }),
    },
    skills: { list: r => ok(r, { skills: [] }) },
    agentPresets: {
      list: r => ok(r, { presets: [], authorable: false, hasDocument: false }),
      select: r => ok(r, { agentPreset: r.payload.agentPreset }),
      read: r => ok(r, { agentPreset: r.payload.agentPreset, trust: 'user' as const, content: '' }),
      copy: r => ok(r, { agentPreset: r.payload.agentPreset }),
      openDocument: r => ok(r, { opened: true as const }),
      remove: r => ok(r, {}),
    },
    goals: { create: err, edit: err, pause: err, resume: err, complete: err, clear: err },
    settings: {
      describe: r => ok(r, { writable: true, hasDocument: false, namespaces: [] }),
      openDocument: r => ok(r, { opened: true as const }),
      update: err,
      replace: err,
      mutate: err,
    },
    credentials: { describe: r => ok(r, { credentials: {} }), set: err, unset: err },
    llm: { providers: r => ok(r, { providers: [] }), models: r => ok(r, { groups: [], failures: [] }), discoverModels: err },
    events: {
      mux: (_request, signal) => openUntilAborted<MuxFrame>(signal),
      host: (_request, signal) => openUntilAborted<HostFrame>(signal),
    },
    respond: () => Promise.resolve({ accepted: false as const, reason: 'not-pending' as const }),
    downloads: { sessionLog: async () => new Response('stub', { status: 404 }) },
  }
}

/** One envelope POST through a fetch-shaped handler; returns the status and parsed body. */
async function post(
  handler: { fetch: typeof fetch },
  url: string,
  method: string,
  payload: unknown = {},
): Promise<{ status: number; body: unknown }> {
  const response = await handler.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'r-race', method, payload }),
  })
  return { status: response.status, body: response.status === 200 ? await response.json() : undefined }
}

/** Read an SSE-shaped Response to completion; `'ended'` on normal end, `'errored'` if the body threw. */
async function pumpUntilEnd(body: ReadableStream<Uint8Array>): Promise<'ended' | 'errored'> {
  const reader = body.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) return 'ended'
    }
  } catch {
    return 'errored'
  }
}

/** Resolves `'still-open'` if `settled` has not settled within `ms`. */
function stillOpenAfter<T>(settled: Promise<T>, ms: number): Promise<T | 'still-open'> {
  return Promise.race([
    settled,
    new Promise<'still-open'>((resolve) => { setTimeout(() => { resolve('still-open') }, ms) }),
  ])
}

describe('connection registry without a webServer carrier', () => {
  it('accepts a generic rpc.handle() channel and routes it in-process', async () => {
    // The whole point of the transport-neutral split: a terminal composition
    // mounts no webServer, and every plugin contributing an RPC channel must
    // still load there. Reading the optional carrier through the `webServer`
    // property proxy instead of ctx.get made this throw
    // `TypeError: Cannot read properties of undefined (reading 'register')`,
    // which would have taken down the whole terminal profile at load.
    const ctx = new Context()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle

    const calls: { endpoint: string; payload: unknown }[] = []
    const remove = connection.rpc.handle('/tui-rpc', async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { ok: true, value: { accepted: true } }
    }, { authority: 'loopback' })

    const answered = await post(connection.inProcessHandler(), 'http://dsh.internal/tui-rpc/create', 'create', { x: 1 })
    expect(answered.status).toBe(200)
    expect(answered.body).toMatchObject({ result: { ok: true, value: { accepted: true } } })
    expect(calls).toEqual([{ endpoint: 'create', payload: { x: 1 } }])

    await remove()
    expect((await post(connection.inProcessHandler(), 'http://dsh.internal/tui-rpc/create', 'create')).status).toBe(404)
    await fiber.dispose()
  })
})

describe('connection channel registry under concurrent registration', () => {
  it('refuses a second registration of one channel instead of silently replacing it', async () => {
    // Without this the second registration overwrites the first in the
    // in-process map, and the FIRST disposer then deletes the SECOND's live
    // handler — 404-ing a channel whose owner is still mounted, while its
    // network route keeps answering. `intercept()` has always had this rule;
    // `handle()` did not.
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer([], []) as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle

    const removeFirst = connection.rpc.handle('/dup', async () => ({ ok: true, value: { who: 'first' } }), { authority: 'loopback' })
    expect(() => connection.rpc.handle('/dup', async () => ({ ok: true, value: { who: 'second' } }), { authority: 'loopback' }))
      .toThrow(/already registered/)

    // The incumbent is untouched by the refused registration.
    const answered = await post(connection.inProcessHandler(), 'http://dsh.internal/dup/ping', 'ping')
    expect(answered.body).toMatchObject({ result: { ok: true, value: { who: 'first' } } })

    // And once it withdraws, the channel is free again.
    await removeFirst()
    const removeNext = connection.rpc.handle('/dup', async () => ({ ok: true, value: { who: 'next' } }), { authority: 'loopback' })
    expect((await post(connection.inProcessHandler(), 'http://dsh.internal/dup/ping', 'ping')).body)
      .toMatchObject({ result: { ok: true, value: { who: 'next' } } })
    await removeNext()
    await fiber.dispose()
  })

  it('lets a dispatch already inside a handler finish after its channel withdraws', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer([], []) as WebServer)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const handler = connection.inProcessHandler()

    let release = (): void => {}
    let enteredHandler = (): void => {}
    const entered = new Promise<void>((resolve) => { enteredHandler = resolve })
    const remove = connection.rpc.handle('/slow', async () => {
      enteredHandler()
      await new Promise<void>((done) => { release = done })
      return { ok: true, value: { finished: true } }
    }, { authority: 'loopback' })

    const inFlight = post(handler, 'http://dsh.internal/slow/run', 'run')
    await entered
    // Withdraw while the handler is still inside its body, mid-dispatch.
    await remove()
    release()
    // The in-flight dispatch resolved its target before the withdrawal, so it
    // completes normally rather than 404-ing halfway through.
    expect((await inFlight).body).toMatchObject({ result: { ok: true, value: { finished: true } } })
    // The next one sees the withdrawal.
    expect((await post(handler, 'http://dsh.internal/slow/run', 'run')).status).toBe(404)
    await fiber.dispose()
  })

  it('lets a dispatch already claimed by an /api interceptor finish after the interceptor withdraws', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer([], []) as WebServer)
    ctx.provide('apiProxy', longLivedApiProxy('gen-interceptor'))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const handler = connection.inProcessHandler()

    let release = (): void => {}
    let remove: (() => Promise<void>) | undefined
    const entered = new Promise<void>((resolve) => {
      remove = connection.rpc.intercept('/api', endpoint => endpoint === 'goals/create', async () => {
        resolve()
        await new Promise<void>((done) => { release = done })
        return { ok: true, value: { accepted: true } }
      }, { authority: 'loopback' })
    })

    const inFlight = post(handler, 'http://dsh.internal/api/goals/create', 'goals/create')
    await entered
    await remove?.()
    release()
    expect((await inFlight).body).toMatchObject({ result: { ok: true, value: { accepted: true } } })
    await fiber.dispose()
  })
})

describe('inProcessHandler use after the connection row unloads', () => {
  it('answers 404 rather than throwing when a retained handler reference is called after dispose', async () => {
    // A client tree holds this handler for its whole life. If the Host row
    // unloads first (HMR, profile switch), the retained reference must degrade
    // to the same "no ApiProxy composed" answer the client already handles as a
    // transport failure — never a synchronous throw out of `fetch`, which no
    // caller on the client side is written to catch.
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer([], []) as WebServer)
    ctx.provide('apiProxy', longLivedApiProxy('gen-doomed'))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const handler = (ctx.get('connection') as HostConnectionHandle).inProcessHandler()
    expect((await post(handler, 'http://dsh.internal/api/session.list', 'session.list')).status).toBe(200)

    await fiber.dispose()

    expect((await post(handler, 'http://dsh.internal/api/session.list', 'session.list')).status).toBe(404)
    const stream = await handler.fetch('http://dsh.internal/api/events.mux')
    expect(stream.status).toBe(404)
    expect((await post(handler, 'http://dsh.internal/tui-rpc/create', 'create')).status).toBe(404)
  })
})

describe('inProcessHandler under a withdraw/recompose storm', () => {
  it('ends every generation\'s stream on its own withdrawal and never kills the next generation\'s', async () => {
    const ctx = new Context()
    const connectionFiber = ctx.plugin({ inject: [...inject], apply })
    await connectionFiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const handler = connection.inProcessHandler()

    const CYCLES = 12
    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      const generation = ctx.plugin((generationCtx: Context) => {
        generationCtx.provide('apiProxy', longLivedApiProxy(`gen-${String(cycle)}`))
      })
      await generation.await()

      const response = await handler.fetch('http://dsh.internal/api/events.mux')
      expect(response.status).toBe(200)
      if (response.body === null) throw new Error(`generation ${String(cycle)} served no body`)
      const pump = pumpUntilEnd(response.body)

      // The previous generation's abort must not have reached this stream.
      expect(await stillOpenAfter(pump, 20)).toBe('still-open')

      await generation.dispose()
      // Its own withdrawal must.
      expect(await stillOpenAfter(pump, 500)).toBe('ended')

      // No generation is composed between cycles: the carrier converges on the
      // documented "no ApiProxy composed yet" answer rather than on a stale one.
      expect((await handler.fetch('http://dsh.internal/api/events.mux')).status).toBe(404)
    }

    // A final generation still works after all that churn — the registry did
    // not accumulate a dead generation signal that poisons new requests.
    const settled = ctx.plugin((generationCtx: Context) => {
      generationCtx.provide('apiProxy', longLivedApiProxy('gen-final'))
    })
    await settled.await()
    const answered = await post(handler, 'http://dsh.internal/api/host.describe', 'host.describe')
    expect(answered.body).toMatchObject({ result: { ok: true, value: { version: 'gen-final' } } })
    await settled.dispose()
    await connectionFiber.dispose()
  }, 30_000)

  it('keeps a unary call dispatched during a generation withdrawal from hanging', async () => {
    const ctx = new Context()
    const connectionFiber = ctx.plugin({ inject: [...inject], apply })
    await connectionFiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const handler = connection.inProcessHandler()

    const generation = ctx.plugin((generationCtx: Context) => {
      generationCtx.provide('apiProxy', longLivedApiProxy('gen-unary'))
    })
    await generation.await()

    // Dispatch and withdraw in the same tick: whichever side wins, the caller
    // must observe a settled answer (200 from the still-composed generation, or
    // 404 once it is gone) and never a promise that stays pending.
    const inFlight = post(handler, 'http://dsh.internal/api/session.list', 'session.list')
    const withdrawn = generation.dispose()
    const settled = await stillOpenAfter(inFlight, 1_000)
    expect(settled).not.toBe('still-open')
    expect([200, 404]).toContain((settled as { status: number }).status)
    await withdrawn
    await connectionFiber.dispose()
  })
})
