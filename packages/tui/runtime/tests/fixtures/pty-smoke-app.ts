/**
 * PTY smoke fixture — see `../pty-smoke.client.spec.ts`.
 *
 * Boots the same "process-wide, single-session" host tree
 * `compose.client.ts`'s `bootHostTree` assembles for this package's other
 * tests, with a scripted `dsh-llm-replay` turn passed as `argv[2]` (an
 * override-file path). `tui-runtime`'s own `Config.render` (default `true`)
 * mounts the D2.2 terminal renderer automatically here because this process
 * runs under a real pty (`process.stdout.isTTY` is `true`) — see
 * `../../src/index.ts`'s module doc; this fixture does nothing beyond
 * booting the tree, printing a readiness marker via `process.stdout.write`
 * (bypassing `console.log`'s `patchConsole` interception so the marker is
 * never mistaken for a committed scrollback line), and waiting for the
 * renderer to exit (Ctrl-C, driven by the spec's real pty) before disposing
 * the tree and printing an exit-code marker the driver greps for.
 */
import process from 'node:process'
import { bootHostTree } from '../compose.client.ts'

async function main(): Promise<void> {
  const overrideFile = process.argv[2]
  if (overrideFile === undefined) throw new Error('pty-smoke-app.ts requires an llm-replay override-file path argument')
  const tree = await bootHostTree({ llmReplay: { overrideFile } })
  const renderer = tree.ctx.tuiRuntime.renderer
  if (renderer === undefined) {
    await tree.dispose()
    throw new Error('pty-smoke-app.ts: renderer did not mount (process.stdout.isTTY was false)')
  }
  process.stdout.write('___READY___\n')
  await renderer.waitUntilExit().catch(() => {})
  await tree.dispose()
  process.stdout.write('___SMOKE_DISPOSED___\n')
}

await main()
