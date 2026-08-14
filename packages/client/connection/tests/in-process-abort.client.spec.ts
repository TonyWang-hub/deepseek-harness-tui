/**
 * Abort semantics of the in-process carrier's Client half: the generic RPC
 * caller (`createInProcessConnectionRpc`) and the `InProcessApiClient` stream
 * path, driven against handlers that are deliberately hostile about
 * cancellation — one that ignores its `init.signal` entirely, one that never
 * settles, one that settles just after the caller aborts.
 *
 * The contract under test is the one both halves document verbatim: an
 * injected transport must not be able to leave a call pending forever just
 * because it never checks the signal it was handed. Nothing here needs a Host
 * composition, so the file stays client-aggregate-only: it imports the carrier
 * from `../src/client/`, never `../src/index.ts` (whose Host Cordis `Context`
 * merge would poison this program).
 */
import { getEventListeners } from 'node:events'
import { describe, expect, it } from 'vitest'
import { InProcessApiClient } from '../src/client/api.ts'
import { createInProcessConnectionRpc } from '../src/client/rpc-in-process.ts'

/** Well-formed server-response envelope echoing whatever rpcId the caller minted. */
function echoResponse(body: string): Response {
  const message = JSON.parse(body) as { rpcId: string }
  return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value: { pong: true } } })
}

/** Count the abort listeners the carrier has attached to one signal. */
function abortListenerCount(signal: AbortSignal): number {
  return getEventListeners(signal, 'abort').length
}

