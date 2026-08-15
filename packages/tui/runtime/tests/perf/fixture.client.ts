/**
 * Corpus fixture cache for the terminal performance gate: generates the
 * synthetic long-session corpus once ({@link module:corpus}) and reuses the
 * same file across benchmark shards and repeated runs.
 *
 * The corpus is ~20 MB of JSONL at the 100k-event target, so it is a
 * *generated, cached* fixture rather than a committed one: the committed
 * artifacts are the generator plus the manifest's expected SHA-256, and
 * `corpus-generation.perf.client.ts` proves the bytes reproduce. The cache
 * lives under `node_modules/.cache/` — already ignored by git and already the
 * conventional home for regenerable build state — so no `.gitignore` entry is
 * needed. `DSH_TUI_PERF_CORPUS_DIR` overrides the location.
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/fixture
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateCorpus, type CorpusStats } from './corpus.client.ts'

/** Repository root, for locating the default cache directory from any temp-world test. */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

/**
 * PRNG seed for the shipped corpus. Fixed, not configurable: the gate
 * compares runs against each other and against the historical 196k-event
 * session, so a varying corpus would make every comparison meaningless.
 */
export const CORPUS_SEED = 20_260_815

/**
 * Event-count target for the shipped corpus — the Agent Note's acceptance
 * floor ("a scripted long session of at least 100k events"). Generation stops
 * at the first `turn/end` at or past this count, so the realized total is
 * slightly above it.
 */
export const CORPUS_TARGET_EVENTS = 100_000

/**
 * Cache-layout version. Bump when the generator's output changes for a reason
 * other than a seed/target change, so a stale cached corpus is regenerated
 * instead of silently benchmarked.
 */
const CACHE_VERSION = 1

/** The cached corpus plus everything a benchmark needs to describe it. */
export interface CorpusFixture {
  /** Absolute path of the cached JSONL file (placeholders unsubstituted). */
  readonly path: string
  /** The JSONL text, header line first. */
  readonly text: string
  /** SHA-256 of {@link text}, hex — the determinism identity. */
  readonly sha256: string
  /** Shape report (see {@link CorpusStats}). */
  readonly stats: CorpusStats
  /** Whether this call generated the corpus (`false` when it came from the cache). */
  readonly generated: boolean
  /** Wall time spent generating, in milliseconds; `0` for a cache hit. */
  readonly generateMs: number
}

/** On-disk cache manifest, written beside the corpus. */
interface CacheManifest {
  readonly version: number
  readonly seed: number
  readonly targetEvents: number
  readonly sha256: string
  readonly stats: CorpusStats
}

/**
 * Resolve the corpus cache directory.
 * @returns the absolute cache directory (`DSH_TUI_PERF_CORPUS_DIR` when set).
 */
export function corpusCacheDir(): string {
  const override = process.env.DSH_TUI_PERF_CORPUS_DIR
  return override !== undefined && override !== '' ? override : join(REPO_ROOT, 'node_modules/.cache/dsh-tui-perf')
}

/**
 * A stable workspace directory stamped as the corpus session's `cwd`.
 * Deliberately NOT a per-run `mkdtemp`: the JSONL backend derives a session's
 * project directory from the header `cwd`, so a varying cwd would place the
 * same corpus under a different on-disk path on every run and defeat reuse.
 * @returns the absolute workspace path (created by {@link ensureCorpusFixture}).
 */
export function corpusWorkspaceDir(): string {
  return join(corpusCacheDir(), 'workspace')
}

/**
 * Compute the SHA-256 of a corpus text.
 * @param text - the corpus JSONL.
 * @returns lowercase hex digest.
 */
export function corpusDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Return the cached corpus, generating and caching it on first use (or after
 * a seed/target/cache-version change).
 * @param options - optional seed/target override for a determinism probe; defaults to the shipped corpus.
 * @returns the cached corpus fixture.
 */
export async function ensureCorpusFixture(
  options: { readonly seed?: number; readonly targetEvents?: number } = {},
): Promise<CorpusFixture> {
  const seed = options.seed ?? CORPUS_SEED
  const targetEvents = options.targetEvents ?? CORPUS_TARGET_EVENTS
  const dir = corpusCacheDir()
  const path = join(dir, `corpus-${String(seed)}-${String(targetEvents)}.jsonl`)
  const manifestPath = `${path}.manifest.json`

  await mkdir(dir, { recursive: true })
  await mkdir(corpusWorkspaceDir(), { recursive: true })

  const cached = await readCache(path, manifestPath, seed, targetEvents)
  if (cached !== undefined) return { ...cached, generated: false, generateMs: 0 }

  const startedAt = performance.now()
  const { text, stats } = generateCorpus({ seed, targetEvents })
  const generateMs = performance.now() - startedAt
  const sha256 = corpusDigest(text)
  await writeFile(path, text)
  const manifest: CacheManifest = { version: CACHE_VERSION, seed, targetEvents, sha256, stats }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { path, text, sha256, stats, generated: true, generateMs }
}

/**
 * Read a cached corpus when its manifest still matches the requested inputs
 * and its bytes still hash to the recorded digest.
 * @param path - corpus file path.
 * @param manifestPath - manifest file path.
 * @param seed - requested seed.
 * @param targetEvents - requested event target.
 * @returns the cached corpus, or `undefined` when the cache is absent or stale.
 */
async function readCache(
  path: string,
  manifestPath: string,
  seed: number,
  targetEvents: number,
): Promise<{ path: string; text: string; sha256: string; stats: CorpusStats } | undefined> {
  let manifest: CacheManifest
  let text: string
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CacheManifest
    text = await readFile(path, 'utf8')
  } catch {
    // Absent or unreadable cache (first run, a pruned node_modules, a partial
    // write from an interrupted run): regenerate rather than fail.
    return undefined
  }
  if (manifest.version !== CACHE_VERSION || manifest.seed !== seed || manifest.targetEvents !== targetEvents) return undefined
  const sha256 = corpusDigest(text)
  if (sha256 !== manifest.sha256) return undefined
  return { path, text, sha256, stats: manifest.stats }
}
