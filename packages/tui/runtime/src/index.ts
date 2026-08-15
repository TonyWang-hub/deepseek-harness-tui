/**
 * `@deepseek-ai/dsh-tui-runtime` — the terminal application's dual-context
 * bootstrap: mounts a second, in-process Client cordis Context wired to the
 * Host tree's Connection in-process transport, publishes it as
 * `ctx.tuiRuntime`, and mounts the terminal renderer on a real TTY.
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
 *
 * `Config.render` (default `true`) optionally mounts the terminal renderer
 * (`@deepseek-ai/dsh-tui-ink-ui`'s `mountTuiRenderer`) over the bootstrapped
 * Client tree once it is ready, but only under a real TTY `stdout` — a
 * validated `Config` field, not a hardcoded default, per the "no hardcoded
 * tunables" rule (a piped/CI process or a test harness has no terminal to
 * render into, and set-but-unused would be the misleading alternative). The
 * renderer's own lifecycle is folded into this plugin's fiber, disposed
 * before the Client tree it renders.
 *
 * `Config.resumeSessionId`, when set, opens that existing session instead of
 * creating a fresh one (`MountOptions.sessionId`) — the one cross-boundary id
 * this plugin brands: a plain configured string in, `SessionId` out, at the
 * single point that reads it. `mountTuiRenderer`'s own MVP limitation still
 * applies unchanged: nodes already in the session at mount time are the
 * committed baseline and are never replayed into scrollback (no backfill/tail
 * rebase in this cut).
 *
 * `registerConversationNodes` rides a narrower publication of the same kind:
 * `@deepseek-ai/dsh-client-ui-conversation/conversation-nodes`, a Node ESM
 * companion of ONLY that package's `src/client/conversation-nodes/` subtree
 * (the Chat business Definitions plus their `ChatSnapshotBuilder` target
 * builder), never `dsh-client-ui-conversation`'s package root or its
 * `./client` entry — both of those reach `apply.ts`'s React component
 * closure, which this Node process cannot load. Without this call, the
 * mounted `sessions`/`conversationEvents`/`conversationViews` registries stay
 * populated with zero business Definitions, so every session's
 * `ConversationSnapshot` (`nodes`, `chat.order`, `turnEnds`, `turnTimings`)
 * observes only lifecycle facts (`running`, `pending`, `queue`, `openState`)
 * with no transcript content — the gap `cordis-yml-file-boot.client.spec.ts`
 * once documented as an ASSEMBLY-GAP FINDING.
 * @module @deepseek-ai/dsh-tui-runtime
 */

import { Context } from '@deepseek-ai/cordis'
import type { Context as HostContext } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import * as connectionClient from '@deepseek-ai/dsh-client-connection/client-node'
import * as typertRegistryClient from '@deepseek-ai/dsh-typert-registry/client-node'
import * as remoteClient from '@deepseek-ai/dsh-api-gateway/client-node'
import * as runtimeClient from '@deepseek-ai/dsh-client-runtime/client-node'
import { registerConversationNodes } from '@deepseek-ai/dsh-client-ui-conversation/conversation-nodes'
import { mountTuiRenderer, type MountedTuiRenderer, type MountOptions } from '@deepseek-ai/dsh-tui-ink-ui'
// Generated Typert Remote descriptor (Host-for-Client artifact), not a
// Client-vs-Host split — a plain generated object with no Cordis Context
// merge, safe to import directly.
import commandsRemote from '@deepseek-ai/dsh-commands/remote'
import type { HostConnectionLike } from './types.ts'

export type { HostConnectionLike } from './types.ts'
export type { MountedTuiRenderer } from '@deepseek-ai/dsh-tui-ink-ui'

/** Stable Cordis plugin name. */
export const name = 'tui-runtime'

/** Hard dependencies: the Host Connection transport and the API it serves in-process. */
export const inject = ['connection', 'apiProxy']

/** Public plugin configuration. */
export interface Config {
  /**
   * Mount the terminal renderer over the bootstrapped Client tree once it is
   * ready. Takes effect only under a real TTY `stdout`: a piped/CI process
   * or a test harness has no terminal to render into, so this plugin
   * silently skips mounting in that case rather than treating `render` as
   * unset. Default `true`.
   */
  render?: boolean
  /**
   * An existing session id to open instead of creating a fresh one (a `dsh
   * --profile tui --resume <sessionId>` invocation). Passed through to
   * `mountTuiRenderer`'s `MountOptions.sessionId` unchanged; absent, the
   * renderer creates a fresh session as before.
   */
  resumeSessionId?: string
}

