import { clientLibrary } from '../../client/tsdown.client.ts'

const id = '@deepseek-ai/dsh-tui-runtime'

/**
 * This package type-checks under the Client aggregate (`tsconfig.json`
 * extends `tsconfig.base.client.json` — see `src/index.ts`'s module doc for
 * why), so its `lib/types/*.js` entries exist only once the Client-face tsc
 * pass (`tsc -b tsconfig.client.json`) has run, never the Host-face pass. The
 * root workspace tsdown config's Host-face entry glob
 * (`lib/types/{index,invariant,startup}.js`) would otherwise try to bundle
 * this package during the Host pass, before those files exist, and abort the
 * whole `build:lib:host` run. `clientLibrary` restricts this package's Node
 * library build to the Client pass, matching where its declaration/JS
 * emission actually happens; at runtime it still loads as an ordinary
 * Host-tree plugin (an unrelated concern from which build pass emits its
 * `lib/` output).
 */
export default clientLibrary(id, ['lib/types/index.js', 'lib/types/invariant.js'])
