/**
 * HostConnectionService.inProcessHandler(): the same-process /api composition
 * (Typert interceptor first, then the ApiProxy fallback via toFetchHandler)
 * with no isTrustedApiRequest check anywhere in the chain — the security-
 * relevant difference from the network route this same class also serves.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { WebServer, WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject, type HostConnectionHandle } from '../src/index.ts'
// apiproxy's own carrier InProcessApiClient (NOT this package's src/client/
// re-export of it): tsconfig.host.json's exclude list forbids this Host
// aggregate file from importing packages/client/*/src at all — the same
// face-isolation rule a prior revision of the in-process integration test
// violated in the other direction. `@deepseek-ai/dsh-host-apiproxy/client` has
// no such restriction; it is a general apiproxy carrier, already a legitimate
// Host-aggregate import.
import { InProcessApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'

/** Structural webServer fake (mirrors node-half.host.spec.ts's own). */
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

/** Minimal but fully-typed ApiProxy: every domain answers, only the two
 *  methods these cases exercise are interesting (session.list, a privileged
 *  method, and the event streams). */
function stubApiProxy(): ApiProxy {
  async function *empty<F>(): AsyncGenerator<RpcRequest<F>> { /* no frames */ }
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
      describe: r => ok(r, { version: '0-test', cwd: '/t', attachedSessions: 0, canOpenPath: true }),
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
    events: { mux: () => empty(), host: () => empty() },
    respond: () => Promise.resolve({ accepted: false as const, reason: 'not-pending' as const }),
    downloads: { sessionLog: async () => new Response('stub', { status: 404 }) },
  }
}

async function mounted(apiProxy?: ApiProxy): Promise<{ connection: HostConnectionHandle; dispose: () => Promise<void> }> {
  const ctx = new Context()
  ctx.provide('webServer', fakeHttpServer([], []) as WebServer)
  if (apiProxy !== undefined) ctx.provide('apiProxy', apiProxy)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const connection = ctx.get('connection') as HostConnectionHandle
  return { connection, dispose: () => fiber.dispose() }
}

