/** Host registry and HTTP adapter for generic Connection RPC channels. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  clientRequestSchema,
  RpcId,
  type ClientRequest,
  type RpcError,
  type RpcErrorDetailsMap,
  type RpcId as RpcIdType,
  type ServerResponse as RpcServerResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'
// Full-package import (not the /api subpath): toFetchHandler is the ApiProxy
// fallback this same-process handler dispatches to. Host-only file — no
// browser-bundle concern the client half's api.ts comment warns about. A
// client-aggregate consumer of the same function (e.g. the in-process
// integration test) imports the merge-free `./handler` subpath instead,
// which carries no `declare module '@deepseek-ai/cordis'` merge in its
// import closure — the package root, imported below, deliberately does.
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { bridge, type FetchHandler } from './http-bridge.ts'
import { isTrustedApiRequest } from './api-request-trust.ts'
import { API_PATH } from './api-path.ts'
import type {
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'

const INVALID_REQUEST_RPC_ID = RpcId('invalid-request')
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

interface ConnectionRpcInterceptor {
  readonly matches: ConnectionRpcEndpointMatcher
  readonly fetchHandler: FetchHandler
  readonly options: ConnectionRpcHandlerOptions
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Connection transport and RPC registrations. */
    connection: HostConnectionHandle
  }
}

/** Host Connection service whose channel registrations belong to the caller fiber. */
export class HostConnectionService extends Service implements HostConnectionHandle {
  private readonly interceptors = new Map<string, ConnectionRpcInterceptor>()
  // Generic rpc.handle() channels, keyed by channel prefix: the same registry
  // the network route (register(), below) dispatches through, so a channel
  // reachable from the browser cannot 404 in-process.
  private readonly channels = new Map<string, FetchHandler>()
  // Abort signal for the apiProxy fiber currently composed, or undefined
  // while none is. Rebound on every (re)composition and aborted when that
  // exact fiber unloads (see the ctx.inject() below) — this is what makes
  // in-process streams generation-owned: a withdrawn or recomposed ApiProxy
  // aborts every stream dispatched to its fallback through
  // inProcessHandler(), instead of leaving the client holding a stale
  // connected generation.
  private apiProxyGenerationSignal: AbortSignal | undefined
  // Set once this row unloads. A client tree holds its inProcessHandler()
  // reference for its whole life and has no way to observe the Host row going
  // away, so the handler itself has to stop serving: after unload the channel
  // and interceptor registries are empty, and every endpoint an interceptor
  // used to claim would silently fall through to whatever ApiProxy the global
  // service store still holds — the fence-exempt privileged surface included.
  private unloaded = false

  /**
   * Provide the Host half over the active HTTP server.
   * @param ctx - owning Connection plugin context.
   * @param trustedHosts - deployment authorities accepted by trusted-host channels.
   */
  constructor(ctx: Context, private readonly trustedHosts: readonly string[]) {
    super(ctx, 'connection')
    ctx.effect(() => () => { this.unloaded = true }, 'client-connection: in-process handler lifecycle')
    ctx.inject(['apiProxy'], (apiCtx) => {
      const controller = new AbortController()
      this.apiProxyGenerationSignal = controller.signal
      apiCtx.effect(() => () => {
        controller.abort()
        // Defensive: this one `ctx.inject(['apiProxy'], ...)` fiber (vendor
        // cordis's Fiber._unload()/._reload(), keyed by the providing fiber's
        // epoch) unloads a withdrawn generation and reloads a replacement
        // strictly sequentially — the replacement's callback above cannot run
        // until this teardown finishes — so `apiProxyGenerationSignal` is
        // always still this generation's own signal here.
        /* v8 ignore next -- unreachable under cordis's sequential unload-then-reload of one shared dependent fiber; see comment above. */
        if (this.apiProxyGenerationSignal === controller.signal) this.apiProxyGenerationSignal = undefined
      }, 'client-connection: in-process apiProxy generation lifecycle')
    })
  }

  /** Generic channel registry scoped to the Context reading this service. */
  get rpc(): HostConnectionRpc {
    const owner = this.ctx
    return {
      handle: (channel, handler, options) => this.register(owner, channel, handler, options),
      intercept: (channel, matches, handler, options) =>
        this.registerInterceptor(owner, channel, matches, handler, options),
    }
  }

