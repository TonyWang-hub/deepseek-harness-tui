/**
 * The resumed-long-session scenario every benchmark shard measures: a cold
 * JSONL session holding the ≥100k-event synthetic corpus, resumed by a real
 * dual-context Host+Client tree with the Ink renderer mounted on controlled
 * TTY streams.
 *
 * The seeded persistence root is cached beside the corpus, because
 * materializing 100k events through the real backend costs far more than
 * every measurement that follows and is identical for every shard. Each shard
 * still resumes from its own *copy* of that root, so a repair or a live
 * append inside one run can never change what the next run resumes.
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/scenario
 */

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationSnapshot, ISessions, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import { mountTuiRenderer, type MountedTuiRenderer } from '@deepseek-ai/dsh-tui-ink-ui'
import { bootHostTree, type ComposedTree } from '../compose.client.ts'
import { corpusCacheDir, corpusWorkspaceDir, ensureCorpusFixture, type CorpusFixture } from './fixture.client.ts'
import {
  createPerfStdin,
  createPerfStdout,
  seedCorpusSession,
  stripAnsi,
  waitUntil,
  type PerfReadStream,
  type PerfWriteStream,
} from './harness.client.ts'

/** The corpus session's id — fixed, so the cached seeded root is addressable across runs. */
export const PERF_SESSION_ID = 'dsh-tui-perf-long-session'

/** Terminal geometry every shard renders at. */
export const PERF_COLUMNS = 120
/** Terminal height every shard renders at. */
export const PERF_ROWS = 40

/** Bound on waiting for the client tree's connection and session list. */
const CONNECT_TIMEOUT_MS = 60_000
/** Bound on waiting for the resumed session's first history page. */
const HISTORY_TIMEOUT_MS = 180_000

/** A seeded persistence root plus the corpus that produced it. */
export interface SeededCorpusRoot {
  /** Absolute path of the cached, seeded JSONL persistence root. */
  readonly root: string
  /** The corpus fixture this root was seeded from. */
  readonly fixture: CorpusFixture
  /** Whether this call seeded the root (`false` when it came from the cache). */
  readonly seeded: boolean
  /** Wall time spent seeding, in milliseconds; `0` for a cache hit. */
  readonly seedMs: number
}

/**
 * Return the cached persistence root holding the corpus as one cold session,
 * seeding it on first use (or after the corpus digest changes).
 * @returns the seeded root (see {@link SeededCorpusRoot}).
 */
export async function ensureSeededRoot(): Promise<SeededCorpusRoot> {
  const fixture = await ensureCorpusFixture()
  const root = join(corpusCacheDir(), `persistence-${fixture.sha256.slice(0, 16)}`)
  const stampPath = join(corpusCacheDir(), `persistence-${fixture.sha256.slice(0, 16)}.stamp`)
  const stamp = await readFile(stampPath, 'utf8').catch(() => undefined)
  if (stamp === fixture.sha256) return { root, fixture, seeded: false, seedMs: 0 }

  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  const startedAt = performance.now()
  const tree = await bootHostTree({ persistenceRoot: root })
  try {
    await seedCorpusSession(tree.ctx, fixture.text, PERF_SESSION_ID, corpusWorkspaceDir())
  } finally {
    await tree.dispose()
  }
  const seedMs = performance.now() - startedAt
  await writeFile(stampPath, fixture.sha256)
  return { root, fixture, seeded: true, seedMs }
}

/**
 * Copy the cached seeded root into a fresh temp root this run owns.
 * @param seeded - the cached seeded root.
 * @returns the temp root path and its remover.
 */
export async function checkoutSeededRoot(seeded: SeededCorpusRoot): Promise<{ root: string; remove: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-perf-sessions-'))
  await cp(seeded.root, root, { recursive: true })
  return { root, remove: () => rm(root, { recursive: true, force: true }) }
}

/** Per-phase wall times of one cold start, in milliseconds. */
export interface ColdStartTimings {
  /** Host tree booted through the real Loader (no listening socket). */
  readonly hostBootMs: number
  /** Client tree's connection reported a host description (the in-process SSE stream is live). */
  readonly connectedMs: number
  /** The cold corpus session appeared in the client's `sessions.list`. */
  readonly sessionListedMs: number
  /** `mountTuiRenderer` resolved (Ink mounted, session face open). */
  readonly rendererMountedMs: number
  /** The composer prompt first reached the controlled stdout — "prompt-ready". */
  readonly promptReadyMs: number
  /** The resumed session's first history page landed (`openState === 'open'`). */
  readonly historyOpenMs: number
}

