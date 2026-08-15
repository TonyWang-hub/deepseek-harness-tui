/**
 * Vitest lane for the terminal application's performance gate.
 *
 * Deliberately a package-local config rather than a root one: the default
 * lane's inventory is `packages/*​/*​/tests/**​/*.spec.ts`, which these
 * `*.perf.client.ts` shards are outside by construction, and the gate has no
 * business in `vitest.config.ts`'s coverage program. Run one shard at a time
 * (each boots a real host tree over a ~20 MB corpus):
 *
 * ```sh
 * pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts -t 'corpus'
 * ```
 *
 * `pool: 'forks'` and `fileParallelism: false` for the same reason the root
 * config forks: these shards own process-global state (stdout patching, RSS)
 * and must not share a worker.
 * @module @deepseek-ai/dsh-tui-runtime/tests/perf/vitest.perf.config
 */

import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

export default defineConfig({
  root: REPO_ROOT,
  plugins: [tsconfigPaths({ projects: [`${REPO_ROOT}tsconfig.base.json`] })],
  test: {
    include: ['packages/tui/runtime/tests/perf/**/*.perf.client.ts'],
    pool: 'forks',
    fileParallelism: false,
    // Benchmark tables are the deliverable; vitest's console capture would
    // reorder and truncate them.
    disableConsoleIntercept: true,
    hookTimeout: 240_000,
    testTimeout: 240_000,
  },
})
