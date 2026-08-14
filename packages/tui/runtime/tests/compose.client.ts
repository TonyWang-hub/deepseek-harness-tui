/**
 * Shared REAL-composition helper for `@deepseek-ai/dsh-tui-runtime` tests:
 * boots the shipped `dsh-base` bundle patch through the vendored Loader, plus
 * the narrow set of extra rows a "process-wide, single-session" (TUI-style)
 * host tree needs — Connection's Host half, the ApiProxy gateway, the
 * Workspace/DirectoryPicker services `ApiProxyService.inject` requires, and
 * this package's own row — over an empty profile root, exactly the pattern
 * `apps/web/tests/scaffold.ts` uses for the Web surface. No `webServer` row
 * is ever mounted: this is the composition's whole point (a terminal
 * composition binds no listening socket).
 *
 * Deliberately never imports a Host-half package (`@deepseek-ai/dsh-host-apiproxy`,
 * `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-app-boot`, `@deepseek-ai/dsh-llm-replay`,
 * …) — every Host row is resolved by the real Loader from its package NAME (an
 * ordinary string in `patches`), never a static import, so this file's own
 * TypeScript program (the Client aggregate) never sees a Host-half Cordis
 * Context merge. The shipped bundle patch is parsed locally with the same
 * `js-yaml` + `entryListSchema` pair `@deepseek-ai/dsh-app-boot`'s own
 * `loadOverlayPatches` uses internally — that helper lives in a Host-only
 * module together with unrelated Host-only exports, so importing it here
 * would pull its whole file's Host-only closure into this program. For the
 * same reason, `healProfilesModuleFallback` (the flat `node_modules`
 * fallback a real profile boot needs so a bare row name resolves from a
 * profile directory outside any package's own `node_modules`) is
 * reimplemented locally below, narrowed to this test's own needs — the real
 * one lives in the same Host-only module and itself imports back into it
 * (`loadOverlayPatches`), so no subpath of that package avoids the closure.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const BASE_PATCH_PATH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
/** Installation anchor whose dependency closure covers every dsh-base row (mirrors `scaffold.ts`'s `INSTALL_ANCHOR`). */
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

/** Parse one Include patch-list YAML file (mirrors app-boot's `loadOverlayPatches`, without its Host-only import closure). */
function loadBasePatches(path: string): PatchOptions[] {
  const parsed: unknown = yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`${path} must be a top-level YAML array of loader patch entries`)
  return parsed as PatchOptions[]
}

interface ProfileManifest {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** Resolve one package's directory from an anchor's own `resolve.paths` search list (mirrors app-boot's `packageDirFromAnchor`). */
function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Maintain a flat `<profilesDir>/node_modules` fallback: one symlink per
 * package in the anchors' resolvable dependency closure (BFS over
 * `dependencies`/`peerDependencies`), so Node's parent-directory walk from
 * the temp profile directory resolves every `dsh-base` row by name, exactly
 * as the real `$DSH_HOME/profiles/node_modules` fallback does for a shipped
 * profile boot. `extraAnchors` seeds packages the primary anchor's own
 * dependency graph does not reach (this test's own row packages).
 * @param installAnchor - absolute path of an app package.json whose dependency closure covers every shipped row this test mounts.
 * @param profilesDir - the temp world's profiles directory.
 * @param extraAnchors - additional package.json paths seeding the same BFS (their own name plus their dependency closure).
 */
async function healProfilesModuleFallback(
  installAnchor: string,
  profilesDir: string,
  extraAnchors: readonly string[] = [],
): Promise<void> {
  const modulesDir = join(profilesDir, 'node_modules')
  await mkdir(modulesDir, { recursive: true })
  const links = new Map<string, string>()
  const queue: { anchor: string; manifest: ProfileManifest }[] = []
  for (const anchor of [installAnchor, ...extraAnchors]) {
    const manifest = JSON.parse(readFileSync(anchor, 'utf8')) as ProfileManifest
    if (manifest.name !== undefined) links.set(manifest.name, dirname(anchor))
    queue.push({ anchor, manifest })
  }
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const dep of [...Object.keys(next.manifest.dependencies ?? {}), ...Object.keys(next.manifest.peerDependencies ?? {})]) {
      if (links.has(dep)) continue
      const dir = packageDirFromAnchor(next.anchor, dep)
      if (dir === undefined) continue
      links.set(dep, dir)
      const manifestPath = join(dir, 'package.json')
      queue.push({ anchor: manifestPath, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest })
    }
  }
  for (const [packageName, target] of links) {
    const link = join(modulesDir, packageName)
    await mkdir(dirname(link), { recursive: true })
    try {
      await lstat(link)
      continue
    } catch {
      // No existing entry: fall through to create the link.
    }
    await symlink(target, link, 'junction').catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readlink(link) !== target) throw error
    })
  }
}