describe('HostConnectionService.inProcessHandler', () => {
  it('dispatches to the ApiProxy fallback with no Host header at all — the fence cannot even run here', async () => {
    const { connection, dispose } = await mounted(stubApiProxy())
    const handler = connection.inProcessHandler()
    const body = { type: 'client-request', rpcId: 'r1', method: 'session.list', payload: {} }
    // No headers object at all: a real browser/LAN request always carries at
    // least a Host header; isTrustedApiRequest would read it as undefined and
    // refuse — this in-process handler never asks.
    const response = await handler.fetch('http://dsh.internal/api/session.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { ok: true, value: { items: [] } } })
    await dispose()
  })

  it('reaches a PRIVILEGED_METHODS-pinned endpoint that the network route would 403 for the same headerless request', async () => {
    const { connection, dispose } = await mounted(stubApiProxy())
    const handler = connection.inProcessHandler()
    const body = { type: 'client-request', rpcId: 'r2', method: 'settings.describe', payload: {} }
    const response = await handler.fetch(new Request('http://dsh.internal/api/settings.describe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { ok: true, value: { writable: true } } })
    await dispose()
  })

  it('answers a stream GET as SSE directly (no WebSocket-upgrade diversion, unlike the network fallback)', async () => {
    const { connection, dispose } = await mounted(stubApiProxy())
    const handler = connection.inProcessHandler()
    const response = await handler.fetch('http://dsh.internal/api/events.mux')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    await response.body?.cancel()
    await dispose()
  })

  it('answers 404 while no ApiProxy is composed yet', async () => {
    const { connection, dispose } = await mounted()
    const handler = connection.inProcessHandler()
    const response = await handler.fetch('http://dsh.internal/api/session.list', { method: 'POST' })
    expect(response.status).toBe(404)
    await dispose()
  })

  it('lets a Typert-style interceptor claim an endpoint ahead of the ApiProxy fallback, unguarded by its declared authority', async () => {
    const { connection, dispose } = await mounted(stubApiProxy())
    const calls: { endpoint: string; payload: unknown }[] = []
    // authority: 'loopback' would 403 a headerless request on the network
    // route (see createSharedFetchHandler); the in-process composition skips
    // that check for the interceptor exactly as it does for the fallback.
    const remove = connection.rpc.intercept(
      '/api',
      endpoint => endpoint === 'goals/create',
      async (endpoint, payload) => {
        calls.push({ endpoint, payload })
        return { ok: true, value: { accepted: true } }
      },
      { authority: 'loopback' },
    )
    const handler = connection.inProcessHandler()
    const body = { type: 'client-request', rpcId: 'r3', method: 'goals/create', payload: { args: { agentId: 'a1' } } }
    const claimed = await handler.fetch('http://dsh.internal/api/goals/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(await claimed.json()).toMatchObject({ result: { ok: true, value: { accepted: true } } })
    expect(calls).toEqual([{ endpoint: 'goals/create', payload: { args: { agentId: 'a1' } } }])

    await remove()
    // Interceptor withdrawn: the same endpoint now falls through to the
    // ApiProxy fallback, which has no route for it (carrier 404).
    const afterRemoval = await handler.fetch('http://dsh.internal/api/goals/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(afterRemoval.status).toBe(404)
    await dispose()
  })
})

/**
 * Long-lived event stream: yields nothing and stays open until the caller's
 * signal aborts — mirrors in-process-connection.client.spec.ts's own helper.
 * A stream that ends on its own would confound "the generation-abort caused
 * the reconnect" with "the stub stream simply ended."
 */
async function *openUntilAborted<F>(signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }) })
}

/** stubApiProxy() with real long-lived event streams instead of empty ones. */
function longLivedApiProxy(): ApiProxy {
  return {
    ...stubApiProxy(),
    events: {
      mux: (_request, signal) => openUntilAborted<MuxFrame>(signal),
      host: (_request, signal) => openUntilAborted<HostFrame>(signal),
    },
  }
}

/**
 * Read one SSE-shaped Response's frames until the iterator completes or
 * throws, exactly like ConnectionController's own `pumpStream` (client-face,
 * package-internal, and unreachable from this Host-aggregate file — see the
 * InProcessApiClient import comment above). ConnectionController's reaction
 * to that completion (flip to 'reconnecting', then retry) is already covered
 * where it lives, by client-apply.client.spec.ts's fixture-driven reconnect
 * case; what is new here, and what this test exists to prove, is the Host
 * half of the same contract — that withdrawing the ApiProxy fiber really
 * does end an open in-process stream instead of leaving it hanging, and that
 * a fresh fiber really does serve a working stream again afterward.
 * @returns `'ended'` on normal completion, `'errored'` if the iterator threw.
 */
async function pumpUntilEnd(stream: AsyncIterable<unknown>): Promise<'ended' | 'errored'> {
  try {
    for await (const _frame of stream) { /* frames are not the subject of this test */ }
    return 'ended'
  } catch {
    return 'errored'
  }
}

describe('HostConnectionService.inProcessHandler generation lifecycle', () => {
  it('aborts an open in-process stream when its ApiProxy fiber withdraws, and serves a fresh one once a new ApiProxy is provided', async () => {
    const ctx = new Context()
    ctx.provide('webServer', fakeHttpServer([], []) as WebServer)
    const connectionFiber = ctx.plugin({ inject: [...inject], apply })
    await connectionFiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const client = new InProcessApiClient(connection.inProcessHandler())

    // Generation 1.
    let apiProxyFiber = ctx.plugin((pctx) => { pctx.provide('apiProxy', longLivedApiProxy()) })
    await apiProxyFiber.await()
    const abort1 = new AbortController()
    const pump1 = pumpUntilEnd(client.events.mux({}, abort1.signal))
    // Still open: racing a short timeout against pump1 proves it has not
    // already ended on its own (the stub's openUntilAborted never yields and
    // never returns unless its own signal aborts).
    const stillOpen = await Promise.race([
      pump1.then(() => 'ended' as const),
      new Promise<'still-open'>((resolve) => { setTimeout(() => { resolve('still-open') }, 30) }),
    ])
    expect(stillOpen).toBe('still-open')

    // Withdraw generation 1: its owned events.mux stream must end (not merely
    // stop being read) — the "in-process streams are generation-owned"
    // requirement this test exists to pin.
    await apiProxyFiber.dispose()
    await expect(pump1).resolves.toBe('ended')

    // Generation 2: a fresh ApiProxy fiber serves a working stream again,
    // through the same InProcessApiClient/inProcessHandler() pair, with no
    // recomposition on the client side.
    apiProxyFiber = ctx.plugin((pctx) => { pctx.provide('apiProxy', longLivedApiProxy()) })
    await apiProxyFiber.await()
    const abort2 = new AbortController()
    const pump2 = pumpUntilEnd(client.events.mux({}, abort2.signal))
    const stillOpen2 = await Promise.race([
      pump2.then(() => 'ended' as const),
      new Promise<'still-open'>((resolve) => { setTimeout(() => { resolve('still-open') }, 30) }),
    ])
    expect(stillOpen2).toBe('still-open')
    abort2.abort()
    await expect(pump2).resolves.toBe('ended')

    await apiProxyFiber.dispose()
    await connectionFiber.dispose()
  }, 30_000)

  it('dispatches through the ApiProxy fallback unscoped the instant it is composed, before its generation signal binds', async () => {
    // `ctx.get('apiProxy')` is a direct, synchronous service-store read, but
    // `apiProxyGenerationSignal` is only set once the constructor's
    // `ctx.inject(['apiProxy'], ...)` dependent fiber reloads — gated behind
    // at least one microtask by cordis (vendor/cordis/src/fiber.ts
    // `_reload()`'s `await Promise.resolve()`). Providing `apiProxy` and
    // dispatching in the same synchronous tick (no intervening await) lands
    // inside that gap: `scopedToApiProxyGeneration` sees no tracked signal
    // yet and must still dispatch — unscoped rather than throwing or hanging.
    const ctx = new Context()
    const connectionFiber = ctx.plugin({ inject: [...inject], apply })
    await connectionFiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle
    const handler = connection.inProcessHandler()

    ctx.provide('apiProxy', stubApiProxy())
    const response = await handler.fetch('http://dsh.internal/api/session.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'r-early', method: 'session.list', payload: {} }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { ok: true, value: { items: [] } } })

    await connectionFiber.dispose()
  })
})

describe('HostConnectionService.inProcessHandler generic channels', () => {
  it('routes a generic rpc.handle() channel through inProcessHandler alongside the network route, and stops routing once withdrawn', async () => {
    const { connection, dispose } = await mounted()
    const calls: { endpoint: string; payload: unknown }[] = []
    const remove = connection.rpc.handle('/tui-rpc', async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { ok: true, value: { accepted: true } }
    }, { authority: 'loopback' })
    const handler = connection.inProcessHandler()
    const body = { type: 'client-request', rpcId: 'r-channel', method: 'create', payload: { x: 1 } }
    // No headers at all, like every other inProcessHandler case: the point of
    // this registry is that a channel serving the web face is reachable
    // in-process without also re-deriving the network trust fence.
    const response = await handler.fetch('http://dsh.internal/tui-rpc/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { ok: true, value: { accepted: true } } })
    expect(calls).toEqual([{ endpoint: 'create', payload: { x: 1 } }])

    await remove()
    const afterRemoval = await handler.fetch('http://dsh.internal/tui-rpc/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(afterRemoval.status).toBe(404)
    await dispose()
  })

  it('404s a path that matches no registered channel while another channel is still registered', async () => {
    const { connection, dispose } = await mounted()
    // Keep one channel registered so the generic-channel scan below actually
    // walks a non-empty registry and evaluates its match condition against an
    // entry that does not match, instead of short-circuiting on an empty map.
    const remove = connection.rpc.handle('/tui-rpc', async () => ({ ok: true, value: {} }), { authority: 'loopback' })
    const handler = connection.inProcessHandler()

    const response = await handler.fetch('http://dsh.internal/other-channel/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'r-nomatch', method: 'create', payload: {} }),
    })
    expect(response.status).toBe(404)

    await remove()
    await dispose()
  })
})

describe('connection apply() with no webServer composed', () => {
  it('activates the connection registry and a working inProcessHandler without ever requiring webServer', async () => {
    const ctx = new Context()
    // No ctx.provide('webServer', ...) at all: a pure terminal composition.
    ctx.provide('apiProxy', stubApiProxy())
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionHandle | undefined
    expect(connection).toBeDefined()
    const handler = connection!.inProcessHandler()
    const body = { type: 'client-request', rpcId: 'r-no-webserver', method: 'session.list', payload: {} }
    const response = await handler.fetch('http://dsh.internal/api/session.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ result: { ok: true, value: { items: [] } } })
    await fiber.dispose()
  })
})
