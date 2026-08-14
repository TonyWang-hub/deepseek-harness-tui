/**
 * `ConnectionController` teardown quiescence: after `stop()`, the controller
 * must leave no armed timer behind.
 *
 * The browser face never needed this — a page unload takes the whole timer
 * heap with it. The terminal application embeds the same controller in a Node
 * process that exits when its event loop drains, so an armed
 * `streamOpenTimeoutMs` or backoff timer is the difference between `dsh`
 * exiting and `dsh` appearing to hang for up to `backoffMaxMs` after the user
 * quit.
 *
 * Two leaks this pins:
 *   - the readiness handshake's `streamOpenTimeoutMs` sleep was aborted only on
 *     the success path, so every generation whose `host.describe` REJECTED left
 *     one armed for its full duration — one per attempt under a reconnect storm;
 *   - the backoff sleep between generations used a local `AbortController` that
 *     `stop()` could not reach.
 */
import { describe, expect, it } from 'vitest'
import type { HostFrame, IApiClient, MuxFrame, RpcRequest } from '../src/client/api.ts'
import { ConnectionController } from '../src/client/connection.ts'

/** Timer bookkeeping around one scenario: every `setTimeout` that is neither fired nor cleared stays listed. */
interface TimerProbe {
  /** Delays of the timers still armed right now. */
  armed(): number[]
  /** Restore the real timer functions. */
  restore(): void
  /** Real (unpatched) sleep, so the probe never counts its own scheduling. */
  wait(ms: number): Promise<void>
}

function probeTimers(): TimerProbe {
  const live = new Map<unknown, number>()
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = ((handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    const id: unknown = realSetTimeout(((...fired: unknown[]) => {
      live.delete(id)
      handler(...fired)
    }) as never, delay, ...args as never[])
    live.set(id, delay ?? 0)
    return id
  }) as typeof globalThis.setTimeout
  globalThis.clearTimeout = ((id: never) => {
    live.delete(id)
    realClearTimeout(id)
  }) as typeof globalThis.clearTimeout
  return {
    armed: () => [...live.values()],
    restore: () => {
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    },
    wait: ms => new Promise<void>((resolve) => { realSetTimeout(resolve, ms) }),
  }
}

/** An api client whose unary calls always fail and whose streams stay open until aborted. */
function unreachableApi(): IApiClient {
  const openUntilAborted = async function *<F>(signal: AbortSignal): AsyncGenerator<RpcRequest<F>> {
    if (signal.aborted) return
    await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
  }
  return {
    host: { describe: () => Promise.reject(new Error('host unreachable')) },
    events: {
      mux: (_payload: unknown, signal: AbortSignal) => openUntilAborted<MuxFrame>(signal),
      host: (_payload: unknown, signal: AbortSignal) => openUntilAborted<HostFrame>(signal),
    },
  } as unknown as IApiClient
}

describe('ConnectionController teardown quiescence', () => {
  it('leaves no armed timer after stop() during the backoff between generations', async () => {
    const timers = probeTimers()
    try {
      const controller = new ConnectionController(unreachableApi(), {}, {
        // A backoff long enough that stop() lands inside it deterministically,
        // and a stream-open timeout long enough to still be armed if the failed
        // handshake never aborted it.
        backoffBaseMs: 4_000,
        backoffFactor: 1,
        backoffMaxMs: 4_000,
        streamOpenTimeoutMs: 5_000,
      })
      controller.start()
      // Let the first generation fail its describe and settle into backoff.
      await timers.wait(120)
      expect(timers.armed().length).toBeGreaterThan(0)

      controller.stop()
      await timers.wait(50)
      expect(timers.armed()).toEqual([])
    } finally {
      timers.restore()
    }
  })

  it('cancels the readiness handshake timeout of every generation whose describe rejected', async () => {
    const timers = probeTimers()
    try {
      const controller = new ConnectionController(unreachableApi(), {}, {
        // Short backoff, long stream-open timeout: several generations fail
        // within the observation window, and each one's un-cancelled handshake
        // timer would still be armed at the end.
        backoffBaseMs: 20,
        backoffFactor: 1,
        backoffMaxMs: 20,
        streamOpenTimeoutMs: 30_000,
      })
      controller.start()
      await timers.wait(300)
      controller.stop()
      await timers.wait(50)
      expect(timers.armed()).toEqual([])
    } finally {
      timers.restore()
    }
  })

  it('is idempotent: a second stop() before any generation ran changes nothing', async () => {
    const timers = probeTimers()
    try {
      const controller = new ConnectionController(unreachableApi(), {}, { streamOpenTimeoutMs: 5_000 })
      controller.start()
      controller.stop()
      controller.stop()
      await timers.wait(50)
      expect(timers.armed()).toEqual([])
    } finally {
      timers.restore()
    }
  })

  it('stays stopped when stop() lands inside the readiness handshake', async () => {
    const timers = probeTimers()
    try {
      const states: string[] = []
      const controller = new ConnectionController(unreachableApi(), {
        onStateChange: state => states.push(state),
      }, { backoffBaseMs: 20, backoffFactor: 1, backoffMaxMs: 20, streamOpenTimeoutMs: 5_000 })
      controller.start()
      // Same tick as start(): the handshake's describe is in flight and its
      // stream-open sleep is already armed.
      controller.stop()
      await timers.wait(200)
      expect(timers.armed()).toEqual([])
      // A stopped controller must not keep announcing reconnect attempts.
      expect(states).not.toContain('connected')
    } finally {
      timers.restore()
    }
  })
})