  /**
   * Compose one shared-channel Fetch handler from its interceptor and fallback.
   * @param channel - shared channel mounted by Connection.
   * @param fallback - handler for endpoints not claimed by the interceptor.
   * @returns Fetch handler that selects exactly one target for each request.
   */
  createSharedFetchHandler(
    channel: '/api',
    fallback: FetchHandler,
  ): FetchHandler {
    return {
      fetch: (request) => {
        const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
        const interceptor = this.interceptors.get(channel)
        if (endpoint === undefined || interceptor === undefined || !interceptor.matches(endpoint)) {
          return fallback.fetch(request)
        }
        if (interceptor.options.authority === 'loopback' && !isTrustedApiRequest(request, [])) {
          return Promise.resolve(new Response('forbidden', { status: 403 }))
        }
        return interceptor.fetchHandler.fetch(request)
      },
    }
  }

  // Trust statement documented once, on the interface (HostConnectionHandle):
  // this composition deliberately carries no isTrustedApiRequest check.
  inProcessHandler(): { fetch: typeof fetch } {
    return {
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (this.unloaded) return new Response('not found', { status: 404 })
        const request = input instanceof Request ? input : new Request(input, init)
        const pathname = new URL(request.url).pathname
        const endpoint = endpointFromPath(API_PATH, pathname)
        const interceptor = this.interceptors.get(API_PATH)
        if (endpoint !== undefined && interceptor !== undefined && interceptor.matches(endpoint)) {
          return interceptor.fetchHandler.fetch(request)
        }
        if (endpoint !== undefined) {
          const apiProxy = this.ctx.get('apiProxy')
          if (apiProxy === undefined) return new Response('not found', { status: 404 })
          return toFetchHandler(apiProxy).fetch(this.scopedToApiProxyGeneration(request))
        }
        // Generic rpc.handle() channels: the same registry the network route
        // (register(), below) dispatches through, minus isTrustedApiRequest —
        // the in-process fence exception documented on inProcessHandler above
        // applies uniformly to every channel reachable through this handler,
        // not only /api, so a channel serving the web face cannot 404 here.
        for (const [channel, fetchHandler] of this.channels) {
          if (pathname === channel || pathname.startsWith(`${channel}/`)) {
            return fetchHandler.fetch(request)
          }
        }
        return new Response('not found', { status: 404 })
      },
    }
  }

  /**
   * Compose the caller's abort signal with the currently composed apiProxy
   * generation's lifecycle, so a request dispatched to the ApiProxy fallback
   * aborts the moment that generation unloads — even a long-lived SSE stream
   * request that would otherwise never observe the withdrawal.
   *
   * `inProcessHandler().fetch` reads `apiProxy` itself through `ctx.get`, a
   * direct and immediate service-store read, but `apiProxyGenerationSignal`
   * is only set once the constructor's `ctx.inject(['apiProxy'], ...)`
   * dependent fiber reloads — deferred behind at least one microtask by
   * cordis (`vendor/cordis/src/fiber.ts` `_reload()`'s own
   * `await Promise.resolve()`). A request whose dispatch lands inside that
   * gap — the same synchronous tick as the `ctx.provide('apiProxy', ...)`
   * call that composed the generation, with no await between them — sees
   * `apiProxy` defined but no signal yet, and this method returns `request`
   * unscoped rather than rejecting or waiting: a real caller can never
   * observe this gap, because reaching `inProcessHandler()` at all — even
   * in-process — already crosses this same async boundary at least once, so
   * the caller's own dispatch cannot land in the composing fiber's
   * synchronous tick. Reachable only from a test that calls
   * `ctx.provide('apiProxy', ...)` and dispatches in the same tick (see
   * `rpc-host-in-process.host.spec.ts`'s "dispatches through the ApiProxy
   * fallback unscoped" case, which pins this exact window).
   * @param request - request about to be dispatched to `toFetchHandler(apiProxy)`.
   * @returns `request` unchanged while no apiProxy generation is tracked yet; otherwise a clone carrying the combined signal.
   */
  private scopedToApiProxyGeneration(request: Request): Request {
    const generationSignal = this.apiProxyGenerationSignal
    if (generationSignal === undefined) return request
    return new Request(request, { signal: AbortSignal.any([request.signal, generationSignal]) })
  }

  private register(
    owner: Context,
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void> {
    assertChannel(channel)
    const trustedHosts = options.authority === 'loopback' ? [] : this.trustedHosts
    const fetchHandler = rpcFetchHandler(channel, handler)
    const route: WebRoute = {
      kind: 'prefix',
      path: channel,
      handler: async (req, res) => {
        if (!isTrustedApiRequest(req, trustedHosts)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        await bridge(req, res, fetchHandler)
      },
    }
    return owner.effect(() => {
      // Same duplicate rule registerInterceptor keeps: without it the second
      // registration silently replaces the first in `channels`, and the FIRST
      // disposer then deletes the SECOND's live handler, 404-ing a channel
      // whose owner is still mounted.
      if (this.channels.has(channel)) {
        throw new Error(`connection: RPC channel ${JSON.stringify(channel)} is already registered`)
      }
      // The HTTP carrier is optional, exactly as in apply(): a terminal
      // composition mounts no webServer, and this registry must still accept
      // channels there. Read through ctx.get, never the `owner.webServer`
      // property proxy, which is undefined in that composition.
      const webServer = owner.get('webServer')
      const disposeRoute = webServer?.register(route)
      // Registered into the same in-process registry inProcessHandler() reads,
      // so a channel reachable over the network route above is also reachable
      // in-process (requirement: a channel serving the web face cannot 404 in
      // the terminal carrier).
      this.channels.set(channel, fetchHandler)
      return () => {
        this.channels.delete(channel)
        return disposeRoute?.()
      }
    }, `client-connection: ${channel} rpc channel`)
  }

  private registerInterceptor(
    owner: Context,
    channel: string,
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void> {
    if (channel !== API_PATH) {
      throw new Error(`connection: invalid shared RPC channel ${JSON.stringify(channel)}`)
    }
    const interceptor: ConnectionRpcInterceptor = {
      matches,
      fetchHandler: rpcFetchHandler(channel, handler),
      options,
    }
    return owner.effect(() => {
      if (this.interceptors.has(channel)) {
        throw new Error(`connection: shared RPC channel ${JSON.stringify(channel)} already has an interceptor`)
      }
      this.interceptors.set(channel, interceptor)
      return () => {
        this.interceptors.delete(channel)
      }
    }, `client-connection: ${channel} rpc interceptor`)
  }
}

function rpcFetchHandler(
  channel: string,
  handler: ConnectionRpcHandler,
): FetchHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      const endpoint = endpointFromPath(channel, new URL(request.url).pathname)
      if (request.method !== 'POST' || endpoint === undefined) {
        return new Response('not found', { status: 404 })
      }

      const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }

      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) {
        return invalidEnvelopeResponse(body, envelope.error.issues)
      }
      const message: ClientRequest = envelope.data
      if (message.method !== endpoint) {
        return errorResponse(message.rpcId, {
          code: 'bad-request',
          message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
          details: { issues: [] },
        })
      }

      try {
        const result = await handler(endpoint, message.payload, request.signal)
        return fullResponse(message.rpcId, result)
      } catch (error) {
        return new Response(`handler failure: ${String(error)}`, { status: 500 })
      }
    },
  }
}

