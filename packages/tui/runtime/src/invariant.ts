/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tui-runtime`.
 * @module @deepseek-ai/dsh-tui-runtime/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui-runtime'

/** Cordis companion plugin name. */
export const name = 'tui-runtime-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package's only owned relationship is the
 * Client-tree Context it constructs in `apply()` and disposes as one effect
 * of its own fiber — `clientCtx.plugin(connectionClient)` mounts before
 * `ctx.provide('tuiRuntime', ...)` runs, so `ctx.tuiRuntime.clientCtx` never
 * exists without its Connection service already composed; TypeScript's
 * control flow enforces that ordering at construction, not a mutable
 * relationship that can drift after boot. The Client tree's own owned
 * services (Connection's generation-scoped streams, the Runtime object
 * layer's session/workspace state) carry their own invariants in their own
 * packages; this package holds no additional mutable relation to audit.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
