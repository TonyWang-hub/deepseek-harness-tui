/**
 * Adversarial teardown coverage for the dual-context bootstrap: the Client
 * tree's lifecycle is an effect of the Host row's fiber, so every way that
 * fiber can go away must leave the Client tree quiescent — no further
 * in-process traffic, no second disposal hazard, nothing accumulating across
 * repeated mounts.
 *
 * Quiescence is measured at the one seam the Client tree cannot reach around:
 * the injected `inProcessHandler()` transport. Every unary call, every stream
 * open, and every reconnect attempt the Client tree makes passes through it, so
 * a call counter on that handler is an exact liveness probe for the whole tree
 * — stronger than `process._getActiveHandles`, which does not list timers on
 * current Node builds and cannot attribute a handle to this tree anyway.
 *
 * Companion to `apply.client.spec.ts` (happy-path mount/unmount); this file
 * covers only the adversarial orderings.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context, Fiber } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/index.ts'
import type { HostConnectionLike } from '../src/types.ts'

/**
 * Armed by the mid-mount regression test below, then disarmed on first use.
 * Every other test in this file leaves this `false`, so the mocked
 * `dsh-client-runtime` plugin below behaves identically to the real one for
 * them — a plain pass-through with no added delay.
 */
let armRuntimeMountDelay = false

