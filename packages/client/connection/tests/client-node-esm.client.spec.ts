/**
 * Node-loadability proof for the ./client-node publication. This package
 * ships its browser wire client through both ./client (a browser bundle
 * wrapped in window.__ModuleLoader__.load) and ./client-node (plain Node
 * ESM, same compiled module, no wrapper) — a plain Node consumer (the
 * planned official TUI) loads the latter. Importing through the package
 * specifier, not a relative path, exercises the same module resolution real
 * Node ESM consumers use; running under vitest's default node environment
 * (no jsdom) proves the module evaluates with no window global.
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
