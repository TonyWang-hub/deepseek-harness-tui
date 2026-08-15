/**
 * PTY smoke fixture — see `../pty-smoke.spec.ts`.
 *
 * Boots the REAL `dsh --profile tui` composition through the same profile
 * resolution production uses: `loadProfile` resolves `dsh.profile.bundles`
 * (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-tui-app`) from
 * `PROFILE_TEMPLATES.tui`, auto-initializing a fresh temp profile directory
 * exactly as a first `dsh --profile tui` invocation would; `boot()` mounts the
 * composed patch stack (plus this fixture's hermetic temp-root overrides and
 * a scripted `dsh-llm-replay` turn, passed as `argv[2]`, an override-file
 * path) through the vendored Loader. `tui-runtime`'s own `Config.render`
 * (default `true`) mounts the D2.2 terminal renderer automatically here
 * because this process runs under a real pty (`process.stdout.isTTY` is
 * `true`), and this bundle's own `tui-runner` row is the one that requests
 * process exit once that renderer exits (see
 * `../../src/index.ts`'s module doc) — this fixture only boots the tree,
 * installs the replay adapter, prints a readiness marker via
 * `process.stdout.write` (bypassing `console.log`'s `patchConsole`
 * interception so the marker is never mistaken for a committed scrollback
 * line), and waits for the exit request the launcher contract promises.
 */
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  boot, healProfilesModuleFallback, loadProfile, PROFILE_TEMPLATES,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { installLlmReplay } from '@deepseek-ai/dsh-llm-replay'

const BIN_NAME = 'dsh-tui-app pty smoke'
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

async function main(): Promise<void> {
  const overrideFile = process.argv[2]
  if (overrideFile === undefined) throw new Error('tui-app-smoke.ts requires an llm-replay override-file path argument')

  const workspaceCwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tui-app-smoke-ws-')))
  const harnessHome = join(workspaceCwd, '.dsh-home')
  const persistenceRoot = join(workspaceCwd, '.dsh-sessions')
  const storageRoot = join(workspaceCwd, '.dsh-storages')
  process.env.DSH_HOME = harnessHome

  const originalCwd = process.cwd()
  process.chdir(workspaceCwd)
  healProfilesModuleFallback(INSTALL_ANCHOR, harnessHome)
  // Exercises PROFILE_TEMPLATES.tui directly: no profile directory exists yet
  // under this fresh temp home, so loadProfile auto-initializes it from the
  // shipped template, exactly like a first `dsh --profile tui` invocation.
  if (PROFILE_TEMPLATES.tui === undefined) {
    throw new Error('tui-app-smoke.ts: PROFILE_TEMPLATES.tui is not registered')
  }
  const profile = loadProfile(BIN_NAME, 'tui', INSTALL_ANCHOR, harnessHome)
  const rootConfig = join(profile.dir, 'cordis.yml')
  await mkdir(profile.dir, { recursive: true })
  await writeFile(rootConfig, '[]\n')

  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const patches = [
    ...bundlePatches,
    ...profile.patches,
    // Hermetic temp roots, mirroring every other keyless composition test in
    // the repo — never the developer's real $DSH_HOME/sessions or storages.
    { id: 'session-persistence-jsonl', config: { root: persistenceRoot } },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'storage-json', config: { root: storageRoot } },
    { id: 'settings', config: { dshHome: harnessHome } },
    { id: 'credentials', config: { dshHome: harnessHome } },
    // The scripted route below serves every model call; the shipped live
    // adapter is never mounted.
    { id: 'llm-deepseek', disabled: true },
  ]

  let disposing = false
  const ctx = await boot(BIN_NAME, rootConfig, patches, (bootCtx) => {
    provideCmdline(bootCtx, {
      args: [],
      exit: (code) => {
        if (disposing) return
        disposing = true
        void (async () => {
          await bootCtx.fiber.dispose()
          process.stdout.write('___SMOKE_DISPOSED___\n')
          process.stdout.write(`___EXITCODE_${String(code)}___\n`)
          process.chdir(originalCwd)
          process.exit(code)
        })()
      },
    })
  })

  // A non-TTY invocation (this fixture run directly, without a real pty) hits
  // tui-runner's own loud-fail path, whose `exit()` disposes the tree above
  // before this line runs; nothing is left to install into, and the process
  // is already exiting, so this call would otherwise throw over a torn-down
  // `ctx.llm`.
  if (ctx.get('llm') === undefined) return

  // Routed (not catch-all) mode: base's agent-default-model config
  // (provider: deepseek-official, model: deepseek-v4-flash) must resolve to a
  // real catalog entry, or prompt admission rejects with model-unavailable
  // before any stream() call is ever made.
  installLlmReplay(ctx, {
    file: join(workspaceCwd, 'unused-primary-fixture.jsonl'),
    overrideFile,
    providers: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128_000 }],
    }],
  })

  process.stdout.write('___READY___\n')
}

await main()