// `apply()`'s last awaited mount step is `clientCtx.plugin(runtimeClient)`.
// None of the five mount steps actually waits on the transport (confirmed by
// hand before writing the regression test below: gating the fake transport's
// response never delayed any of `apply()`'s own awaits, because the
// reconnect loop that reaches the transport starts as a fire-and-forget
// effect of this plugin, not on its mount's critical path). Patching this
// plugin's `apply` to insert one genuine macrotask yield is the only way to
// deterministically force `apply()`'s Host-fiber-dispose race, instead of
// relying on cordis's own microtask timing to interleave by chance.
vi.mock(import('@deepseek-ai/dsh-client-runtime/client-node'), async (importOriginal) => {
  const actual = await importOriginal()
  return {
    // Explicit rather than only `...actual`: vitest's mocked-module proxy
    // throws on access to a key the factory did not return at all, even one
    // whose real value is `undefined` — `withInvariantReadiness` (a global
    // test-only wrapper every `ctx.plugin()` call goes through) reads
    // `plugin.name`/`.Config`/`.provide`/`.intercept` unconditionally.
    ...actual,
    name: undefined,
    Config: undefined,
    provide: undefined,
    intercept: undefined,
    // cordis's Plugin.Function accepts a `void | Promise<void>` apply, so an
    // async wrapper over a `void`-returning real `apply` is a normal plugin
    // shape (see `export async function apply` elsewhere in this repo) —
    // just one the analyzer cannot confirm from this factory's structural return type.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- see the comment above
    apply: async (...args: Parameters<typeof actual.apply>) => {
      if (armRuntimeMountDelay) {
        armRuntimeMountDelay = false
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      actual.apply(...args)
    },
  }
})

/** A Host `connection` stub whose in-process transport counts every request the Client tree makes. */
function countingHostConnection(calls: string[]): HostConnectionLike {
  return {
    inProcessHandler: () => ({
      fetch: (input: RequestInfo | URL) => {
        const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
        calls.push(url)
        // 404 keeps the Client tree in its reconnect loop, which is the state
        // that actually generates traffic to measure.
        return Promise.resolve(new Response('not found', { status: 404 }))
      },
    }),
  }
}

/** Wait `ms`, then report whether the counter moved. */
async function trafficAfter(calls: string[], ms: number): Promise<number> {
  const before = calls.length
  await new Promise(resolve => setTimeout(resolve, ms))
  return calls.length - before
}

describe('tui-runtime client tree quiescence after the Host row unloads', () => {
  it('stops every in-process call once the row is disposed', async () => {
    const calls: string[] = []
    const ctx = new Context()
    ctx.provide('connection', countingHostConnection(calls))
    ctx.provide('apiProxy', {})
    const fiber = ctx.plugin({ apply, inject }, { render: false })
    await fiber.await()

    // The tree is live: its readiness handshake has already reached the
    // transport (describe plus both event streams) by the time the row settles.
    expect(calls.length).toBeGreaterThan(0)

    await fiber.dispose()
    // Long enough to cover a reconnect backoff several times over.
    expect(await trafficAfter(calls, 1_500)).toBe(0)
  }, 20_000)

  it('is safe to dispose twice, and the second disposal starts nothing', async () => {
    const calls: string[] = []
    const ctx = new Context()
    ctx.provide('connection', countingHostConnection(calls))
    ctx.provide('apiProxy', {})
    const fiber = ctx.plugin({ apply, inject }, { render: false })
    await fiber.await()
    await fiber.dispose()
    // A second dispose of an already-disposed fiber settles inertly. It returns
    // `undefined` rather than a Promise, so awaiting it is the only safe shape
    // a caller has — `.then()` on the declared `Promise<void>` would throw.
    await fiber.dispose()
    expect(await trafficAfter(calls, 800)).toBe(0)
    // The published handle is gone with the row, both times.
    expect(ctx.get('tuiRuntime')).toBeUndefined()
  }, 20_000)

  it('settles when disposed before the initial ApiProxy activation', async () => {
    const calls: string[] = []
    const ctx = new Context()
    ctx.provide('connection', countingHostConnection(calls))
    const fiber = ctx.plugin({ apply, inject }, { render: false })
    const settled = fiber.await().then(() => 'settled' as const, () => 'rejected' as const)
    await new Promise<void>(resolve => setImmediate(resolve))
    await fiber.dispose()
    expect(await Promise.race([
      settled,
      new Promise<'timeout'>(resolve => setTimeout(() => { resolve('timeout') }, 500)),
    ])).toBe('settled')
    expect(await trafficAfter(calls, 1_500)).toBe(0)
    expect(ctx.get('tuiRuntime')).toBeUndefined()
  }, 20_000)

  it('does not accumulate Client trees across repeated mount/dispose cycles', async () => {
    // An HMR reload or a profile switch remounts this row. Each cycle must take
    // its whole Client tree with it, or the surviving trees' reconnect loops
    // stack up — N connect/pump loops against one Host.
    const calls: string[] = []
    const ctx = new Context()
    ctx.provide('connection', countingHostConnection(calls))
    ctx.provide('apiProxy', {})

    for (let cycle = 0; cycle < 5; cycle += 1) {
      const fiber = ctx.plugin({ apply, inject }, { render: false })
      await fiber.await()
      expect(ctx.get('tuiRuntime')).toBeDefined()
      await fiber.dispose()
      expect(ctx.get('tuiRuntime')).toBeUndefined()
    }

    // After the last cycle nothing from any of the five is still talking.
    expect(await trafficAfter(calls, 1_500)).toBe(0)
  }, 30_000)

  it('disposes cleanly even when disposal is requested in the same tick the row is created', async () => {
    // `apply()` registers its cleanup effect only after five sequential
    // `clientCtx.plugin()` awaits. Calling `fiber.dispose()` in the same tick
    // `ctx.plugin()` returns does not reliably land the disposal *during* one
    // of those awaits (cordis's own microtask bookkeeping for the mount tends
    // to settle first) — the next test below forces that interleaving
    // deterministically. This case is kept as a cheap, order-agnostic smoke
    // test: whichever way the two chains interleave, the outcome must hold.
    const calls: string[] = []
    const ctx = new Context()
    ctx.provide('connection', countingHostConnection(calls))
    ctx.provide('apiProxy', {})
    const fiber = ctx.plugin({ apply, inject }, { render: false })
    let rejected = false
    const settled = fiber.await().catch(() => { rejected = true })
    const disposed = fiber.dispose()
    await Promise.all([settled, disposed])
    expect(rejected).toBe(false)
    expect(await trafficAfter(calls, 1_500)).toBe(0)
    expect(ctx.get('tuiRuntime')).toBeUndefined()
  }, 20_000)

  it('regression: tears the Client tree down without a swallowed rejection when the row is disposed mid-mount', async () => {
    // Deterministic version of the case above, using the module-level
    // `armRuntimeMountDelay` mock above to force `apply()`'s LAST awaited
    // mount step (`clientCtx.plugin(runtimeClient)`) to genuinely yield to a
    // macrotask. `fiber.dispose()` below runs while that await is suspended,
    // so by the time `apply()` resumes and reaches `ctx.effect()`, the row's
    // fiber is already disposed and `ctx.effect()` throws `INACTIVE_EFFECT`
    // — exactly the case `src/index.ts` catches to dispose the already-built
    // Client tree itself instead of leaking it.
    //
    // Reverting that catch (restoring the bare `ctx.effect()` call) makes
    // this test fail: `rejected` flips to `true` (the throw reaches nothing
    // that disposes the Client tree, only cordis's internal fiber logger,
    // per `_reload()`'s `catch` in vendor/cordis/src/fiber.ts) and the
    // now-leaked Client tree's reconnect loop keeps `trafficAfter` above 0.
    const calls: string[] = []
    const ctx = new Context()
    ctx.provide('connection', countingHostConnection(calls))
    ctx.provide('apiProxy', {})

    armRuntimeMountDelay = true
    const fiber = ctx.plugin({ apply, inject }, { render: false })

    // Wait for the mount to actually reach the armed delay and consume it,
    // so disposal below is guaranteed to land mid-await rather than racing a
    // mount that has not started (or already finished) settling.
    const deadline = Date.now() + 2_000
    while (armRuntimeMountDelay) {
      if (Date.now() > deadline) throw new Error('apply() never reached clientCtx.plugin(runtimeClient)')
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    let rejected = false
    const settled = fiber.await().catch(() => { rejected = true })
    // The row's fiber starts unloading now, while `apply()` is still
    // suspended on the armed macrotask delay above — the exact race this
    // test exists to force.
    const disposed = fiber.dispose()
    await Promise.all([settled, disposed])

    expect(rejected).toBe(false)
    expect(await trafficAfter(calls, 1_500)).toBe(0)
    expect(ctx.get('tuiRuntime')).toBeUndefined()
  }, 20_000)

  it('regression: propagates a genuinely unexpected ctx.effect() failure and still disposes the just-built Client tree', async () => {
    // `ctx.effect()` can in principle throw for a reason other than the Host
    // row unloading (a defensive case with no current trigger — cordis's own
    // `effect()` only ever throws `INACTIVE_EFFECT` from this call site).
    // Force it anyway, targeted at this exact registration by its label so
    // every other `Fiber.effect()` call in the same mount (cordis's own
    // bookkeeping included) keeps its real behavior. The Client tree above
    // must still be torn down (nothing else will ever dispose it), and the
    // unexpected error must propagate rather than being swallowed as if it
    // were the ordinary teardown race.
    const calls: string[] = []
    const ctx = new Context()
    ctx.provide('connection', countingHostConnection(calls))
    ctx.provide('apiProxy', {})

    const unexpected = new Error('effect registration exploded for an unrelated reason')
    // Captured before vi.spyOn() below replaces Fiber.prototype.effect; re-bound
    // via .call(this, ...) at each use below, never called unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- see the comment above
    const originalEffect = Fiber.prototype.effect
    const effectSpy = vi.spyOn(Fiber.prototype, 'effect')
      .mockImplementation(function (this: Fiber, execute: () => unknown, label?: string) {
        if (label === 'tui-runtime: client tree lifecycle') throw unexpected
        return originalEffect.call(this, execute as never, label as never)
      })

    try {
      const fiber = ctx.plugin({ apply, inject }, { render: false })
      await expect(fiber.await()).rejects.toBe(unexpected)
      expect(await trafficAfter(calls, 500)).toBe(0)
      expect(ctx.get('tuiRuntime')).toBeUndefined()
    } finally {
      effectSpy.mockRestore()
    }
  })
})
