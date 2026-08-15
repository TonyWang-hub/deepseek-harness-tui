/**
 * Performance-gate shard 4 — steady-state resident memory and retention.
 *
 * Covers the Agent Note's last two performance criteria on the ≥100k-event
 * corpus: "RSS delta over the headless baseline within a stated cap" and "a
 * steady-state ceiling on retained events and nodes after tail rebase".
 *
 * RSS is measured by two child processes (`rss-probe.client.ts`) rather than
 * two readings in this one, because RSS never returns after a transient
 * allocation — see that module's doc. Retention is read from the render
 * probe's own snapshot plus this shard's in-process resume, and states three
 * separate ceilings: the Ink tree's rendered height (the "zero history"
 * criterion), the client's folded conversation nodes, and the client's
 * retained raw events (the tail window).
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/resident-state
 */

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reportFacts, reportMetrics, type MetricRow } from './harness.client.ts'
import { PROBE_RESULT_MARKER, type ProbeResult } from './probe-protocol.client.ts'
import { checkoutSeededRoot, ensureSeededRoot, type SeededCorpusRoot } from './scenario.client.ts'

const execFileAsync = promisify(execFile)

/** The probe module, launched as a child process (never imported for its side effects). */
const PROBE = fileURLToPath(new URL('./rss-probe.client.ts', import.meta.url))

/** Bound on one probe process; a hung probe fails the shard instead of hanging the run. */
const PROBE_TIMEOUT_MS = 420_000

/** Megabytes, for reporting. */
const MB = 1024 * 1024

/**
 * Run one probe process and parse its result.
 * @param mode - which composition to measure.
 * @param root - the persistence root holding the corpus session.
 * @returns the probe's measurement.
 */
async function runProbe(mode: 'headless' | 'render', root: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx/esm', '--expose-gc', PROBE, `--mode=${mode}`, `--root=${root}`],
    { timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  )
  const line = stdout.split('\n').find(candidate => candidate.startsWith(PROBE_RESULT_MARKER))
  if (line === undefined) throw new Error(`runProbe(${mode}): probe printed no result marker; stdout tail: ${stdout.slice(-2_000)}`)
  return JSON.parse(line.slice(PROBE_RESULT_MARKER.length)) as ProbeResult
}

describe('terminal steady-state RSS and retention over a ≥100k-event resumed session', () => {
  let seeded: SeededCorpusRoot
  const cleanups: (() => Promise<void>)[] = []

  beforeAll(async () => {
    seeded = await ensureSeededRoot()
  }, 600_000)

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
  })

  it('reports the renderer RSS delta over the headless baseline and the retention ceilings', async () => {
    // A separate checkout per probe: neither run may observe the other's
    // repaired or appended log.
    const headlessRoot = await checkoutSeededRoot(seeded)
    cleanups.push(() => headlessRoot.remove())
    const renderRoot = await checkoutSeededRoot(seeded)
    cleanups.push(() => renderRoot.remove())

    const headless = await runProbe('headless', headlessRoot.root)
    const render = await runProbe('render', renderRoot.root)

    const deltaMb = (render.rss - headless.rss) / MB
    const heapDeltaMb = (render.heapUsed - headless.heapUsed) / MB

    reportFacts('Corpus under test', {
      events: seeded.fixture.stats.events,
      turns: seeded.fixture.stats.turns,
      megabytes: (seeded.fixture.stats.bytes / 1024 / 1024).toFixed(1),
    })
    reportFacts('Headless baseline probe (dual context, no renderer)', {
      rssMb: (headless.rss / MB).toFixed(1),
      heapUsedMb: (headless.heapUsed / MB).toFixed(1),
      externalMb: (headless.external / MB).toFixed(1),
      ...headless.retained,
    })
    reportFacts('Rendering probe (same tree, Ink renderer mounted)', {
      rssMb: (render.rss / MB).toFixed(1),
      heapUsedMb: (render.heapUsed / MB).toFixed(1),
      externalMb: (render.external / MB).toFixed(1),
      liveRegionLines: render.liveRegionLines,
      ...render.retained,
    })

    const retainedEvents = Number(render.retained['retainedWindowEvents'])
    const retainedNodes = Number(render.retained['nodes'])
    const rows: MetricRow[] = [
      {
        metric: 'RSS, renderer vs headless baseline',
        measured: `${(render.rss / MB).toFixed(1)} MB vs ${(headless.rss / MB).toFixed(1)} MB (Δ ${deltaMb >= 0 ? '+' : ''}${deltaMb.toFixed(1)} MB)`,
        threshold: 'Note states "within a stated cap" but states no number',
        verdict: 'REPORT',
      },
      {
        metric: 'V8 heap, renderer vs headless baseline',
        measured: `${(render.heapUsed / MB).toFixed(1)} MB vs ${(headless.heapUsed / MB).toFixed(1)} MB (Δ ${heapDeltaMb >= 0 ? '+' : ''}${heapDeltaMb.toFixed(1)} MB)`,
        threshold: 'Note states no number',
        verdict: 'REPORT',
      },
      {
        metric: 'Ink tree height after resume (zero-history criterion)',
        measured: `${String(render.liveRegionLines)} rendered lines`,
        threshold: 'bounded live region only — independent of corpus size',
        verdict: render.liveRegionLines > 0 && render.liveRegionLines <= 40 ? 'PASS' : 'FAIL',
      },
      {
        metric: 'client retained conversation nodes',
        measured: `${String(retainedNodes)} of ${String(seeded.fixture.stats.events)} corpus events`,
        threshold: 'steady-state ceiling; Note states no number',
        verdict: 'REPORT',
      },
      {
        metric: 'client retained raw events (tail window)',
        measured: `${String(retainedEvents)} of ${String(seeded.fixture.stats.events)} corpus events`,
        threshold: 'steady-state ceiling; Note states no number',
        verdict: 'REPORT',
      },
    ]
    reportMetrics('Resident state', rows)

    // Structural: the tail window must actually bound what the client holds,
    // and the Ink tree must hold no history. These are the two claims the
    // rendering design rests on; a number regressing to "the whole corpus"
    // is a design failure, not a slow host.
    expect(render.retained['openState']).toBe('open')
    expect(retainedEvents).toBeGreaterThan(0)
    expect(retainedEvents).toBeLessThan(seeded.fixture.stats.events / 10)
    expect(render.liveRegionLines).toBeGreaterThan(0)
    expect(render.liveRegionLines).toBeLessThanOrEqual(40)
  }, 900_000)
})