/** Schemastery config exposed by the plugin. */
export const Config: z<Config> = z.object({
  render: z.boolean().default(true),
  // No `.required()`: schemastery treats a plain field as optional by
  // default, matching Config.resumeSessionId's own `?:` (absent when a
  // `dsh --profile tui` invocation named no `--resume`).
  resumeSessionId: z.string(),
})

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
   * The bootstrapped Client-tree root Context. The mounted terminal renderer
   * reads its services (`ctx.sessions`, `ctx.connection`) directly. This package publishes the whole Context because no narrower
   * stable facade is defined for the in-process Client composition.
   */
  readonly clientCtx: Context
  /**
   * The mounted terminal renderer, when `Config.render` held and `process.stdout`
   * was a real TTY at mount time; `undefined` otherwise (a headless/test
   * composition, or a non-TTY process). A caller that wants to know when the
   * terminal application itself exited (Ctrl-C, `useApp().exit()`, or an
   * uncaught exception unwinding through Ink — see `mountTuiRenderer`'s
   * `waitUntilExit` doc) awaits `renderer.waitUntilExit()`; the dev-run
   * driver (`tests/dev-run.manual.ts`) does exactly this to know when to
   * dispose the rest of the host tree.
   */
  readonly renderer?: MountedTuiRenderer
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
 * independently. If the Host row instead disposes while one of the mount
 * awaits below is still settling, this function disposes the Client tree
 * itself before returning (see the `INACTIVE_EFFECT` handling inline).
 * The Client tree exists only while both Host dependencies are active.
 * @param ctx - Host plugin context; `inject` guarantees `ctx.connection` and `ctx.apiProxy` already exist.
 * @param config - resolved plugin configuration (see {@link Config}).
 */
export async function apply(ctx: HostContext, config: Config): Promise<void> {
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
  // Populates ctx.conversationEvents/ctx.conversationViews (provided by the
  // runtimeClient plugin just mounted above) with the Chat business
  // Definitions — see the module doc for why this call, not a whole plugin
  // mount, is this row's own registration act.
  registerConversationNodes(clientCtx)

  // The renderer mounts only under a real TTY stdout: config.render gates it
  // explicitly (see the Config JSDoc), and a non-TTY stdout (a piped/CI
  // process, a test harness) has no terminal to render into — mounting Ink
  // there would corrupt piped output rather than render anything useful.
  let renderer: MountedTuiRenderer | undefined
  try {
    if (config.render && process.stdout.isTTY) {
      // Branded at this single boundary point (the one cross-boundary id this
      // plugin's own Config carries as a plain string) — never validated
      // beyond schemastery's `z.string()`, matching `SessionId`'s own
      // "compile-time cast, no runtime cost" contract.
      const mountOptions: MountOptions = config.resumeSessionId === undefined
        ? {}
        : { sessionId: config.resumeSessionId as NonNullable<MountOptions['sessionId']> }
      renderer = await mountTuiRenderer(clientCtx, mountOptions)
    }
  } catch (error) {
    // The renderer mount is the last step before this plugin registers its
    // own disposal effect below; a failure here would otherwise leave the
    // Client tree (and the commands Remote mount) with nothing to dispose
    // them, the same leak the `ctx.effect()` catch below guards against.
    await disposeCommandsRemote()
    await clientCtx.fiber.dispose()
    throw error
  }

  try {
    ctx.effect(() => async () => {
      // Cordis awaits an async disposer during unload (see
      // vendor/cordis/src/fiber.ts's `Disposable` doc), so returning here
      // instead of firing both calls with `void` lets a rejection from
      // either propagate to the unload caller instead of escaping as an
      // unhandled rejection. The renderer disposes first: it is the Client
      // tree's own consumer, so its teardown (unmounting Ink, restoring the
      // terminal) must complete before the tree it reads from goes away.
      await renderer?.dispose()
      await disposeCommandsRemote()
      await clientCtx.fiber.dispose()
    }, 'tui-runtime: client tree lifecycle')
  } catch (error) {
    // `ctx.effect()` above is the only place that will ever dispose the
    // Client tree just built — if it throws for any reason, that tree would
    // otherwise never be disposed by anything, a silent leak of its
    // connect/pump/reconnect loop. Tear it down here regardless of why the
    // registration failed, then decide whether the failure itself is
    // expected teardown or a genuine error.
    await renderer?.dispose()
    await disposeCommandsRemote()
    await clientCtx.fiber.dispose()
    // The Host row's own fiber can start (or finish) unloading during any of
    // the awaits above — an HMR reload or process shutdown racing this
    // mount. `ctx.effect()` then throws `CordisError('INACTIVE_EFFECT')`
    // (see vendor/cordis/src/fiber.ts `assertActive()`/`effect()`) because
    // there is no longer an active fiber to attach cleanup to. The Host row
    // disposing mid-mount is the app tearing down exactly as asked, not a
    // mount failure, so this case settles quietly and returns rather than
    // throwing (same rationale as `watchUserPatches` in dsh-app-boot). Any
    // other error is genuinely unexpected and propagates.
    if ((error as { code?: string } | null)?.code === 'INACTIVE_EFFECT') return
    throw error
  }

  ctx.provide('tuiRuntime', { clientCtx, renderer })
}
