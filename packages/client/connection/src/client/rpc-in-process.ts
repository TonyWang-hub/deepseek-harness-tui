/** In-process caller for generic Connection unary RPC channels. */

import type { ClientConnectionRpc } from '../rpc.ts'
import { createConnectionRpc } from './rpc-shared.ts'

/** URL base for in-process handler injection (fake authority, isomorphic with the fetch carrier's own INTERNAL_BASE). */
const INTERNAL_BASE = 'http://dsh.internal'

/**
 * Create the in-process generic RPC caller: the same wire behavior as the
 * browser caller (`createWebConnectionRpc`) — request correlation, target
 * validation, response-envelope parse — but the transport is an injected
 * fetch-shaped handler instead of `globalThis.fetch`, so it never touches the
 * network or a socket. Pair with a host `HostConnectionHandle.inProcessHandler()`
 * on the other end of the same process: both halves deliberately skip the
 * browser trust fence, safe only because caller and handler share this
 * process's trust domain.
 * @param handler - injected fetch-shaped transport (e.g. the host's `inProcessHandler()`).
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createInProcessConnectionRpc(handler: { fetch: typeof fetch }): ClientConnectionRpc {
  return createConnectionRpc(() => INTERNAL_BASE, (url, init, signal) => dispatch(handler, url, init, signal))
}

/**
 * Faithful to real fetch and to the same contract `InProcessApiClient.doFetch`
 * keeps (duplicated here because that method is private to its own module):
 * reject immediately on an already-aborted signal, and race an abort event
 * against a handler that ignores its `init.signal` argument — an injected
 * transport must not be able to leave a call pending forever just because it
 * never checks the signal it was handed.
 * @param handler - injected fetch-shaped transport.
 * @param input - request URL.
 * @param init - request init, already carrying `signal` when the caller passed one.
 * @param signal - the same caller signal from `init`, read again here to drive the abort race.
 * @returns the handler's response, or an abort rejection if `signal` fires first.
 */
function dispatch(
  handler: { fetch: typeof fetch },
  input: URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<Response> {
  if (signal === undefined) return handler.fetch(input, init)
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    handler.fetch(input, init)
      .then(resolve, reject)
      .finally(() => { signal.removeEventListener('abort', onAbort) })
  })
}

/** Mirror fetch's abort rejection: the signal's reason when present, else a DOMException-style AbortError. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error) return reason
  if (typeof reason === 'string') return new Error(reason)
  return new Error('This operation was aborted')
}
