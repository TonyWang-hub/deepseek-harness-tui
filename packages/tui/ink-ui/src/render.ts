/**
 * `mountTuiRenderer`: the terminal renderer's entry point. Mounts an Ink
 * application over one session's `SessionFace` (creating a fresh session
 * when the caller does not name one), subscribes to its conversation
 * snapshot, and drives three things per the D2.2 brief:
 *
 * 1. **Commit**: every settled node beyond the last committed one is
 *    rendered ({@link module:transcript/node-lines}) and pushed to
 *    scrollback ({@link module:scrollback/commit}), through a width-keyed
 *    cache ({@link module:transcript/row-cache}) — then never re-entered
 *    into the Ink tree (the "Ink tree zero history" acceptance criterion).
 * 2. **Publish**: a session-snapshot change is classified
 *    ({@link module:scheduler/classify-update}) and handed to a
 *    {@link PublicationScheduler}, which paces `'stream'` repaints at the
 *    configured rate and publishes `'structural'` ones immediately.
 * 3. **Control**: Esc cancels the running turn (`SessionFace.cancel()`);
 *    Enter submits the composer (`SessionFace.prompt()`); Ctrl-C and every
 *    other exit path restore the terminal through Ink's own lifecycle (the
 *    Q3 reconnaissance finding) — this module does not call `process.exit()`
 *    itself, so process ownership stays with the caller (a later `dsh
 *    --profile tui` bundle, or a dev/test driver).
 *
 * Known MVP limitation: nodes that already exist in the session's snapshot
 * at mount time are treated as the committed baseline and are NOT replayed
 * into scrollback — resume/backfill is separate landing-order work the
 * official-terminal-application Agent Note's "Rendering" section describes
 * (tail rebase); this renderer targets a freshly opened session first.
 * @module @deepseek-ai/dsh-tui-ink-ui/render
 */

import React from 'react'
import { render as inkRender, type RenderOptions } from 'ink'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationSnapshot, ISessions, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveRendererConfig, type RendererConfig } from './config.ts'
import { classifySnapshotUpdate } from './scheduler/classify-update.ts'
import { createPublicationScheduler, type PublicationSchedulerClock } from './scheduler/publication-scheduler.ts'
import { buildActivityModel } from './activity/activity-model.ts'
import { renderClosedNodeLines } from './transcript/node-lines.ts'
import { createRowCache } from './transcript/row-cache.ts'
import { commitToScrollback } from './scrollback/commit.ts'
import { App } from './components/App.tsx'

/** Options accepted by {@link mountTuiRenderer}. */
export interface MountOptions {
  /** Existing session to open; a fresh session is created via `connection.api.sessions.create({})` when omitted. */
  readonly sessionId?: SessionId
  /** Validated renderer tunables (publish rate); schemastery-defaulted when omitted. */
  readonly config?: RendererConfig
  /** Input stream override (tests only; defaults to `process.stdin`). */
  readonly stdin?: NodeJS.ReadStream
  /** Output stream override (tests only; defaults to `process.stdout`). */
  readonly stdout?: NodeJS.WriteStream
  /** Error stream override (tests only; defaults to `process.stderr`). */
  readonly stderr?: NodeJS.WriteStream
  /**
   * Publication scheduler timer/clock override (tests only; defaults to real
   * `setTimeout`/`Date.now`). A real frame-rate-coalesced repaint genuinely
   * depends on wall-clock pacing, which a shared CI runner cannot guarantee
   * within a fixed real-time budget; a manual clock lets a test drive the
   * scheduler's frame boundary deterministically (`schedule()` then advance
   * and fire the clock) instead of racing a real `setTimeout` — see
   * {@link PublicationSchedulerClock}.
   */
  readonly schedulerClock?: PublicationSchedulerClock
}

/** A live mounted renderer. */
export interface MountedTuiRenderer {
  /** The session this renderer is driving. */
  readonly sessionId: SessionId
  /**
   * Resolves once the Ink application itself exits — normal `useApp().exit()`,
   * Ctrl-C, or an uncaught exception unwinding through it (the three Q3
   * paths). Does not resolve from a caller-driven {@link dispose}; a caller
   * that wants to own the process (exit it, or tear down the whole Client
   * tree) awaits this and decides — this module never calls `process.exit()`
   * itself.
   */
  waitUntilExit(): Promise<void>
  /**
   * Tear down this renderer: stop the snapshot subscription and publication
   * scheduler, then unmount Ink (restoring the terminal, the same lifecycle
   * {@link waitUntilExit} observes). Idempotent — a second call, or one
   * after Ink already exited on its own, is a no-op.
   */
  dispose(): Promise<void>
  /**
   * Await Ink's own render flush (tests only). Firing a `schedulerClock`
   * tick only runs `publish()`'s synchronous `instance.rerender()` call — it
   * does not wait for `ActivityRegion`'s own passive-effect re-measurement or
   * Ink's internal write throttle, both genuine asynchronous work
   * independent of the publication scheduler's own pacing. Delegates to the
   * mounted Ink instance's `waitUntilRenderFlush()`, the exact boundary
   * `tests/support/headless-terminal.ts`'s `settle()` already uses for the
   * snapshot lane.
   */
  waitForRenderFlush(): Promise<void>
}

