import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'

const id = '@deepseek-ai/dsh-client-connection'

/**
 * Node ESM publication of the browser client data layer (src/client) for a
 * plain Node consumer — the planned official TUI, imported through
 * `@deepseek-ai/dsh-client-connection/client-node`. Shares the primary Node
 * library build's shape (ESM, platform node, no dts — types ship from the
 * shared lib/types/client/index.d.ts): unlike ./client, this artifact never
 * wraps in `window.__ModuleLoader__.load` and skips the CSS-inlining/purity
 * plugins scoped to the browser loader's frozen module table, since a plain
 * Node process resolves every import through ordinary node_modules
 * resolution instead. Entry is the client-face tsc pass's already-emitted
 * lib/types/client/index.js, not src/client/index.ts, so this companion
 * only runs after that pass, exactly like the client bundle it sits beside.
 */
const clientNodeCompanion: UserConfig = {
  name: `${id}/client-node`,
  entry: { 'client-node': 'lib/types/client/index.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: { entryFileNames: 'client-node.js' },
}

export default clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'], {
  companions: [clientNodeCompanion],
})
