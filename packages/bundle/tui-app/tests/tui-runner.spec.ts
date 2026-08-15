/** Process ownership: wait-then-exit on a real terminal, loud failure without one. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, internals } from '../src/index.ts'

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

describe('tui-runner', () => {
  it('waits for the mounted renderer to exit, then requests exit 0', async () => {
    const ctx = new Context()
    let resolveWait: () => void
    const waitUntilExit = new Promise<void>((resolve) => { resolveWait = resolve })
    ctx.provide('tuiRuntime', { renderer: { waitUntilExit: () => waitUntilExit } } as never)
    const exited = new Promise<number>((resolve) => { ctx.provide('appExit', resolve) })
    apply(ctx)
    // Not yet resolved: the renderer has not exited.
    let settled = false
    void exited.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    resolveWait!()
    expect(await exited).toBe(0)
    await ctx.fiber.dispose()
  })

  it('fails loud without a mounted renderer (no real TTY)', async () => {
    const ctx = new Context()
    let err = ''
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    ctx.provide('tuiRuntime', {} as never)
    const exited = new Promise<number>((resolve) => { ctx.provide('appExit', resolve) })
    apply(ctx)
    expect(await exited).toBe(1)
    expect(err).toContain('requires a real terminal')
    await ctx.fiber.dispose()
  })

  it('abandons a run when the tree is disposed during Loader settlement', async () => {
    const ctx = new Context()
    let exited = false
    internals.stderr = { write: () => true }
    ctx.provide('appExit', () => { exited = true })
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('loader', { await: () => settlement } as never)
    apply(ctx)
    await ctx.fiber.dispose()
    release!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toBe(false)
  })

  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx) }).toThrow('must provide ctx.appExit')
  })

  it('reports an unexpected failure reading the dual-context bootstrap', async () => {
    const ctx = new Context()
    let err = ''
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => { ctx.provide('appExit', resolve) })
    ctx.provide('loader', {
      await: () => Promise.reject(new Error('settlement exploded')),
    } as never)
    ctx.provide('tuiRuntime', { renderer: { waitUntilExit: () => Promise.resolve() } } as never)
    apply(ctx)
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: settlement exploded\n')
    await ctx.fiber.dispose()
  })
})
