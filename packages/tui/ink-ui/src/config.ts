/**
 * Validated renderer tunables for {@link mountTuiRenderer}. `mountTuiRenderer`
 * is a plain function, not a Cordis plugin, so nothing calls this schema
 * automatically the way the Loader calls a plugin's `Config` — callers (today
 * `@deepseek-ai/dsh-tui-runtime`'s optional mount row) resolve it explicitly
 * through {@link resolveRendererConfig}. The schema is still schemastery
 * (`no hardcoded tunables` — deployment-varying choices are validated `Config`
 * fields, not a `DEFAULT_*` constant read directly by `render.ts`).
 * @module @deepseek-ai/dsh-tui-ink-ui/config
 */

import z from '@deepseek-ai/schemastery'

/** Public renderer configuration. */
export interface RendererConfig {
  /**
   * Maximum rate, in frames per second, at which streaming updates (token
   * deltas, spinner ticks) repaint the bounded live region. Structural events
   * (a closed step committing to scrollback, a turn ending, an approval or
   * question appearing) publish immediately regardless of this rate — see
   * {@link createPublicationScheduler}. Default 30.
   */
  publishRateFps?: number
  /**
   * Milliseconds `mountTuiRenderer` waits for a freshly created (or
   * caller-named) session to appear in `ISessions.list` before opening it.
   * The client-side session list populates from a `host/session-added`
   * event delivered asynchronously over the same connection the
   * `session.create` RPC used; opening before that event lands throws
   * (`sessions.select: unknown session …`), a real host/network-latency
   * race, not a fixed protocol constant. Default 5000.
   */
  sessionListTimeoutMs?: number
}

/** `RendererConfig` after schemastery defaults are applied. */
export type ResolvedRendererConfig = Required<RendererConfig>

/**
 * Schemastery schema for {@link RendererConfig}. `publishRateFps` bounds: at
 * least 1 (a scheduler that never publishes is not a renderer) and at most
 * 240 (an arbitrary but generous ceiling — well above any real terminal's
 * refresh rate — that still rejects a copy/paste or unit mistake, e.g.
 * milliseconds passed where a frame rate was meant). `sessionListTimeoutMs`
 * bounds: at least 1ms (a zero-wait is not a wait) and at most 60000ms (a
 * generous ceiling for a same-process, in-loopback round trip).
 */
export const RendererConfig: z<RendererConfig> = z.object({
  publishRateFps: z.natural().min(1).max(240).default(30),
  sessionListTimeoutMs: z.natural().min(1).max(60_000).default(5_000),
})

/**
 * Apply schemastery defaults and bounds to a caller-supplied config. Schema
 * violations (e.g. `publishRateFps: 0` or a non-integer) throw from the
 * schema call itself — misconfiguration fails loud at the earliest resolvable
 * point, here `mountTuiRenderer`'s own entry rather than deep inside the
 * scheduler.
 * @param config - caller-supplied partial configuration, or `undefined` for all defaults.
 * @returns the fully resolved configuration.
 */
export function resolveRendererConfig(config?: RendererConfig): ResolvedRendererConfig {
  return RendererConfig(config ?? {}) as ResolvedRendererConfig
}
