/** Browser caller for generic Connection unary RPC channels. */

import type { ClientConnectionRpc } from '../rpc.ts'
import { createConnectionRpc } from './rpc-shared.ts'

const INTERNAL_BASE = 'http://dsh.internal'

/**
 * Create the browser-backed generic RPC caller.
 * @returns caller that owns request correlation and response-envelope validation.
 */
export function createWebConnectionRpc(): ClientConnectionRpc {
  return createConnectionRpc(resolveBase, (url, init) => globalThis.fetch(url, init))
}

function resolveBase(): string {
  const location = (globalThis as { location?: { origin?: string } }).location
  return location?.origin !== undefined && location.origin !== 'null' ? location.origin : INTERNAL_BASE
}