/** One booted Host tree, ready for assertions; disposes its own temp world. */
export interface ComposedTree {
  /** The settled root Host Context (the real Loader composition). */
  readonly ctx: Context
  /**
   * The `cordis:include` entry's own nested entry tree — every patched row
   * (`api-gateway`, `connection`, `tui-runtime`, …) lives in THIS tree's
   * store, not `ctx.loader`'s own (a bare `EntryTree.resolve()` id looks in
   * the tree it is called on; nested ids need the `:`-separated path or, as
   * here, the nested tree itself).
   */
  readonly rows: EntryTree
  /** The composition's project workspace (bash/fs tool cwd, sandbox root). */
  readonly workspaceCwd: string
  /** Tear down: dispose the tree and remove every owned temp directory. */
  dispose(): Promise<void>
}

/** Optional scripted LLM turn for a scenario that drives a real model call. */
export interface LlmReplayOptions {
  /** Absolute path to a whole-script-replacement override document (bare `ReplayEntry[]` JSON). */
  readonly overrideFile: string
}

/**
 * Boot the "process-wide, single-session" host tree this package's plugin
 * mounts into: the shipped `dsh-base` bundle patch, unmodified except for
 * hermetic temp-world roots and a keyless LLM route, plus Connection's Host
 * half, the ApiProxy gateway, `ApiProxyService`'s remaining hard
 * dependencies, `ask_user_question` (present in every shipped agent preset
 * but never at `dsh-base`'s own top level — this composition needs it
 * top-level, exactly as `dsh-base`'s own comments describe for "the TUI,
 * which is single-session and composes its agent process-wide"), and this
 * package's own row.
 * @param options - an optional scripted LLM turn for a scenario that prompts a session.
 * @returns the booted tree.
 */
