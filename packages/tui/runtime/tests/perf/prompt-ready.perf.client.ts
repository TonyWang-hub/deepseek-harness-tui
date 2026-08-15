/**
 * Performance-gate shard 2 — cold prompt-ready and resume load.
 *
 * Measures the Agent Note's "cold and warm prompt-ready within stated
 * budgets" criterion on the ≥100k-event corpus: how long from process-local
 * cold start until a user can type into the composer, and separately until
 * the resumed session's history page has landed. The two are reported apart
 * because the renderer deliberately does not block the composer on history —
 * conflating them would hide which half a regression landed in.
 *
 * "Warm" here is a second resume inside the same process over the same
 * on-disk root: the OS page cache and the V8 code cache are hot, the host's
 * own per-session caches are not (the first tree is disposed).
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/prompt-ready
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkoutSeededRoot, ensureSeededRoot, freshTui, resumeTui, retainedState, type SeededCorpusRoot } from './scenario.client.ts'
import { reportFacts, reportMetrics, type MetricRow } from './harness.client.ts'

describe('terminal prompt-ready over a ≥100k-event resumed session', () => {
  let seeded: SeededCorpusRoot
  const cleanups: (() => Promise<void>)[] = []

  beforeAll(async () => {
    seeded = await ensureSeededRoot()
  }, 600_000)

  afterAll(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
  })

  it('reports cold and warm prompt-ready plus the resume load', async () => {
    // Measurement order is load-bearing and is the cold number's definition:
    // the FIRST boot in this process pays the module graph, tsx transforms,
    // and JIT warm-up that no later boot repeats. Cold resume therefore runs
    // first, warm resume second, and the empty-root control LAST — so the
    // control is comparable to the warm number, and the derived
    // corpus-attributable cost below subtracts two equally warm runs.
    const cold = await checkoutSeededRoot(seeded)
    cleanups.push(() => cold.remove())
    const first = await resumeTui(cold.root)
    cleanups.push(() => first.dispose())
    const coldTimings = first.timings
    const coldRetained = retainedState(first.face.getSnapshot())
    await first.dispose()
    cleanups.pop()

    const warm = await checkoutSeededRoot(seeded)
    cleanups.push(() => warm.remove())
    const second = await resumeTui(warm.root)
    cleanups.push(() => second.dispose())
    const warmTimings = second.timings
    await second.dispose()
    cleanups.pop()

    const control = await freshTui()
    cleanups.push(() => control.dispose())
    const controlTimings = control.timings

    reportFacts('Corpus under test', {
      events: seeded.fixture.stats.events,
      turns: seeded.fixture.stats.turns,
      toolCalls: seeded.fixture.stats.toolCalls,
      megabytes: (seeded.fixture.stats.bytes / 1024 / 1024).toFixed(1),
      seedMs: seeded.seedMs.toFixed(0),
      seededThisRun: String(seeded.seeded),
    })
    reportFacts('Cold-start phase breakdown (ms, cumulative from boot)', {
      hostBoot: coldTimings.hostBootMs.toFixed(0),
      clientConnected: coldTimings.connectedMs.toFixed(0),
      coldSessionListed: coldTimings.sessionListedMs.toFixed(0),
      rendererMounted: coldTimings.rendererMountedMs.toFixed(0),
      promptReady: coldTimings.promptReadyMs.toFixed(0),
      historyOpen: coldTimings.historyOpenMs.toFixed(0),
    })
    reportFacts('Client retained state after cold resume', coldRetained)

    reportFacts('Control: fresh session on an empty root, run warm and last (ms, cumulative from boot)', {
      hostBoot: controlTimings.hostBootMs.toFixed(0),
      clientConnected: controlTimings.connectedMs.toFixed(0),
      rendererMounted: controlTimings.rendererMountedMs.toFixed(0),
      promptReady: controlTimings.promptReadyMs.toFixed(0),
    })

    const rows: MetricRow[] = [
      {
        metric: 'prompt-ready (fresh session control, warm process)',
        measured: `${controlTimings.promptReadyMs.toFixed(0)} ms`,
        threshold: 'control, not a budget',
        verdict: 'REPORT',
      },
      {
        metric: 'prompt-ready (cold)',
        measured: `${coldTimings.promptReadyMs.toFixed(0)} ms`,
        threshold: 'Note states no number (historical reference: 12.2 s → 7.2 s at 196k events)',
        verdict: 'REPORT',
      },
      {
        metric: 'prompt-ready (warm)',
        measured: `${warmTimings.promptReadyMs.toFixed(0)} ms`,
        threshold: 'Note states no number',
        verdict: 'REPORT',
      },
      {
        metric: 'resume history page open (cold)',
        measured: `${coldTimings.historyOpenMs.toFixed(0)} ms`,
        threshold: 'Note states no number',
        verdict: 'REPORT',
      },
      {
        metric: 'resume history page open (warm)',
        measured: `${warmTimings.historyOpenMs.toFixed(0)} ms`,
        threshold: 'Note states no number',
        verdict: 'REPORT',
      },
      {
        metric: 'corpus attributable cost (warm history-open − warm control prompt-ready)',
        measured: `${(warmTimings.historyOpenMs - controlTimings.promptReadyMs).toFixed(0)} ms`,
        threshold: 'derived, not a budget',
        verdict: 'REPORT',
      },
    ]
    reportMetrics('Prompt-ready', rows)

    // Structural, not timing: the gate must keep measuring a real resume of a
    // real corpus. Host speed is not a correctness contract, so no wall-clock
    // assertion lives here — the numbers above are the deliverable.
    expect(coldTimings.promptReadyMs).toBeGreaterThan(0)
    expect(coldRetained['openState']).toBe('open')
    expect(Number(coldRetained['nodes'])).toBeGreaterThan(0)
  }, 900_000)
})