/** One resumed terminal application, ready to measure. */
export interface ResumedTui {
  /** The booted Host tree. */
  readonly tree: ComposedTree
  /** The bootstrapped Client tree. */
  readonly clientCtx: Context
  /** The resumed session's client-side face. */
  readonly face: SessionFace
  /** The mounted renderer. */
  readonly renderer: MountedTuiRenderer
  /** The controlled output stream the renderer writes to. */
  readonly stdout: PerfWriteStream
  /** The controlled input stream keystrokes are fed into. */
  readonly stdin: PerfReadStream
  /** Cold-start phase timings, measured from the first line of {@link resumeTui}. */
  readonly timings: ColdStartTimings
  /** Tear down the renderer and the tree. */
  dispose(): Promise<void>
}

/**
 * Boot the dual-context tree over a seeded persistence root and mount the Ink
 * renderer on the resumed corpus session, timing every cold-start phase.
 * @param root - a persistence root holding the corpus session (see {@link checkoutSeededRoot}).
 * @param options - `waitForHistory: false` returns as soon as the composer is ready, for a shard that measures the load itself.
 * @returns the resumed application (see {@link ResumedTui}).
 */
export async function resumeTui(
  root: string,
  options: { readonly waitForHistory?: boolean } = {},
): Promise<ResumedTui> {
  const startedAt = performance.now()
  const since = (): number => performance.now() - startedAt

  const tree = await bootHostTree({ persistenceRoot: root })
  const hostBootMs = since()
  let renderer: MountedTuiRenderer | undefined
  const stdout = createPerfStdout(PERF_COLUMNS, PERF_ROWS)
  const stdin = createPerfStdin()
  try {
    const clientCtx = tree.ctx.tuiRuntime.clientCtx
    const connection = clientCtx.get('connection') as ConnectionHandle
    await waitUntil(() => connection.hostDescription.getSnapshot() !== undefined, {
      timeoutMs: CONNECT_TIMEOUT_MS,
      label: 'client connection host description',
    })
    const connectedMs = since()

    const sessions = clientCtx.get('sessions') as ISessions
    await waitUntil(() => sessions.list.getSnapshot().ids.includes(PERF_SESSION_ID as SessionId), {
      timeoutMs: CONNECT_TIMEOUT_MS,
      label: `cold session ${PERF_SESSION_ID} in sessions.list`,
    })
    const sessionListedMs = since()

    renderer = await mountTuiRenderer(clientCtx, {
      sessionId: PERF_SESSION_ID as SessionId,
      stdin,
      stdout,
      stderr: stdout as unknown as NodeJS.WriteStream,
    })
    const rendererMountedMs = since()

    // "Prompt-ready" is the composer's first-line prefix reaching the
    // terminal: the moment a user can type, which is what the Agent Note's
    // cold/warm prompt-ready budget is about.
    await waitUntil(() => stdout.buffer.includes('❯'), {
      timeoutMs: CONNECT_TIMEOUT_MS,
      label: 'composer prompt on stdout',
    })
    const promptReadyMs = since()

    const scope = sessions.scope(PERF_SESSION_ID as SessionId)
    if (scope === undefined) throw new Error('resumeTui: sessions.scope() is undefined after mount')
    const face = sessions.sessionOf(scope)
    if (face === undefined) throw new Error('resumeTui: sessions.sessionOf() is undefined after mount')

    let historyOpenMs = Number.NaN
    if (options.waitForHistory !== false) {
      await waitUntil(() => face.getSnapshot().openState === 'open', {
        timeoutMs: HISTORY_TIMEOUT_MS,
        intervalMs: 20,
        label: `resumed session openState (last seen: ${face.getSnapshot().openState})`,
      })
      historyOpenMs = since()
    }

    const mounted = renderer
    return {
      tree,
      clientCtx,
      face,
      renderer: mounted,
      stdout,
      stdin,
      timings: { hostBootMs, connectedMs, sessionListedMs, rendererMountedMs, promptReadyMs, historyOpenMs },
      dispose: async (): Promise<void> => {
        await mounted.dispose()
        await tree.dispose()
      },
    }
  } catch (error) {
    await renderer?.dispose()
    await tree.dispose()
    throw error
  }
}

/**
 * Boot the same composition over an EMPTY persistence root and mount the
 * renderer on a freshly created session — the control for prompt-ready.
 *
 * Without it, a cold prompt-ready number cannot be attributed: the dual-context
 * composition itself (the Loader resolving ~100 rows, the client tree, Ink's
 * first mount) costs the same whether the session holds 100k events or none,
 * and only the difference between this control and {@link resumeTui}'s cold
 * number is the corpus's contribution.
 * @returns the mounted application and its cold-start timings.
 */
