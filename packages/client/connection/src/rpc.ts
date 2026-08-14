/** Generic unary RPC contracts shared by the Host and Client Connection halves. */

import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'

/** Trust fence applied before a Host RPC channel reaches its handler. */
export type ConnectionRpcAuthority = 'trusted-host' | 'loopback'

/** Registration policy for one logical RPC channel. */
export interface ConnectionRpcHandlerOptions {
  /** Browser authority accepted by every endpoint in this channel. */
  readonly authority: ConnectionRpcAuthority
}

/** Handler invoked after Connection has decoded the transport envelope. */
export type ConnectionRpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>

/** Synchronous ownership test for one endpoint on a shared RPC channel. */
export type ConnectionRpcEndpointMatcher = (endpoint: string) => boolean

/** Host registry for logical RPC channels carried by the current transport. */
export interface HostConnectionRpc {
  /**
   * Register one absolute channel prefix and its trust policy.
   * @param channel - absolute logical channel such as `/rpc`.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - channel trust policy.
   * @returns asynchronous disposer removing the channel and its physical route.
   */
  handle(
    channel: string,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>

  /**
   * Intercept owned endpoints on the shared `/api` channel before its fallback.
   * @param channel - reserved shared channel; currently `/api`.
   * @param matches - synchronous endpoint ownership test.
   * @param handler - decoded endpoint handler returning the existing RPC result shape.
   * @param options - trust policy for every endpoint claimed by this interceptor.
   * @returns asynchronous disposer removing the interceptor.
   */
  intercept(
    channel: '/api',
    matches: ConnectionRpcEndpointMatcher,
    handler: ConnectionRpcHandler,
    options: ConnectionRpcHandlerOptions,
  ): () => Promise<void>
}

/** Host `ctx.connection` shape consumed by transport-independent adapters. */
export interface HostConnectionHandle {
  /** Generic RPC channel registry. */
  readonly rpc: HostConnectionRpc

  /**
   * Compose this process's `/api` surface as a fetch-shaped handler — the
   * Typert Remote interceptor first (same claim priority the network route
   * enforces), then the ApiProxy fallback (SSE served inline, exactly like a
   * network GET on `/api/events.mux|host`) — with NO `isTrustedApiRequest`
   * check anywhere in the chain. Every other channel registered through
   * `rpc.handle()` is reachable here too, through the same registry the
   * network route dispatches through: a channel serving the web face cannot
   * 404 in-process.
   *
   * That fence (see [api-request-trust](./api-request-trust.ts)) exists to
   * prove a request crossing a socket is loopback or a declared trusted
   * authority; it cannot even run here, since a same-process `Request` (the
   * isomorphic-point construction `new Request('http://dsh.internal/...')`)
   * carries no `Host` header and would read as untrusted by that fence's own
   * rule. A caller holding a live `HostConnectionHandle` reference is running
   * inside this same process — already strictly inside the trust domain the
   * fence exists to establish over a socket it never crosses — so re-deriving
   * Host/Origin trust here would be theater, not security.
   *
   * The ApiProxy fallback is generation-owned: a request dispatched through it
   * carries a signal combined from the caller's own and the currently
   * composed ApiProxy fiber's lifecycle, so a withdrawn or recomposed
   * ApiProxy (HMR, or a bare in-process recomposition) aborts every stream
   * already dispatched through this fallback — a long-lived `events.mux`/
   * `events.host` request included — instead of leaving the caller holding a
   * stale connected generation that never observes the loss.
   *
   * NEVER mount the returned handler on a network route (`webServer.register`,
   * an HTTP/WS bridge, or anything else reachable from a socket): every
   * privileged and loopback-pinned method (native dialogs, settings,
   * credentials, `llm.discoverModels`, …) is unguarded through it. Pair it
   * only with a same-process consumer such as `InProcessApiClient`.
   * @returns fetch-shaped handler; answers 404 while no ApiProxy is composed yet.
   */
  inProcessHandler(): { fetch: typeof fetch }
}

/** Client caller for logical RPC channels carried by the current transport. */
export interface ClientConnectionRpc {
  /**
   * Call one endpoint through an already registered logical channel.
   * @param channel - absolute logical channel such as `/api`.
   * @param endpoint - channel-relative endpoint such as `goals/create`.
   * @param payload - channel-owned request payload.
   * @param signal - optional caller cancellation.
   * @returns the existing RPC success/error result; correlation stays inside Connection.
   */
  call(
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<RpcResult<unknown>>
}