function invalidEnvelopeResponse(body: unknown, issues: RpcErrorDetailsMap['bad-request']['issues']): Response {
  const rawId = (body as { rpcId?: unknown } | null)?.rpcId
  const rpcId = typeof rawId === 'string' ? RpcId(rawId) : INVALID_REQUEST_RPC_ID
  return errorResponse(rpcId, {
    code: 'bad-request',
    message: 'invalid client-request message',
    details: { issues },
  })
}

function endpointFromPath(channel: string, pathname: string): string | undefined {
  if (!pathname.startsWith(`${channel}/`)) return undefined
  const endpoint = pathname.slice(channel.length + 1)
  const segments = endpoint.split('/')
  if (segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    return undefined
  }
  return endpoint
}

function errorResponse(rpcId: RpcIdType, error: RpcError): Response {
  return fullResponse(rpcId, { ok: false, error })
}

function fullResponse(rpcId: RpcIdType, result: RpcServerResponse['result']): Response {
  const body: RpcServerResponse = { type: 'server-response', rpcId, result }
  return Response.json(body)
}

function assertChannel(channel: string): void {
  if (!CHANNEL_PATTERN.test(channel) || channel === '/api') {
    throw new Error(`connection: invalid or reserved RPC channel ${JSON.stringify(channel)}`)
  }
}
