/**
 * `@deepseek-ai/dsh-tui-ink-ui` — the terminal application's renderer,
 * input, and bounded live region, over the Ink/React 19 dependency island
 * D2.0 stood up (see `tests/*.poc.ts` for the three reconnaissance PoCs this
 * renderer's design decisions are built on: Q1 scrollback commit through
 * `console.log`/`patchConsole`, Q2 the from-scratch multiline composer, Q3
 * Ink's own terminal restoration on every exit path).
 *
 * `mountTuiRenderer` ({@link module:render}) is the sole entry point: given a
 * bootstrapped Client tree (`ctx.tuiRuntime.clientCtx` from
 * `@deepseek-ai/dsh-tui-runtime`), it mounts the terminal application over
 * one session. See the official-terminal-application Agent Note
 * (`.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md`)
 * for this package's role in the landing order and its "Rendering"/"Terminal
 * ownership"/"Interaction surface" design.
 * @module @deepseek-ai/dsh-tui-ink-ui
 */

export { mountTuiRenderer } from './render.ts'
export type { MountedTuiRenderer, MountOptions } from './render.ts'
export { RendererConfig, resolveRendererConfig } from './config.ts'
export type { ResolvedRendererConfig } from './config.ts'