async function createSession(clientCtx: Context): Promise<SessionId> {
  const connection = clientCtx.get('connection') as ConnectionHandle
  const created = await connection.api.sessions.create({})
  if (!created.result.ok) throw new Error(`mountTuiRenderer: session.create failed: ${created.result.error.code}`)
  return created.result.value.sessionId
}

/**
 * Wait until `sessionId` appears in `sessions.list` — `ISessions.open()`
 * throws `unknown session` otherwise. The client-side list populates from a
 * `host/session-added` event delivered asynchronously over the same
 * connection `session.create`'s RPC response arrived on, so a session can be
 * durably created host-side an instant before the client's own list reflects
 * it; this closes that window instead of racing it.
 * @param sessions - the client tree's sessions service.
 * @param sessionId - the session to wait for.
 * @param timeoutMs - bound on the wait (see {@link RendererConfig.sessionListTimeoutMs}).
 * @returns once `sessionId` is present in the list.
 */
function waitForSessionListed(sessions: ISessions, sessionId: SessionId, timeoutMs: number): Promise<void> {
  if (sessions.list.getSnapshot().ids.includes(sessionId)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`mountTuiRenderer: session ${sessionId} did not appear in sessions.list within ${timeoutMs}ms`))
    }, timeoutMs)
    const unsubscribe = sessions.list.subscribe(() => {
      if (!sessions.list.getSnapshot().ids.includes(sessionId)) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}

/**
 * Resolve the `SessionFace` for a session id, opening it in the sessions
 * domain first (mirrors `cordis-yml-file-boot.client.spec.ts`'s own
 * `open()`/`scope()`/`sessionOf()` sequence).
 * @param sessions - the client tree's sessions service.
 * @param sessionId - the session to open.
 * @returns the opened session's face.
 */
function openSessionFace(sessions: ISessions, sessionId: SessionId): SessionFace {
  sessions.open(sessionId)
  const scope = sessions.scope(sessionId)
  if (scope === undefined) throw new Error(`mountTuiRenderer: session ${sessionId} could not be opened`)
  const face = sessions.sessionOf(scope)
  if (face === undefined) throw new Error(`mountTuiRenderer: session ${sessionId} has no session face`)
  return face
}

/**
 * Mount the terminal renderer over the client tree's data layer.
 * @param clientCtx - the bootstrapped Client-tree Context (`ctx.tuiRuntime.clientCtx`).
 * @param options - see {@link MountOptions}.
 * @returns the mounted renderer handle.
 */
export async function mountTuiRenderer(clientCtx: Context, options: MountOptions = {}): Promise<MountedTuiRenderer> {
  const resolvedConfig = resolveRendererConfig(options.config)
  const sessions = clientCtx.get('sessions') as ISessions
  const sessionId = options.sessionId ?? await createSession(clientCtx)
  await waitForSessionListed(sessions, sessionId, resolvedConfig.sessionListTimeoutMs)
  const face = openSessionFace(sessions, sessionId)

  const outputStream = options.stdout ?? process.stdout
  const rowCache = createRowCache()
  // Baseline: nodes already present at mount are not replayed (see the module doc).
  let committedNodeCount = face.getSnapshot().nodes.length

  function commitNewClosedNodes(snapshot: ConversationSnapshot): void {
    const width = outputStream.columns > 0 ? outputStream.columns : 80
    for (let index = committedNodeCount; index < snapshot.nodes.length; index++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index is within [committedNodeCount, snapshot.nodes.length)
      const node = snapshot.nodes[index]!
      const cacheKey = `${node.kind}:${node.seq}`
      // A cache HIT never occurs along this commit-once loop: `committedNodeCount`
      // guarantees every node index is visited exactly once per mount, so
      // `rowCache.get()` here is always a miss within one mountTuiRenderer
      // lifetime. The cache is still populated (`rowCache.set()` below) for a
      // future consumer that re-renders an already-committed node at a
      // possibly different width — the `/history` alternate-screen pager the
      // official-terminal-application Agent Note's "Rendering" section
      // describes, not yet built. `row-cache.spec.ts` covers the cache's own
      // hit/miss/eviction behavior directly.
      let lines = rowCache.get(cacheKey, width)
      /* v8 ignore next -- see the comment above: the miss branch always executes; a hit is unreachable until a re-render consumer exists */
      if (lines === undefined) {
        lines = renderClosedNodeLines(node)
        rowCache.set(cacheKey, width, lines)
      }
      commitToScrollback(lines)
    }
    committedNodeCount = snapshot.nodes.length
  }

  function handleSubmit(text: string): void {
    face.prompt([{ type: 'text', text }], 'queue').catch((error: unknown) => {
      console.error('mountTuiRenderer: prompt() failed', error)
    })
  }

  function handleCancel(): void {
    face.cancel().catch((error: unknown) => {
      console.error('mountTuiRenderer: cancel() failed', error)
    })
  }

  function currentElement(): React.ReactElement {
    const rows = outputStream.rows > 0 ? outputStream.rows : 24
    return React.createElement(App, {
      activity: buildActivityModel(face.getSnapshot(), rows),
      onSubmit: handleSubmit,
      onCancel: handleCancel,
    })
  }

  function publish(): void {
    commitNewClosedNodes(face.getSnapshot())
    instance.rerender(currentElement())
  }

  const scheduler = createPublicationScheduler(publish, resolvedConfig, options.schedulerClock)
  let previousClassificationSnapshot: ConversationSnapshot = face.getSnapshot()
  const unsubscribe = face.subscribe(() => {
    const next = face.getSnapshot()
    const reason = classifySnapshotUpdate(previousClassificationSnapshot, next)
    previousClassificationSnapshot = next
    scheduler.schedule(reason)
  })

  // Built conditionally rather than `{ stdin: options.stdin, ... }`:
  // `exactOptionalPropertyTypes` treats an explicit `undefined` value as
  // distinct from an omitted key, and `RenderOptions`'s fields are typed as
  // plain `NodeJS.WriteStream`/`ReadStream` (optional key, not `| undefined`),
  // so passing the key at all with an `undefined` value is a type error —
  // only a caller-supplied override actually sets the key.
  const renderOptions: RenderOptions = {}
  if (options.stdin !== undefined) renderOptions.stdin = options.stdin
  if (options.stdout !== undefined) renderOptions.stdout = options.stdout
  if (options.stderr !== undefined) renderOptions.stderr = options.stderr
  // TTY presence decides interactivity, overriding Ink's `is-in-ci` default:
  // non-interactive Ink writes only the final frame at unmount, which would
  // blank the live region for a real terminal session that merely has a CI
  // environment variable set (and for the test streams, whose fake TTYs are
  // exactly the surface under test). A non-TTY stdout leaves `isTTY`
  // undefined at runtime, handing the decision back to Ink's own detection,
  // which is already non-interactive without a TTY.
  renderOptions.interactive = (options.stdout ?? process.stdout).isTTY
  const instance = inkRender(currentElement(), renderOptions)

  let disposed = false
  async function dispose(): Promise<void> {
    if (disposed) return
    disposed = true
    unsubscribe()
    scheduler.dispose()
    instance.unmount()
    // waitUntilExit() rejects only when the app exited via exit(error) — Ink
    // has no render-error-to-exit(error) path of its own (a render exception
    // is an uncaught exception, not a controlled exit), so reaching this
    // catch requires a caller's OWN code to call useApp().exit(someError)
    // explicitly; this renderer's own App never does. This teardown path
    // only needs the unmount to have completed, not to relay that rejection
    // a second time (waitUntilExit() below still surfaces it to a caller
    // that awaits it directly).
    /* v8 ignore next -- see the comment above */
    await instance.waitUntilExit().catch(() => {})
  }

  // Ink can exit on its own (Ctrl-C, useApp().exit(), an uncaught exception
  // unwinding through signal-exit — the three Q3 paths) without this
  // module's dispose() ever being called; this stops the subscription and
  // scheduler in that case too, so a caller who only awaits waitUntilExit()
  // (never calling dispose()) still leaves no dangling work behind.
  // See dispose()'s identical catch above for why this one is unreachable too.
  /* v8 ignore next -- see the comment above */
  void instance.waitUntilExit().catch(() => {}).then(() => { void dispose() })

  return {
    sessionId,
    // Ink's own `waitUntilExit()` resolves with whatever value `exit(value)`
    // passed (typed `Promise<unknown>`); this handle's own contract is "the
    // app exited", not that value, so it is discarded here.
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
    dispose,
    waitForRenderFlush: () => instance.waitUntilRenderFlush(),
  }
}
