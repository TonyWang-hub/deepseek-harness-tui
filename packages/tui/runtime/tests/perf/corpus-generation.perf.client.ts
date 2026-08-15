/**
 * Performance-gate shard 1 — corpus generation.
 *
 * Produces (and caches) the synthetic long-session corpus the other shards
 * resume, and pins the two properties the Agent Note's acceptance criterion
 * depends on: the corpus is at least 100k events, and generation is
 * deterministic (two generations with the same seed hash identically), so a
 * regression measured against it is a renderer regression rather than a
 * corpus difference.
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/corpus-generation
 */

import { describe, expect, it } from 'vitest'
import { generateCorpus, parseCorpus, realizeCorpus } from './corpus.client.ts'
import {
  CORPUS_SEED,
  CORPUS_TARGET_EVENTS,
  corpusDigest,
  corpusWorkspaceDir,
  ensureCorpusFixture,
} from './fixture.client.ts'
import { reportFacts } from './harness.client.ts'

describe('terminal performance corpus', () => {
  it('generates a deterministic ≥100k-event corpus and caches it for the benchmark shards', async () => {
    const fixture = await ensureCorpusFixture()

    // Determinism: an independent in-process generation with the same seed
    // must reproduce the cached bytes exactly. This is the "两次生成 hash 一致"
    // check; it also validates a cache hit against the generator, so a stale
    // cache from an older generator can never be benchmarked silently.
    const regenerated = generateCorpus({ seed: CORPUS_SEED, targetEvents: CORPUS_TARGET_EVENTS })
    expect(corpusDigest(regenerated.text)).toBe(fixture.sha256)
    expect(regenerated.stats).toEqual(fixture.stats)

    // A different seed must produce a different corpus — otherwise the seed
    // is not actually threaded through the shape decisions and "deterministic"
    // would mean "constant".
    const other = generateCorpus({ seed: CORPUS_SEED + 1, targetEvents: 5_000 })
    const same = generateCorpus({ seed: CORPUS_SEED, targetEvents: 5_000 })
    expect(corpusDigest(other.text)).not.toBe(corpusDigest(same.text))

    expect(fixture.stats.events).toBeGreaterThanOrEqual(CORPUS_TARGET_EVENTS)

    const realized = realizeCorpus(fixture.text, 'perf-corpus-session', corpusWorkspaceDir())
    expect(realized).not.toContain('{{')
    const { header, events } = parseCorpus(realized)
    expect(header['type']).toBe('session')
    expect(header['id']).toBe('perf-corpus-session')
    expect(events).toHaveLength(fixture.stats.events)
    // Contiguous seq from 0 is the persistence contract every append checks.
    expect(events[0]?.seq).toBe(0)
    expect(events[events.length - 1]?.seq).toBe(events.length - 1)
    expect(events[events.length - 1]?.type).toBe('turn/end')

    reportFacts('Corpus shape', {
      path: fixture.path,
      sha256: fixture.sha256,
      seed: CORPUS_SEED,
      generated: String(fixture.generated),
      generateMs: fixture.generateMs.toFixed(0),
      events: fixture.stats.events,
      turns: fixture.stats.turns,
      steps: fixture.stats.steps,
      toolCalls: fixture.stats.toolCalls,
      questionCalls: fixture.stats.questionCalls,
      approvalPairs: fixture.stats.approvals,
      assistantChunks: fixture.stats.chunks,
      megabytes: (fixture.stats.bytes / 1024 / 1024).toFixed(1),
      byType: JSON.stringify(fixture.stats.byType),
    })
  }, 240_000)
})
