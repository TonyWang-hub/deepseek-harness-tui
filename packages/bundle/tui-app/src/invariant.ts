/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tui-app`.
 * @module @deepseek-ai/dsh-tui-app/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui-app'

/** Cordis companion plugin name. */
export const name = 'tui-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this runner only bridges the mounted terminal
 * application's exit to the launcher's `ctx.appExit`, over the dual-context
 * bootstrap and renderer owned by `@deepseek-ai/dsh-tui-runtime` and
 * `@deepseek-ai/dsh-tui-ink-ui` respectively; its own observable contract
 * (a real terminal exits cleanly, a non-TTY invocation fails loud) is
 * process-level and owned by this package's pty smoke coverage, not a
 * mutable relation to audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
