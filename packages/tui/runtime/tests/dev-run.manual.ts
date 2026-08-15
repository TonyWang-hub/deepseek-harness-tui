/**
 * Manual dev-run driver for the D2.2 terminal renderer: boots the same
 * "process-wide, single-session" host tree `compose.client.ts`'s
 * `bootHostTree` assembles for this package's own tests, but run directly
 * under `tsx` (real stdin/stdout, not vitest's forked worker) with a
 * scripted `dsh-llm-replay` turn, so a person can sit down and experience
 * the renderer end to end without a `DEEPSEEK_API_KEY`.
 *
 * `tui-runtime`'s own `Config.render` (default `true`) mounts the renderer
 * automatically once `bootHostTree` composes this package's row, because
 * this process has a real TTY `stdout` (unlike a vitest fork) — see
 * `src/index.ts`'s module doc. This driver only needs to boot the tree and
 * wait for the renderer to exit (Ctrl-C, or the composer's own turn
 * completing and then Ctrl-C) before disposing the rest of the tree.
 *
 * Not a vitest spec (`*.manual.ts`, not `*.spec.ts` — see `vitest.config.ts`'s
 * `testIncludes`, mirroring the `dsh-tui-ink-ui` package's own `*.poc.ts`
 * convention): it drives a real terminal session and never exits on its own
 * before Ctrl-C. `tsconfig.client.json`'s `include` still type-checks it.
 *
 * Run (one scripted turn is enough to see a prompt stream to completion):
 *
 *   pnpm exec tsx --import tsx/esm packages/tui/runtime/tests/dev-run.manual.ts
 *
 * Pass a path to replace the built-in one-reply script with your own
 * `dsh-llm-replay` override-file JSON (an array of `ReplayEntry` — see that
 * package's README) to exercise more turns, tool calls, or approvals:
 *
 *   pnpm exec tsx --import tsx/esm packages/tui/runtime/tests/dev-run.manual.ts ./my-script.json
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { bootHostTree } from './compose.client.ts'

const REPLY_TEXT = 'Hello from the dsh-tui-ink-ui dev run — type another prompt, or press Ctrl-C to exit.'

/** One scripted `finish: stop` model reply carrying only final text — the built-in default script. */
const DEFAULT_SCRIPT = [{
  kind: 'chunks',
  chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: REPLY_TEXT },
    { type: 'block-end', index: 0, block: { type: 'text', text: REPLY_TEXT } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
}]

async function resolveOverrideFile(): Promise<string> {
  const argument = process.argv[2]
  if (argument !== undefined) return argument
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tui-dev-run-'))
  const overrideFile = join(dir, 'replay.override.json')
  await writeFile(overrideFile, JSON.stringify(DEFAULT_SCRIPT))
  return overrideFile
}

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    throw new Error('dev-run.manual.ts must run attached to a real terminal (process.stdout.isTTY is false)')
  }
  const overrideFile = await resolveOverrideFile()
  const tree = await bootHostTree({ llmReplay: { overrideFile } })
  const renderer = tree.ctx.tuiRuntime.renderer
  if (renderer === undefined) {
    await tree.dispose()
    throw new Error('dev-run.manual.ts: the renderer did not mount (tui-runtime\'s Config.render or process.stdout.isTTY was false)')
  }
  // Ink itself restores terminal state on every exit path (the Q3
  // reconnaissance finding) before this promise settles; this driver's own
  // job is only to know when to dispose the rest of the tree (the
  // connect/pump/reconnect loop, storage, workspace) so the process exits
  // instead of hanging on those handles.
  await renderer.waitUntilExit().catch(() => {})
  await tree.dispose()
}

await main()
