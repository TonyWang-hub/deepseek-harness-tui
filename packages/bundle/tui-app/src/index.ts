/**
 * @deepseek-ai/dsh-tui-app — the terminal application's process owner. The
 * bundle patch rides over dsh-base plus this bundle's own Connection/API
 * gateway/dual-context rows (`cordis.patch.yml`); this runner is the one
 * plugin that decides what the PROCESS does once `ctx.tuiRuntime` is ready:
 * a real TTY mounted a renderer (`@deepseek-ai/dsh-tui-runtime`'s own
 * `Config.render`, gated on `process.stdout.isTTY`), so this row waits for it
 * to exit and requests process exit through the launcher-provided
 * `ctx.appExit`; a non-TTY invocation (piped, CI, `dsh --profile tui` run
 * without a terminal attached) mounted no renderer, which is a genuine
 * misconfiguration for this profile — nothing else in the composition would
 * ever produce output or exit — so this row fails loud instead of hanging
 * forever.
 *
 * Deliberately reads `ctx.tuiRuntime` through the package-local narrow
 * structural type {@link TuiRuntimeLike} and `ctx.get('tuiRuntime')`, never a
 * declared injection merge or a static import of `@deepseek-ai/dsh-tui-runtime`
 * or `@deepseek-ai/dsh-tui-ink-ui`: both type-check under the CLIENT aggregate
 * (their own `tsconfig.client.json`), while this package type-checks under the
 * HOST aggregate alongside `dsh-headless` and `dsh-web-app` — a program that
 * saw both a Host and a Client cordis Context merge would poison itself (the
 * same hazard `dsh-tui-runtime`'s own module doc documents one layer down for
 * `ctx.connection`). The `inject: ['tuiRuntime']` plugin-level dependency
 * below is a plain string, so declaring it costs nothing: cordis suspends
 * `apply()` until the Loader row of that name provides the service, with no
 * TypeScript merge required to express the wait.
 * @module @deepseek-ai/dsh-tui-app
 */

import type { Context } from '@deepseek-ai/cordis'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Hard dependency: the dual-context bootstrap's own service. */
export const inject = ['tuiRuntime']

/**
 * The one `ctx.tuiRuntime` member this package reads, narrowed to a local
 * structural type instead of `@deepseek-ai/dsh-tui-runtime`'s own
 * `TuiRuntimeHandle` (see the module doc for why importing that package's
 * root is off limits here).
 */
interface TuiRuntimeLike {
  /**
   * Resolves once the mounted terminal application itself exits. `undefined`
   * when no renderer mounted (see {@link TuiRuntimeLike}'s callers).
   */
  readonly renderer?: { waitUntilExit(): Promise<void> }
}

/** Process-facing effects this runner needs: stderr plus the launcher's bounded exit request. */
interface TuiRunnerIo {
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process stream the runner writes to; tests substitute a capture. */
export const internals: { stderr: TuiRunnerIo['stderr'] } = {
  stderr: process.stderr,
}

/** Report an unexpected failure and request a failing exit. */
function fail(io: TuiRunnerIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Own the process for the lifetime of the mounted terminal application.
 * @param ctx - plugin context carrying the dual-context bootstrap and the launcher IO services.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, io: TuiRunnerIo): Promise<void> {
  // Loader siblings mount concurrently; wait for the complete application so
  // a sibling's tool/prompt/preset contribution is not half-composed before
  // the renderer's first session opens (the same reasoning dsh-headless's
  // own runner documents for its Agent creation).
  await ctx.get('loader')?.await()
  const runtime = ctx.get('tuiRuntime') as TuiRuntimeLike | undefined
  // Early process shutdown can dispose the tree while settlement is pending.
  if (runtime === undefined) return
  if (runtime.renderer === undefined) {
    io.stderr.write(
      'dsh: the tui profile requires a real terminal (process.stdout must be a TTY); '
      + 'run it attached to an interactive terminal, not piped or under a non-interactive process\n',
    )
    io.exit(1)
    return
  }
  await runtime.renderer.waitUntilExit()
  io.exit(0)
}

/**
 * Mount this app's process owner.
 * @param ctx - plugin context carrying the dual-context bootstrap and the launcher-provided exit request.
 */
export function apply(ctx: Context): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: TuiRunnerIo = { stderr: internals.stderr, exit }
  void run(ctx, io).catch((error: unknown) => { fail(io, error) })
}
