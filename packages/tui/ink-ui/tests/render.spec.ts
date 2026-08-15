import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { AgentContext, ConversationSnapshot, ISessions, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { mountTuiRenderer } from '../src/render.ts'
import { createFakeStdin, createFakeStdout } from './support/fake-tty.ts'

function baseSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: 's1' as SessionId,
    views: undefined as never,
    chat: undefined as never,
    nodes: [],
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    subagent: null,
    composerPhase: 'blank',
    removed: false,
    openState: 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: true,
    lastAgentError: null,
    ...overrides,
  }
}

class FakeSessionFace {
  readonly sessionId = 's1' as SessionId
  readonly projections = { faceOf: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }
  readonly prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  readonly cancel = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  readonly readAttachment = vi.fn(async () => { throw new Error('not implemented') })
  readonly updateQueue = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  readonly rename = vi.fn(async () => ({ ok: true as const, value: { title: '', seq: 0 } }))
  readonly loadOlder = vi.fn(async () => {})
  readonly command = vi.fn(async () => ({ ok: true as const, value: { matched: false } }))
  #snapshot: ConversationSnapshot
  #listeners = new Set<() => void>()

  constructor(initial: ConversationSnapshot) {
    this.#snapshot = initial
  }

  getSnapshot = (): ConversationSnapshot => this.#snapshot
  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn)
    return () => { this.#listeners.delete(fn) }
  }

  push(next: ConversationSnapshot): void {
    this.#snapshot = next
    for (const fn of [...this.#listeners]) fn()
  }

  listenerCount(): number {
    return this.#listeners.size
  }
}

/**
 * A `list` observable whose snapshot already lists `listedIds` —
 * `mountTuiRenderer` waits for a session to appear here before opening it.
 */
function createFakeSessionList(listedIds: SessionId[]): ISessions['list'] {
  const snapshot = { ids: listedIds } as unknown as ReturnType<ISessions['list']['getSnapshot']>
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

function createFakeSessions(
  face: SessionFace,
  options: {
    scopeUndefined?: boolean
    sessionOfUndefined?: boolean
    listedIds?: SessionId[]
    // Accepted separately from the returned `ISessions` so a caller that needs
    // to assert on calls can hold this reference directly: `ISessions.open`
    // is a method-shorthand interface member, so reading it back off the
    // returned object (`sessions.open`) triggers unbound-method.
    open?: ReturnType<typeof vi.fn<(id: SessionId) => void>>
  } = {},
): ISessions {
  return {
    list: createFakeSessionList(options.listedIds ?? ['s1' as SessionId]),
    currentProvideInfo: undefined as never,
    searchResultLimit: 0,
    open: options.open ?? vi.fn(),
    openSubagent: vi.fn(),
    subagentAddress: () => undefined,
    setSubagentCatalogOpen: vi.fn(),
    refreshSubagents: vi.fn(async () => {}),
    noteAgentPreset: vi.fn(),
    clear: vi.fn(),
    search: vi.fn(async () => ({ ok: true as const, value: { items: [], hasMore: false } })),
    fork: vi.fn(async () => 's1' as SessionId),
    provide: () => () => {},
    scope: () => (options.scopeUndefined === true ? undefined : ({} as AgentContext)),
    scopeOf: () => undefined,
    sessionOf: () => (options.sessionOfUndefined === true ? undefined : face),
    binding: () => undefined,
  }
}

/**
 * Build a Client-tree-shaped `Context` carrying the fake `sessions` (and
 * optionally `connection`) services `mountTuiRenderer` reads via `ctx.get()`.
 */
function createClientCtx(sessions: ISessions, connection?: ConnectionHandle): Context {
  const ctx = new Context()
  ctx.provide('sessions', sessions)
  if (connection !== undefined) ctx.provide('connection', connection)
  return ctx
}

describe('mountTuiRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the named session and mounts the initial frame', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const open = vi.fn<(id: SessionId) => void>()
    const sessions = createFakeSessions(face, { open })
    const clientCtx = createClientCtx(sessions)
    const stdout = createFakeStdout()
    const stdin = createFakeStdin()

    const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId, stdout, stdin })
    expect(mounted.sessionId).toBe('s1')
    expect(open).toHaveBeenCalledWith('s1')
    await mounted.dispose()
  })

  it('throws when sessions.scope() returns undefined', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face, { scopeUndefined: true })
    const clientCtx = createClientCtx(sessions)
    await expect(mountTuiRenderer(clientCtx, {
      sessionId: 's1' as SessionId, stdout: createFakeStdout(), stdin: createFakeStdin(),
    })).rejects.toThrow('could not be opened')
  })

  it('throws when sessions.sessionOf() returns undefined', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face, { sessionOfUndefined: true })
    const clientCtx = createClientCtx(sessions)
    await expect(mountTuiRenderer(clientCtx, {
      sessionId: 's1' as SessionId, stdout: createFakeStdout(), stdin: createFakeStdin(),
    })).rejects.toThrow('has no session face')
  })

  it('creates a fresh session via connection.api.sessions.create() when no sessionId is given', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const connection = {
      api: { sessions: { create: vi.fn(async () => ({ result: { ok: true, value: { sessionId: 's1' } } })) } },
    } as unknown as ConnectionHandle
    const clientCtx = createClientCtx(sessions, connection)
    const mounted = await mountTuiRenderer(clientCtx, { stdout: createFakeStdout(), stdin: createFakeStdin() })
    expect(mounted.sessionId).toBe('s1')
    await mounted.dispose()
  })

  it('throws when session.create() fails', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const connection = {
      api: { sessions: { create: vi.fn(async () => ({ result: { ok: false, error: { code: 'BOOM' } } })) } },
    } as unknown as ConnectionHandle
    const clientCtx = createClientCtx(sessions, connection)
    await expect(mountTuiRenderer(clientCtx, { stdout: createFakeStdout(), stdin: createFakeStdin() }))
      .rejects.toThrow('BOOM')
  })

  it('waits for the session to appear in sessions.list before opening it', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    let listedIds: SessionId[] = []
    const listListeners = new Set<() => void>()
    const open = vi.fn<(id: SessionId) => void>()
    const sessions: ISessions = {
      ...createFakeSessions(face, { listedIds: [], open }),
      list: {
        getSnapshot: () => ({ ids: listedIds }) as unknown as ReturnType<ISessions['list']['getSnapshot']>,
        subscribe: (fn) => {
          listListeners.add(fn)
          return () => { listListeners.delete(fn) }
        },
      },
    }
    const clientCtx = createClientCtx(sessions)
    const mountPromise = mountTuiRenderer(clientCtx, {
      sessionId: 's1' as SessionId, stdout: createFakeStdout(), stdin: createFakeStdin(),
    })
    await delay(20)
    expect(open).not.toHaveBeenCalled()
    // An intervening list update that still does not include 's1' (e.g. some
    // OTHER session appearing first) must not resolve the wait early.
    for (const fn of [...listListeners]) fn()
    await delay(20)
    expect(open).not.toHaveBeenCalled()
    listedIds = ['s1' as SessionId]
    for (const fn of [...listListeners]) fn()
    const mounted = await mountPromise
    expect(open).toHaveBeenCalledWith('s1')
    await mounted.dispose()
  })

  it('throws when the session never appears in sessions.list within the configured timeout', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face, { listedIds: [] })
    const clientCtx = createClientCtx(sessions)
    await expect(mountTuiRenderer(clientCtx, {
      sessionId: 's1' as SessionId,
      stdout: createFakeStdout(),
      stdin: createFakeStdin(),
      config: { sessionListTimeoutMs: 30 },
    })).rejects.toThrow('did not appear in sessions.list')
  })

  it('commits a newly closed node to scrollback (structural, immediate)', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdout = createFakeStdout()
    const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId, stdout, stdin: createFakeStdin() })

    face.push(baseSnapshot({
      nodes: [{ kind: 'user', seq: 0, time: 0, content: [{ type: 'text', text: 'hello there' }], source: undefined }],
    }))
    expect(stdout.buffer).toContain('hello there')
    await mounted.dispose()
  })

  it('never re-commits an already-committed node on a later unrelated structural update', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdout = createFakeStdout()
    const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId, stdout, stdin: createFakeStdin() })

    const withNode = baseSnapshot({
      nodes: [{ kind: 'user', seq: 0, time: 0, content: [{ type: 'text', text: 'once only' }], source: undefined }],
    })
    face.push(withNode)
    const occurrencesAfterFirst = stdout.buffer.split('once only').length - 1
    expect(occurrencesAfterFirst).toBe(1)
    face.push({ ...withNode, running: true }) // structural (running changed), same nodes array
    const occurrencesAfterSecond = stdout.buffer.split('once only').length - 1
    expect(occurrencesAfterSecond).toBe(1)
    await mounted.dispose()
  })

  it('does not exist as a pre-existing baseline node: nodes already present at mount are not replayed', async () => {
    const face = new FakeSessionFace(baseSnapshot({
      nodes: [{ kind: 'user', seq: 0, time: 0, content: [{ type: 'text', text: 'already there' }], source: undefined }],
    }))
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdout = createFakeStdout()
    const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId, stdout, stdin: createFakeStdin() })
    expect(stdout.buffer).not.toContain('already there')
    await mounted.dispose()
  })

  it('submitting from the composer calls SessionFace.prompt() with the text', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdin = createFakeStdin()
    const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId, stdout: createFakeStdout(), stdin })
    stdin.feed('hi')
    await delay(60)
    stdin.feed('\r')
    await delay(60)
    expect(face.prompt).toHaveBeenCalledExactlyOnceWith([{ type: 'text', text: 'hi' }], 'queue')
    await mounted.dispose()
  })

  it('logs an error when prompt() rejects', async () => {
    // Ink's `patchConsole` (default `patchConsole: true`) replaces the
    // GLOBAL `console.error` the moment `render()` mounts, routing it to
    // `Ink#writeToStderr` — a `vi.spyOn(console, 'error')` installed before
    // that point never sees this module's later calls, since Ink's own
    // replacement does not delegate back to whatever `console.error` held.
    // Assert on the fake stderr stream's buffer instead.
    const face = new FakeSessionFace(baseSnapshot())
    face.prompt.mockRejectedValueOnce(new Error('network down'))
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdin = createFakeStdin()
    const stderr = createFakeStdout()
    const mounted = await mountTuiRenderer(clientCtx, {
      sessionId: 's1' as SessionId, stdout: createFakeStdout(), stdin, stderr,
    })
    stdin.feed('hi')
    await delay(60)
    stdin.feed('\r')
    await delay(60)
    expect(stderr.buffer).toContain('mountTuiRenderer: prompt() failed')
    expect(stderr.buffer).toContain('network down')
    await mounted.dispose()
  })

  it('Esc calls SessionFace.cancel()', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdin = createFakeStdin()
    const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId, stdout: createFakeStdout(), stdin })
    stdin.feed('\x1b')
    await delay(60)
    expect(face.cancel).toHaveBeenCalledOnce()
    await mounted.dispose()
  })

  it('logs an error when cancel() rejects', async () => {
    // See the identical note in "logs an error when prompt() rejects" above.
    const face = new FakeSessionFace(baseSnapshot())
    face.cancel.mockRejectedValueOnce(new Error('cannot cancel'))
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdin = createFakeStdin()
    const stderr = createFakeStdout()
    const mounted = await mountTuiRenderer(clientCtx, {
      sessionId: 's1' as SessionId, stdout: createFakeStdout(), stdin, stderr,
    })
    stdin.feed('\x1b')
    await delay(60)
    expect(stderr.buffer).toContain('mountTuiRenderer: cancel() failed')
    expect(stderr.buffer).toContain('cannot cancel')
    await mounted.dispose()
  })

  it('coalesces a rapid stream-classified update (unchanged counts) to the configured frame rate', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdout = createFakeStdout()
    const mounted = await mountTuiRenderer(clientCtx, {
      sessionId: 's1' as SessionId, stdout, stdin: createFakeStdin(), config: { publishRateFps: 30 },
    })
    face.push(baseSnapshot({ partial: { turn: 0, step: 0, blocks: [{ kind: 'text', text: 'a' }] } }))
    face.push(baseSnapshot({ partial: { turn: 0, step: 0, blocks: [{ kind: 'text', text: 'ab' }] } }))
    await delay(100)
    expect(stdout.buffer).toContain('ab')
    await mounted.dispose()
  })

  it('dispose() unsubscribes: a later snapshot push commits nothing further', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdout = createFakeStdout()
    const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId, stdout, stdin: createFakeStdin() })
    await mounted.dispose()
    expect(face.listenerCount()).toBe(0)
    face.push(baseSnapshot({
      nodes: [{ kind: 'user', seq: 0, time: 0, content: [{ type: 'text', text: 'after dispose' }], source: undefined }],
    }))
    expect(stdout.buffer).not.toContain('after dispose')
  })

  it('dispose() is idempotent', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const mounted = await mountTuiRenderer(clientCtx, {
      sessionId: 's1' as SessionId, stdout: createFakeStdout(), stdin: createFakeStdin(),
    })
    await mounted.dispose()
    await expect(mounted.dispose()).resolves.toBeUndefined()
  })

  it('waitUntilExit() resolves once Ink exits on its own (Ctrl-C) and tears down the subscription without an explicit dispose()', async () => {
    const face = new FakeSessionFace(baseSnapshot())
    const sessions = createFakeSessions(face)
    const clientCtx = createClientCtx(sessions)
    const stdout = createFakeStdout()
    const stdin = createFakeStdin()
    const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId, stdout, stdin })
    stdin.feed('\x03') // Ctrl-C: Ink's own exitOnCtrlC path
    await mounted.waitUntilExit()
    await delay(60)
    expect(face.listenerCount()).toBe(0)
    face.push(baseSnapshot({
      nodes: [{ kind: 'user', seq: 0, time: 0, content: [{ type: 'text', text: 'after ctrl-c' }], source: undefined }],
    }))
    expect(stdout.buffer).not.toContain('after ctrl-c')
  })

  it('falls back to process.stdout/stdin and to default columns/rows when the stream reports none', async () => {
    const fakeProcessStdout = createFakeStdout(0, 0)
    const fakeProcessStdin = createFakeStdin()
    const stdoutSpy = vi.spyOn(process, 'stdout', 'get').mockReturnValue(fakeProcessStdout)
    const stdinSpy = vi.spyOn(process, 'stdin', 'get').mockReturnValue(fakeProcessStdin)
    try {
      const face = new FakeSessionFace(baseSnapshot())
      const sessions = createFakeSessions(face)
      const clientCtx = createClientCtx(sessions)
      // Neither `stdout` nor `stdin` is passed: mountTuiRenderer must fall
      // back to `process.stdout`/`process.stdin` (stubbed above) and, since
      // the fake reports columns/rows of 0, to its own default width/height.
      const mounted = await mountTuiRenderer(clientCtx, { sessionId: 's1' as SessionId })
      face.push(baseSnapshot({
        nodes: [{ kind: 'user', seq: 0, time: 0, content: [{ type: 'text', text: 'fallback works' }], source: undefined }],
      }))
      expect(fakeProcessStdout.buffer).toContain('fallback works')
      await mounted.dispose()
    } finally {
      stdoutSpy.mockRestore()
      stdinSpy.mockRestore()
    }
  })
})