export async function freshTui(): Promise<ResumedTui> {
  const startedAt = performance.now()
  const since = (): number => performance.now() - startedAt

  const tree = await bootHostTree()
  const hostBootMs = since()
  let renderer: MountedTuiRenderer | undefined
  const stdout = createPerfStdout(PERF_COLUMNS, PERF_ROWS)
  const stdin = createPerfStdin()
  try {
    const clientCtx = tree.ctx.tuiRuntime.clientCtx
    const connection = clientCtx.get('connection') as ConnectionHandle
    await waitUntil(() => connection.hostDescription.getSnapshot() !== undefined, {
      timeoutMs: CONNECT_TIMEOUT_MS,
      label: 'client connection host description',
    })
    const connectedMs = since()

    renderer = await mountTuiRenderer(clientCtx, {
      stdin,
      stdout,
      stderr: stdout as unknown as NodeJS.WriteStream,
    })
    const rendererMountedMs = since()
    await waitUntil(() => stdout.buffer.includes('❯'), {
      timeoutMs: CONNECT_TIMEOUT_MS,
      label: 'composer prompt on stdout',
    })
    const promptReadyMs = since()

    const sessions = clientCtx.get('sessions') as ISessions
    const scope = sessions.scope(renderer.sessionId)
    if (scope === undefined) throw new Error('freshTui: sessions.scope() is undefined after mount')
    const face = sessions.sessionOf(scope)
    if (face === undefined) throw new Error('freshTui: sessions.sessionOf() is undefined after mount')

    const mounted = renderer
    return {
      tree,
      clientCtx,
      face,
      renderer: mounted,
      stdout,
      stdin,
      timings: {
        hostBootMs,
        connectedMs,
        sessionListedMs: connectedMs,
        rendererMountedMs,
        promptReadyMs,
        historyOpenMs: promptReadyMs,
      },
      dispose: async (): Promise<void> => {
        await mounted.dispose()
        await tree.dispose()
      },
    }
  } catch (error) {
    await renderer?.dispose()
    await tree.dispose()
    throw error
  }
}

/**
 * Count the ANSI-stripped, non-empty lines of the renderer's current live
 * region — the direct proxy for "the Ink tree holds only a bounded live
 * region" (the Agent Note's `Static`-free rendering decision). Ink repaints
 * the whole live region on every frame, so the last frame's line count IS the
 * Ink tree's rendered height.
 * @param stdout - the controlled output stream.
 * @returns the number of non-empty lines in the most recent frame.
 */
export function liveRegionLineCount(stdout: PerfWriteStream): number {
  return stripAnsi(stdout.lastFrame)
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '').length
}

/**
 * Read the client-side retained-state counters the public
 * `ConversationSnapshot` exposes.
 * @param snapshot - the resumed session's snapshot.
 * @returns the counters, ready to report.
 */
export function retainedState(snapshot: ConversationSnapshot): Readonly<Record<string, string | number>> {
  return {
    openState: snapshot.openState,
    nodes: snapshot.nodes.length,
    chatOrder: snapshot.chat.order.length,
    chatNodes: snapshot.chat.nodes.values().length,
    turnEnds: snapshot.turnEnds.size,
    turnTimings: snapshot.turnTimings.size,
    timelineTurns: snapshot.chat.timeline.turns.size,
    runningCalls: snapshot.runningCalls.length,
    pending: snapshot.pending.length,
    queue: snapshot.queue.length,
    hasMore: String(snapshot.hasMore),
    retainedWindowEvents: retainedWindowEvents(snapshot),
  }
}

/**
 * The number of raw session events the client retains for one open session.
 *
 * `ConversationSnapshot.views` is at runtime the `ConversationNodeAssembler`
 * instance, whose `inputs` map holds one entry per raw window event keyed by
 * seq — a 1:1 mirror of the client `Session`'s private event window. There is
 * no public accessor for this count (the client runtime exposes only folded
 * node counts), and the retained-event ceiling is exactly what the Agent
 * Note's steady-state criterion is about, so this gate reads the private map
 * through a documented structural cast rather than reporting a proxy it would
 * then have to caveat.
 * @param snapshot - the resumed session's snapshot.
 * @returns the retained raw-event count, or `-1` when the internal shape no longer matches.
 */
function retainedWindowEvents(snapshot: ConversationSnapshot): number {
  const assembler = snapshot.views as unknown as { inputs?: { size?: unknown } }
  return typeof assembler.inputs?.size === 'number' ? assembler.inputs.size : -1
}
