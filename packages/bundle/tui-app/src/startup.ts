/**
 * The terminal app's command-line provider: it parses `dsh --profile tui`'s
 * `--resume <sessionId>` flag and its `--help`, then provides the immutable
 * value as {@link TUI_STARTUP_SERVICE}. The `tui-runtime` row injects that
 * service and reads `resumeSessionId` from lazy config.
 * @module @deepseek-ai/dsh-tui-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the flag can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the `tui-runtime` row. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the `tui-runtime` row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** An existing session id to open (`--resume <sessionId>`); absent starts a fresh session. */
  resumeSessionId?: string
}

/**
 * This app's command: the `--resume` flag, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Run the DeepSeek Harness terminal application.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <sessionId>', 'open an existing session instead of creating a fresh one')
    .addHelpText('after', `
Examples:
  dsh --profile tui                          start a fresh terminal session
  dsh --profile tui --resume <sessionId>      open an existing session
`)
}

/** The `--resume` flag, as commander parsed it. */
interface TuiOptions {
  resume?: string
}

/**
 * Parse and provide the terminal invocation as an ordinary Cordis service. The
 * command's action publishes the flag this invocation named; on `--help` (and
 * a grammar rejection) nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<TuiOptions>()
    ctx.provide(TUI_STARTUP_SERVICE, {
      ...options.resume !== undefined && { resumeSessionId: options.resume },
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
