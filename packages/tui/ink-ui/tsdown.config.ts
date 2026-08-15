import { clientLibrary } from '../../client/tsdown.client.ts'

const id = '@deepseek-ai/dsh-tui-ink-ui'

/**
 * This package type-checks under the Client aggregate (`tsconfig.json`
 * extends `tsconfig.base.client.json`, matching every `packages/client/*`
 * peer — see `src/index.ts`'s module doc for why), so its `lib/types/*.js`
 * entries exist only once the Client-face tsc pass (`tsc -b
 * tsconfig.client.json`) has run, never the Host-face pass. `clientLibrary`
 * restricts this package's Node library build to the Client pass, matching
 * where its declaration/JS emission actually happens.
 */
export default clientLibrary(id, ['lib/types/index.js', 'lib/types/invariant.js'])