describe('createInProcessConnectionRpc abort races', () => {
  it('rejects an already-aborted call without ever entering the handler', async () => {
    let entered = 0
    const rpc = createInProcessConnectionRpc({
      fetch: (_input, init) => {
        entered += 1
        return Promise.resolve(echoResponse(String(init?.body)))
      },
    })
    const controller = new AbortController()
    controller.abort(new Error('gone before dispatch'))

    await expect(rpc.call('/tui-rpc', 'ping', {}, controller.signal)).rejects.toThrow('gone before dispatch')
    // The transport is never reached: a caller that cancelled before dispatch
    // must not produce host-side work whose result nobody will read.
    expect(entered).toBe(0)
  })

  it('rejects when the signal fires between dispatch and a handler that ignores it', async () => {
    // The hostile case the contract names: this handler accepts init.signal and
    // then never looks at it again, so only the caller-side race can settle.
    let released = (): void => {}
    const rpc = createInProcessConnectionRpc({
      fetch: (_input, init) => new Promise<Response>((resolve) => {
        released = () => { resolve(echoResponse(String(init?.body))) }
      }),
    })
    const controller = new AbortController()
    const call = rpc.call('/tui-rpc', 'ping', {}, controller.signal)
    controller.abort(new Error('generation withdrawn mid-flight'))

    await expect(call).rejects.toThrow('generation withdrawn mid-flight')
    // The handler settling afterwards must not resurface as an unhandled
    // rejection or a second settlement of the same call.
    released()
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('reuses one signal across concurrent calls without accumulating abort listeners', async () => {
    // A ConnectionController generation hands the SAME signal to every call it
    // makes. If the carrier leaked one abort listener per call, a long
    // generation would grow that list without bound and eventually trip Node's
    // max-listeners warning on a hot path.
    const rpc = createInProcessConnectionRpc({
      fetch: (_input, init) => Promise.resolve(echoResponse(String(init?.body))),
    })
    const controller = new AbortController()
    expect(abortListenerCount(controller.signal)).toBe(0)

    const inFlight = Array.from({ length: 8 }, () => rpc.call('/tui-rpc', 'ping', {}, controller.signal))
    const results = await Promise.all(inFlight)
    expect(results).toHaveLength(8)
    expect(results.every(result => result.ok)).toBe(true)
    expect(abortListenerCount(controller.signal)).toBe(0)

    // The same signal still cancels a later call: settling earlier ones did not
    // detach the carrier from it.
    const stalled = rpc.call('/tui-rpc', 'ping', {}, controller.signal)
    controller.abort(new Error('later'))
    await expect(stalled).rejects.toThrow()
  })

  it('aborts every concurrent call sharing one signal exactly once', async () => {
    const rpc = createInProcessConnectionRpc({
      fetch: () => new Promise<Response>(() => { /* never settles */ }),
    })
    const controller = new AbortController()
    const calls = Array.from({ length: 5 }, () => rpc.call('/tui-rpc', 'ping', {}, controller.signal))
    controller.abort(new Error('all at once'))

    const outcomes = await Promise.allSettled(calls)
    expect(outcomes.map(outcome => outcome.status)).toEqual(Array.from({ length: 5 }, () => 'rejected'))
    expect(abortListenerCount(controller.signal)).toBe(0)
  })

  it('leaves no abort listener behind when the signal fires after the call resolved', async () => {
    const rpc = createInProcessConnectionRpc({
      fetch: (_input, init) => Promise.resolve(echoResponse(String(init?.body))),
    })
    const controller = new AbortController()
    await expect(rpc.call('/tui-rpc', 'ping', {}, controller.signal)).resolves.toMatchObject({ ok: true })
    expect(abortListenerCount(controller.signal)).toBe(0)

    // A late abort of a signal whose call already settled must be inert — no
    // unhandled rejection from the removed listener.
    controller.abort(new Error('late'))
    await new Promise(resolve => setTimeout(resolve, 10))
  })

  it('rejects a handler failure without swallowing it into a resolved result', async () => {
    const rpc = createInProcessConnectionRpc({
      fetch: () => Promise.reject(new Error('transport exploded')),
    })
    await expect(rpc.call('/tui-rpc', 'ping', {}, new AbortController().signal)).rejects.toThrow('transport exploded')
  })

  it('mirrors a string abort reason verbatim, not just an Error reason', async () => {
    // Every other case in this file aborts with `new Error(...)`, always
    // taking `abortError`'s `reason instanceof Error` branch. `AbortSignal`
    // also accepts a plain string reason (and anything else), so the
    // fallback branches need their own coverage.
    const rpc = createInProcessConnectionRpc({
      fetch: () => new Promise<Response>(() => { /* never settles */ }),
    })
    const controller = new AbortController()
    const call = rpc.call('/tui-rpc', 'ping', {}, controller.signal)
    controller.abort('plain string reason')
    await expect(call).rejects.toThrow('plain string reason')
  })

  it('falls back to a generic abort message for a reason that is neither an Error nor a string', async () => {
    const rpc = createInProcessConnectionRpc({
      fetch: () => new Promise<Response>(() => { /* never settles */ }),
    })
    const controller = new AbortController()
    const call = rpc.call('/tui-rpc', 'ping', {}, controller.signal)
    controller.abort(42)
    await expect(call).rejects.toThrow('This operation was aborted')
  })
})

describe('the pending-interaction respond carrier against a withdrawn transport', () => {
  /**
   * `PendingWait.respond()` (client-runtime) is a thin rpcId backfill over
   * `IApiClient.respond`, which is this carrier's `/api/respond` POST. A
   * terminal renderer holds a pending approval or question across a Host
   * withdrawal, so what the user's answer does at that moment is decided here.
   */
  it('rejects rather than reporting a fabricated receipt when the handler is gone', async () => {
    let composed = true
    const client = new InProcessApiClient({
      fetch: () => Promise.resolve(composed
        ? Response.json({ accepted: true })
        // Exactly what `inProcessHandler()` answers once its ApiProxy (or the
        // whole connection row) has withdrawn.
        : new Response('not found', { status: 404 })),
    })
    const message = {
      type: 'client-response' as const,
      rpcId: 'rpc-pending' as never,
      result: { ok: true as const, value: { sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once' } },
    }

    await expect(client.respond(message)).resolves.toMatchObject({ accepted: true })

    composed = false
    // The answer must surface as a transport failure the renderer can show and
    // retry, never as a silently accepted receipt for a Host that never got it.
    await expect(client.respond(message)).rejects.toThrow(/transport failure for \/api\/respond: HTTP 404/)
  })

  it('rejects a respond whose caller signal aborts first, without reaching the transport', async () => {
    let reached = 0
    const client = new InProcessApiClient({
      fetch: () => {
        reached += 1
        return Promise.resolve(Response.json({ accepted: true }))
      },
    })
    const controller = new AbortController()
    controller.abort(new Error('session closed while the question was open'))
    await expect(client.respond({
      type: 'client-response',
      rpcId: 'rpc-pending' as never,
      result: { ok: true, value: {} },
    }, controller.signal)).rejects.toThrow('session closed while the question was open')
    expect(reached).toBe(0)
  })
})

describe('InProcessApiClient stream abort races', () => {
  /** SSE-shaped response whose body stays open until `signal` aborts. */
  function openStream(signal: AbortSignal | null | undefined, opened: { count: number }): Response {
    opened.count += 1
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = (): void => {
          try {
            controller.close()
          } catch {
            // Already closed by an earlier abort of the same signal.
          }
        }
        if (signal?.aborted === true) close()
        else signal?.addEventListener('abort', close, { once: true })
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }

  it('never opens the stream when the caller signal is already aborted', async () => {
    const opened = { count: 0 }
    const client = new InProcessApiClient({
      fetch: (_input, init) => Promise.resolve(openStream(init?.signal, opened)),
    })
    const controller = new AbortController()
    controller.abort(new Error('already gone'))

    let onOpenCalls = 0
    await expect((async () => {
      for await (const _frame of client.events.mux({}, controller.signal, () => { onOpenCalls += 1 })) { /* none */ }
    })()).rejects.toThrow('already gone')
    expect(opened.count).toBe(0)
    expect(onOpenCalls).toBe(0)
  })

  it('ends an open stream when the caller aborts immediately after onOpen', async () => {
    const opened = { count: 0 }
    const client = new InProcessApiClient({
      fetch: (_input, init) => Promise.resolve(openStream(init?.signal, opened)),
    })
    const controller = new AbortController()
    let onOpenCalls = 0
    const pump = (async () => {
      for await (const _frame of client.events.mux({}, controller.signal, () => {
        onOpenCalls += 1
        // Abort from inside onOpen: the tightest possible race between the
        // stream being declared established and the generation being withdrawn.
        controller.abort(new Error('withdrawn at onOpen'))
      })) { /* no frames */ }
    })()

    await expect(Promise.race([
      pump.then(() => 'ended' as const),
      new Promise<'hung'>((resolve) => { setTimeout(() => { resolve('hung') }, 1_000) }),
    ])).resolves.toBe('ended')
    expect(opened.count).toBe(1)
    expect(onOpenCalls).toBe(1)
  })

  it('rejects an abort that lands while the request leg is still in flight', async () => {
    // Abort before the transport ever answers: `doFetch`'s own race settles
    // this leg, even though this handler never watches the signal it was given.
    const client = new InProcessApiClient({
      fetch: () => new Promise<Response>(() => { /* never answers */ }),
    })
    const controller = new AbortController()
    const pump = (async () => {
      for await (const _frame of client.events.mux({}, controller.signal)) { /* no frames */ }
    })()
    controller.abort(new Error('withdrawn before headers'))

    await expect(Promise.race([
      pump,
      new Promise((_resolve, reject) => { setTimeout(() => { reject(new Error('hung')) }, 1_000) }),
    ])).rejects.toThrow('withdrawn before headers')
  })

  it('parks on the body reader when a transport ignores the signal after the headers are in', async () => {
    // A documented gap, pinned rather than asserted away. `InProcessApiClient.doFetch`
    // races only the REQUEST leg; once the response headers are in, progress
    // belongs to the body reader, and a body that neither closes nor watches
    // the signal leaves this iteration parked with no deadline of its own.
    //
    // No shipped carrier produces one — `toFetchHandler`'s SSE body ends on the
    // request signal, which is what the generation-owned fallback relies on —
    // so the guard is not re-derived here. This case exists so that a future
    // carrier (an IPC or worker bridge whose body is not signal-bound) fails
    // this expectation instead of silently wedging a terminal session's stream
    // pump.
    const client = new InProcessApiClient({
      fetch: () => Promise.resolve(new Response(
        new ReadableStream<Uint8Array>({ start() { /* readable, never closes, ignores the signal */ } }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )),
    })
    const controller = new AbortController()
    let opened = false
    const pump = (async () => {
      for await (const _frame of client.events.mux({}, controller.signal, () => { opened = true })) { /* no frames */ }
    })()
    // Only abort once the headers are in, so the request leg cannot claim it.
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(opened).toBe(true)
    controller.abort(new Error('withdrawn after headers'))

    await expect(Promise.race([
      pump.then(() => 'ended' as const).catch(() => 'ended' as const),
      new Promise<'still-reading'>((resolve) => { setTimeout(() => { resolve('still-reading') }, 200) }),
    ])).resolves.toBe('still-reading')
  })
})
