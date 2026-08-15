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
 * No runtime invariant: `mountTuiRenderer` is a plain function over a
 * `Context` a caller already owns (`ctx.tuiRuntime.clientCtx`, mounted by
 * `@deepseek-ai/dsh-tui-runtime`) — it registers no Cordis plugin, service,
 * or mutable cross-plugin state of its own. Its owned relationships (the
 * publication scheduler, the row cache, the scrollback commit watermark) are
 * private closure state scoped to one `mountTuiRenderer()` call, torn down by
 * its own returned `dispose()`/`waitUntilExit()` lifecycle — not state a
 * package-wide invariant would check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
