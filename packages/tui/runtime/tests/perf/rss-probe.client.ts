/**
 * Resident-memory probe, run as a child process by
 * `resident-state.perf.client.ts`.
 *
 * RSS is a process-global number that never shrinks back after a large
 * transient allocation, so the renderer's memory cost cannot be measured by
 * taking two readings inside one process. This probe therefore measures ONE
 * composition per process and prints it, and the parent runs it twice:
 *
 * - `--mode=headless` — the dual-context tree with NO renderer, resuming the
 *   same corpus session (the Agent Note's "headless baseline").
 * - `--mode=render` — the same tree with `mountTuiRenderer` mounted on
 *   controlled TTY streams.
 *
 * The difference of the two RSS readings is the renderer's steady-state
 * increment. Both processes launch identically (`node --import tsx/esm`), so
 * the runtime, the module graph resolution, and the corpus are shared and
 * cancel out of the delta.
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/rss-probe
 */

import process from 'node:process'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { bootHostTree } from '../compose.client.ts'
import { PROBE_RESULT_MARKER, type ProbeResult } from './probe-protocol.client.ts'
import { waitUntil } from './harness.client.ts'
import { liveRegionLineCount, PERF_SESSION_ID, resumeTui, retainedState } from './scenario.client.ts'

/** Idle window after the resume settles, so deferred work and timers land before the reading. */
const SETTLE_MS = 1_500

/**
 * Force a full GC where the probe was launched with `--expose-gc`, so the
 * reading reflects retained state rather than uncollected garbage. Silently a
 * no-op otherwise; the parent launches with the flag and reports whether it
 * was honored.
 */
function collect(): void {
  const gc = (globalThis as { gc?: () => void }).gc
  if (gc === undefined) return
  gc()
  gc()
}

/**
 * Boot the headless baseline: the dual-context tree with no renderer, with
 * the corpus session opened through the client sessions face.
 * @param root - the persistence root holding the corpus session.
 * @returns the probe result.
 */
async function measureHeadless(root: string): Promise<ProbeResult> {
  const tree = await bootHostTree({ persistenceRoot: root })
  try {
    const clientCtx = tree.ctx.tuiRuntime.clientCtx
    const connection = clientCtx.get('connection') as ConnectionHandle
    await waitUntil(() => connection.hostDescription.getSnapshot() !== undefined, {
      timeoutMs: 60_000,
      label: 'client connection host description',
    })
    const sessions = clientCtx.get('sessions') as ISessions
    await waitUntil(() => sessions.list.getSnapshot().ids.includes(PERF_SESSION_ID as SessionId), {
      timeoutMs: 60_000,
      label: 'cold corpus session in sessions.list',
    })
    sessions.open(PERF_SESSION_ID as SessionId)
    const scope = sessions.scope(PERF_SESSION_ID as SessionId)
    if (scope === undefined) throw new Error('rss-probe: sessions.scope() is undefined after open()')
    const face = sessions.sessionOf(scope)
    if (face === undefined) throw new Error('rss-probe: sessions.sessionOf() is undefined after open()')
    await waitUntil(() => face.getSnapshot().openState === 'open', {
      timeoutMs: 180_000,
      intervalMs: 20,
      label: 'headless resumed session openState',
    })
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
    collect()
    const memory = process.memoryUsage()
    return {
      mode: 'headless',
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      external: memory.external,
      retained: retainedState(face.getSnapshot()),
      liveRegionLines: -1,
    }
  } finally {
    await tree.dispose()
  }
}

/**
 * Boot the rendering composition: the same tree with the Ink renderer mounted.
 * @param root - the persistence root holding the corpus session.
 * @returns the probe result.
 */
async function measureRender(root: string): Promise<ProbeResult> {
  const tui = await resumeTui(root)
  try {
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS))
    collect()
    const memory = process.memoryUsage()
    return {
      mode: 'render',
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      external: memory.external,
      retained: retainedState(tui.face.getSnapshot()),
      liveRegionLines: liveRegionLineCount(tui.stdout),
    }
  } finally {
    await tui.dispose()
  }
}

/**
 * Parse one `--key=value` argument out of `process.argv`.
 * @param name - the flag name without dashes.
 * @returns the value.
 */
function requiredArg(name: string): string {
  const prefix = `--${name}=`
  const found = process.argv.find(argument => argument.startsWith(prefix))
  if (found === undefined) throw new Error(`rss-probe: missing --${name}=<value>`)
  return found.slice(prefix.length)
}

const mode = requiredArg('mode')
const rootArg = requiredArg('root')
const result = mode === 'render' ? await measureRender(rootArg) : await measureHeadless(rootArg)
process.stdout.write(`${PROBE_RESULT_MARKER}${JSON.stringify(result)}\n`)
// The client tree's reconnect loop and Ink's own signal handlers can keep the
// event loop alive past a clean dispose; the reading is already printed, so
// this probe exits deliberately rather than waiting for a quiet loop.
process.exit(0)
