/**
 * Shared generic Connection RPC caller envelope: request correlation
 * (`RpcId`), request-target validation, and response-envelope parsing — the
 * one call sequence both `createWebConnectionRpc` (`rpc.ts`) and
 * `createInProcessConnectionRpc` (`rpc-in-process.ts`) perform. The two
 * differ only in how they resolve the request's origin and perform the
 * actual HTTP-shaped request; both are parameterized here.
 */

import {
  RpcId,
  serverResponseSchema,
  type ClientRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ClientConnectionRpc } from '../rpc.ts'
import { randomUuid } from './random-uuid.ts'

const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/**
 * Reject a channel/endpoint pair that could escape the RPC target's fixed
 * namespace: an empty or `.`/`..` path segment, or a character outside the
 * channel/endpoint alphabets.
 * @param channel - RPC channel path (a single leading-slash segment).
 * @param endpoint - RPC method name within the channel.
 */
export function assertTarget(channel: string, endpoint: string): void {
  const segments = endpoint.split('/')
  if (!CHANNEL_PATTERN.test(channel)
    || segments.some(segment =>
      segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
    throw new Error(`connection: invalid RPC target ${JSON.stringify(`${channel}/${endpoint}`)}`)
  }
}

/**
 * Build a generic Connection RPC caller over an injected HTTP-shaped
 * transport: validate the target, correlate the request with a fresh
 * `RpcId`, perform the request through `doFetch`, then parse and correlate
 * the response envelope. Identical between the browser fetch carrier and the
 * in-process handler carrier — only the request's origin (`resolveBase`) and
 * how the request is actually carried (`doFetch`) differ between them.
 * @param resolveBase - resolves the request's origin for `new URL(path, base)`.
 * @param doFetch - performs the validated request; receives the same `signal` the
 * caller passed (if any) alongside `init`, so a transport whose own `init.signal`
 * handling is unproven can still be raced against abort directly.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createConnectionRpc(
  resolveBase: () => string,
  doFetch: (url: URL, init: RequestInit, signal: AbortSignal | undefined) => Promise<Response>,
): ClientConnectionRpc {
  return {
    async call(channel, endpoint, payload, signal) {
      assertTarget(channel, endpoint)
      const rpcId = RpcId(randomUuid())
      const message: ClientRequest = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      const response = await doFetch(
        new URL(`${channel}/${endpoint}`, resolveBase()),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
          ...signal === undefined ? {} : { signal },
        },
        signal,
      )
      if (!response.ok) {
        throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`)
      }
      const full = serverResponseSchema.parse(await response.json())
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
  }
}
