/**
 * `@deepseek-ai/dsh-tui-runtime` — the terminal application's dual-context
 * bootstrap: mounts a second, in-process Client cordis Context wired to the
 * Host tree's Connection in-process transport, and publishes it as
 * `ctx.tuiRuntime` for a terminal renderer (a later package) to consume.
 *
 * One Node process hosts two root cordis Contexts because `connection`,
 * `sessions`, and `loader` are Host and Client services under the same keys
 * with different implementations, and a second `provide` of one key throws
 * at runtime — see the official-terminal-application Agent Note. This
 * package is the row that bridges them: mounted as an ordinary Host-tree
 * plugin (by package name, through the Loader), it reads the Host's
 * `connection` service, builds a fresh Client `Context`, and mounts the
 * Client halves of Connection, the Typert registry, the Typert Remote, one
 * generated Remote contribution (`commands`), and the client Runtime object
 * layer over it — the same wiring `client-apply.client.spec.ts` and
 * `in-process-connection.client.spec.ts` exercise piecewise, assembled here
 * as one product composition.
 *
 * Deliberately Host-merge-free: this module never imports a Host-half
 * package root (each of those carries a `declare module '@deepseek-ai/cordis'`
 * augmentation for a Host-only service — `apiProxy`, `connection` on the Host
 * side, `webServer`, …). Importing one would pull that augmentation into this
 * package's TypeScript program, which type-checks under the CLIENT aggregate
 * (`tsconfig.client.json`) even though this plugin runs inside the Host tree
 * at runtime — a program that saw both a Host and a Client merge of the same
 * key would poison itself (proven twice already on this branch). The one
 * Host member this package calls (`connection.inProcessHandler()`) is reached
 * through the package-local narrow structural type {@link HostConnectionLike}
 * and `ctx.get('connection')`, never a declared injection or a Context merge.
 *
 * The Client-half packages this module mounts are consumed through their
 * `/client-node` Node ESM companions (plain Node ESM, no
 * `window.__ModuleLoader__` wrapper) — never their package roots, which
 * would carry the SAME cross-merge hazard from the other direction (the
 * Client half's own `declare module` augmentations are fine; a package
 * root's Host-half augmentation is not).
 * @module @deepseek-ai/dsh-tui-runtime
 */

import { Context } from '@deepseek-ai/cordis'
import type { Context as HostContext } from '@deepseek-ai/cordis'
import * as connectionClient from '@deepseek-ai/dsh-client-connection/client-node'
import * as typertRegistryClient from '@deepseek-ai/dsh-typert-registry/client-node'
import * as remoteClient from '@deepseek-ai/dsh-api-gateway/client-node'
import * as runtimeClient from '@deepseek-ai/dsh-client-runtime/client-node'
// Generated Typert Remote descriptor (Host-for-Client artifact), not a
// Client-vs-Host split — a plain generated object with no Cordis Context
// merge, safe to import directly.
import commandsRemote from '@deepseek-ai/dsh-commands/remote'
import type { HostConnectionLike } from './types.ts'

export type { HostConnectionLike } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runtime'

/** Hard dependency: the Host tree's Connection service (its in-process transport). */
export const inject = ['connection']

/**
 * The `ctx.tuiRuntime` service: the bootstrapped Client-tree root Context,
 * ready once `apply()` resolves. `ctx.connection` (in-process transport
 * wired), `ctx.typert`/`ctx.remote`/`ctx.remote.commands` (the Typert Remote
 * seam), and `ctx.sessions`/`ctx.workspaces` (the runtime object layer) are
 * already mounted, and the Client Runtime's connect/pump/reconnect loop is
 * already running.
 */
export interface TuiRuntimeHandle {
  /**
   * The bootstrapped Client-tree root Context. A terminal renderer (a later
   * package) reads its services (`ctx.sessions`, `ctx.workspaces`,
   * `ctx.connection`) directly; this package publishes the whole Context
   * rather than a narrower re-exported surface, because its consumer's exact
   * needs are not yet fixed (this cut ships no renderer) and re-deriving a
   * narrower facade ahead of a real second consumer would guess at a contract
   * this package cannot yet justify.
   */
  readonly clientCtx: Context
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The bootstrapped Client-tree handle (see {@link TuiRuntimeHandle}). */
    tuiRuntime: TuiRuntimeHandle
  }
}

/**
 * Boot the Client tree over the Host's in-process Connection transport and
 * provide it as `ctx.tuiRuntime`. The Client tree's lifecycle is an effect of
 * this plugin's fiber: disposing the Host row (unmount, HMR reload, test
 * teardown) disposes the Client tree with it — never the reverse, and never
 * independently.
 * @param ctx - Host plugin context; `inject` guarantees `ctx.connection` already exists.
 */
export async function apply(ctx: HostContext): Promise<void> {
  // The hard `inject` above is cordis's own guarantee that `ctx.get('connection')`
  // is already defined by the time apply() runs (the fiber suspends until
  // then) — trusted here rather than re-checked, since `ctx.get` returns
  // `any` with no declared merge to narrow it (see the module doc).
  const hostConnection = ctx.get('connection') as HostConnectionLike
  const inProcessFetch = hostConnection.inProcessHandler().fetch

  const clientCtx = new Context()
  clientCtx.provide('clientConnectionInProcessTransport', { fetch: inProcessFetch })

  await clientCtx.plugin(connectionClient)
  await clientCtx.plugin(typertRegistryClient)
  await clientCtx.plugin(remoteClient)
  const disposeCommandsRemote = await clientCtx.remote.$mount(commandsRemote)
  await clientCtx.plugin(runtimeClient)

  ctx.effect(() => () => {
    void disposeCommandsRemote()
    void clientCtx.fiber.dispose()
  }, 'tui-runtime: client tree lifecycle')

  ctx.provide('tuiRuntime', { clientCtx })
}