export async function bootHostTree(options: { llmReplay?: LlmReplayOptions } = {}): Promise<ComposedTree> {
  const workspaceCwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tui-runtime-ws-')))
  const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-tui-runtime-sessions-'))
  const storageRoot = await mkdtemp(join(tmpdir(), 'dsh-tui-runtime-storage-'))
  const harnessHome = join(workspaceCwd, '.dsh-home')

  const basePatches = loadBasePatches(BASE_PATCH_PATH)
  const patches: PatchOptions[] = [
    ...basePatches,
    // TODO(dsh-tui-runtime): re-enable shared HMR once this test package's
    // temp-world file watching is proven quiet; every other keyless
    // composition test in the repo disables it for the same reason.
    { id: 'hmr', disabled: true },
    { id: 'session-persistence-jsonl', config: { root: persistenceRoot } },
    { id: 'session-telemetry-otel', disabled: true },
    // Its fire-and-forget title call would otherwise race the turn loop for
    // the scripted replay cursor (the same reason apps/web/tests/scaffold.ts
    // disables this row for every keyless scenario).
    { id: 'session-title-llm', disabled: true },
    { id: 'llm-deepseek', disabled: true },
    { id: 'settings', config: { dshHome: harnessHome } },
    { id: 'credentials', config: { dshHome: harnessHome } },
    // Read-only forces every bash call through the sandbox escalation path,
    // which is what routes it through `ctx.approval.request()` — the shipped
    // default (workspace-write) never asks for an ordinary in-workspace write.
    { id: 'sandbox-policy', config: { mode: 'read-only', workspaceRoot: workspaceCwd } },
    { insert: [
      { id: 'storage', name: '@deepseek-ai/dsh-storage' },
      { id: 'storage-json', name: '@deepseek-ai/dsh-storage-json', config: { root: storageRoot } },
      { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
      // ApiProxyService's remaining hard `inject` entries `dsh-base` does not
      // itself mount (it composes for the TUI's own bundle, one layer up):
      // workspaceRegistry and directoryPicker.
      { id: 'workspace', name: '@deepseek-ai/dsh-workspace' },
      { id: 'directory-picker', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      // Present in every shipped agent preset's agent.cordis.yml but never at
      // dsh-base's own top level (presets did not exist when this row's
      // process-wide home was chosen) — this composition mounts it directly,
      // matching every other model-facing tool already top-level in dsh-base.
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      { id: 'api-gateway', name: '@deepseek-ai/dsh-host-apiproxy' },
      { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: { trustedHosts: [] } },
      { id: 'tui-runtime', name: '@deepseek-ai/dsh-tui-runtime', inject: ['connection'] },
      // Mounted as an ordinary Loader row (by name), never a static import of
      // @deepseek-ai/dsh-llm-replay — same Host-merge-free reasoning as above.
      ...options.llmReplay === undefined ? [] : [{
        id: 'llm-replay',
        name: '@deepseek-ai/dsh-llm-replay',
        config: {
          file: join(workspaceCwd, 'unused-primary-fixture.jsonl'),
          overrideFile: options.llmReplay.overrideFile,
          // Routed (not catch-all) mode: base's agent-default-model config
          // (provider: deepseek-official, model: deepseek-v4-flash) must
          // resolve to a real catalog entry, or prompt admission rejects
          // with model-unavailable before any stream() call is ever made.
          providers: [{
            id: 'deepseek-official',
            name: 'DeepSeek',
            models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128_000 }],
          }],
        },
      }],
    ] },
  ]

  const ctx = new Context()
  const originalCwd = process.cwd()
  const dispose = async (): Promise<void> => {
    if (process.cwd() !== originalCwd) process.chdir(originalCwd)
    await ctx.fiber.dispose()
    await rm(workspaceCwd, { recursive: true, force: true })
    await rm(persistenceRoot, { recursive: true, force: true })
    await rm(storageRoot, { recursive: true, force: true })
  }
  let rows: EntryTree
  try {
    process.chdir(workspaceCwd)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const profilesDir = join(harnessHome, 'profiles')
    const profileDir = join(profilesDir, 'test')
    await mkdir(profileDir, { recursive: true })
    await healProfilesModuleFallback(INSTALL_ANCHOR, profilesDir, [
      join(REPO_ROOT, 'packages/tui/runtime/package.json'),
      join(REPO_ROOT, 'packages/test-support/llm-replay/package.json'),
    ])
    const rootConfig = join(profileDir, 'cordis.yml')
    await writeFile(rootConfig, '[]\n')
    const includeId = await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(rootConfig).href, patches },
    })
    await ctx.loader.await()
    const includeSubtree = ctx.loader.resolve(includeId).subtree
    if (includeSubtree === undefined) throw new Error('cordis:include entry has no nested entry tree')
    rows = includeSubtree
  } catch (error) {
    await dispose()
    throw error
  } finally {
    if (process.cwd() !== originalCwd) process.chdir(originalCwd)
  }

  return { ctx, rows, workspaceCwd, dispose }
}
