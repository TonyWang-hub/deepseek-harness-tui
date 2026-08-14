/**
 * Source-plane equivalence proof for the ./client-node publication, not a
 * built-artifact test: `@deepseek-ai/dsh-client-connection/client` resolves
 * through this repo's tsconfig.base.json `paths` straight to
 * `src/client/index.ts`, never through `lib/`, so this exercises the same
 * source `./client-node` will compile from the day it evaluates the same
 * module both subpaths share, not the published `./client-node` artifact
 * itself (a built-artifact smoke belongs to a later test package). This
 * package ships that shared browser wire client through both ./client (a
 * browser bundle wrapped in window.__ModuleLoader__.load) and ./client-node
 * (plain Node ESM, same compiled module, no wrapper) — a plain Node consumer
 * (the planned official TUI) loads the latter. Running under vitest's
 * default node environment (no jsdom) proves the shared source evaluates
 * with no window global.
 */
import { describe, expect, it } from 'vitest'
import { AbstractApiClient, apply, inject, RpcId } from '@deepseek-ai/dsh-client-connection/client'

describe('client wire layer Node ESM loadability', () => {
  it('evaluates under plain Node with no window global', () => {
    expect(typeof window).toBe('undefined')
    expect(typeof RpcId).toBe('function')
    expect(typeof AbstractApiClient).toBe('function')
    expect(typeof apply).toBe('function')
    expect(inject).toEqual([])
  })
})
