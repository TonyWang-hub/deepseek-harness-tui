/**
 * Full in-process wire integration: a real (scripted) ApiProxy → toFetchHandler
 * → InProcessApiClient → ConnectionController.start(). Every prior in-process
 * test either stopped at the protocol layer
 * (packages/host/apiproxy/tests/client-handler.spec.ts) or drove
 * ConnectionController against a hand-built IApiClient fake
 * (connection.client.spec.ts) — the full connect/pump/readiness-handshake
 * loop had never run over this path (design note risk: "the full
 * ConnectionController start/reconnect loop has never run over the
 * in-process SSE path").
 *
 * `toFetchHandler` is imported from the package's `./handler` subpath, never
 * its root: the root (`src/index.ts`) carries this package's own
 * `declare module '@deepseek-ai/cordis'` merge (`ctx.apiProxy`), which would
 * poison this file's client-aggregate TypeScript program the moment it
 * merges in — the same failure mode a prior revision of this file hit by
 * importing the root. `./handler` (`src/fetch/handler.ts`) has no such merge
 * in its own import closure (verified against `src/api/*.ts`, whose only
 * ambient module augmentations are `@deepseek-ai/dsh-session-projection/types`
 * and `@deepseek-ai/dsh-llm`, never `@deepseek-ai/cordis`).
 *
 * `HostConnectionService.inProcessHandler()` selects between the Typert
 * interceptor and exactly this `toFetchHandler(apiProxy)` fallback (see
 * rpc-host-in-process.host.spec.ts for that selection, unit-tested on the
 * Host side where `HostConnectionService` lives); the fallback path driven
 * here is the one whose SSE/readiness timing this test exists to pin. This
 * file stays client-aggregate-only (no `../src/index.ts` host import) so one
 * `tsc -b` program can see both `InProcessApiClient`/`ConnectionController`
 * and the wire types — the host and client Cordis Context merges this
 * package's two halves carry are why they type-check as separate aggregates
 * (tsconfig.host.json / tsconfig.client.json) in the first place.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy/handler'
import { InProcessApiClient } from '../src/client/api.ts'
import { ConnectionController } from '../src/client/connection.ts'

function ok<T>(request: RpcRequest<unknown>, value: T): Promise<RpcResponse<T>> {
  return Promise.resolve({ rpcId: request.rpcId, result: { ok: true, value } })
}

/**
 * Long-lived event stream: yields nothing and stays open until the caller's
 * signal aborts — a real SSE connection's shape. A stream scripted to end
 * immediately would race ConnectionController's generation-failure path
 * against its own readiness handshake (both settle within the same tick),
 * which is exactly the kind of accidental flake this integration test must
 * not carry.
 */
async function *openUntilAborted<F>(signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }) })
}

/** Full-shaped ApiProxy stub: only host.describe and the two event streams
 *  are exercised by ConnectionController; every other domain answers a
 *  well-typed stub value so the object satisfies ApiProxy. */
function scriptedApi(describeCalls: RpcRequest<unknown>[]): ApiProxy {
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
      describe: (r) => {
        describeCalls.push(r)
        return ok(r, { version: 'in-process-wired', cwd: '/t', attachedSessions: 0, canOpenPath: true })
      },
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

describe('in-process connection integration', () => {
  it('completes host.describe + both streams\' onOpen and reaches connected, well under streamOpenTimeoutMs', async () => {
    const describeCalls: RpcRequest<unknown>[] = []
    const handler = toFetchHandler(scriptedApi(describeCalls))
    const client = new InProcessApiClient(handler)

    const connected: unknown[] = []
    const states: string[] = []
    // Default streamOpenTimeoutMs (connection.ts: 3000ms) is left
    // unconfigured on purpose. The waitFor below is bounded far under it, so
    // reaching 'connected' can only be explained by both streams' onOpen
    // actually firing — not by the timeout fallback racing past them.
    const controller = new ConnectionController(client, {
      onConnected: description => connected.push(description),
      onStateChange: state => states.push(state),
    })
    controller.start()
    try {
      await vi.waitFor(() => { expect(connected).toHaveLength(1) }, { timeout: 300, interval: 5 })
      expect(connected[0]).toMatchObject({ version: 'in-process-wired' })
      expect(describeCalls).toHaveLength(1)
      expect(states).toEqual(['connected'])
    } finally {
      controller.stop()
    }
  })
})
