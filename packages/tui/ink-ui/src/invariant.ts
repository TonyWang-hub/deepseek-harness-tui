/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tui-ink-ui`.
 * @module @deepseek-ai/dsh-tui-ink-ui/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui-ink-ui'

/** Cordis companion plugin name. */
export const name = 'tui-ink-ui-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this cut ships no Cordis plugin, service, or mutable
 * cross-plugin state — only the package boundary, its Ink/React dependency
 * island, and reconnaissance PoC scripts under `tests/`. A future renderer
 * cut states its own owned relationships (the live-region tree, the
 * publication scheduler) here once they exist.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
