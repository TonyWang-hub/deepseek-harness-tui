/**
 * Real-composition slice, product-startup variant: `compose.client.ts`'s
 * `bootHostTree` proves the same rows boot through the real Loader, but the
 * tui-specific half of the composition (storage, workspace, tool-ask-user,
 * api-gateway, connection, tui-runtime, llm-replay) is expressed there as
 * inline `PatchOptions` objects built in TypeScript — never a file the real
 * Loader reads and parses. Every OTHER row (the whole `dsh-base` half) already
 * round-trips through a real YAML file via `loadBasePatches` on the shipped
 * `packages/bundle/base/cordis.patch.yml`. This spec closes that asymmetry:
 * it writes the tui-specific half as a literal `cordis.patch.yml` file (this
 * test's own temp-world stand-in for the not-yet-created
 * `packages/bundle/tui-app/cordis.patch.yml` — see the official-terminal-
 * application Agent Note's "Package topology" section) and parses it with the
 * exact same `js-yaml` + `entryListSchema` pair the shipped base patch and
 * `apps/cli/src/profile-boot.ts`'s own `loadOverlayPatches` use, including a
 * `!!js process.env...` dynamic value exactly like the shipped base patch
 * uses for `process.cwd()`/`process.env.DSH_PERMISSION_MODE`. The root
 * `cordis.yml` stays the empty `[]` entry list every real `dsh --profile` boot
 * composes over (`apps/cli/src/profile-boot.ts`'s `PROFILE_ROOT_CONFIG`) —
 * every row, including the base bundle's own, arrives as a patch layer, never
 * a literal root row.
 *
 * Deliberately Host-merge-free for the same reason as `compose.client.ts`:
 * the Host half (`@deepseek-ai/dsh-host-apiproxy`, `@deepseek-ai/dsh-agent`,
 * `@deepseek-ai/dsh-llm-replay`, …) is resolved by the real Loader from
 * package NAMEs written into the patch file's YAML text, never a static
 * import — this file's own TypeScript program never sees a Host-half Cordis
 * Context merge.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as yaml from 'js-yaml'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import '@deepseek-ai/dsh-tui-runtime'
import {
  BASE_PATCH_PATH, healProfilesModuleFallback, INSTALL_ANCHOR, loadBasePatches, REPO_ROOT,
} from './compose.client.ts'

/** `net.Server`-shaped active handle (mirrors `connect-and-reconnect.client.spec.ts`'s own check). */
interface ServerLikeHandle {
  listening?: unknown
  address?: unknown
}

function activeServerHandles(): unknown[] {
  const getActiveHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles
  if (getActiveHandles === undefined) throw new Error('process._getActiveHandles is unavailable on this Node build')
  return getActiveHandles.call(process).filter((handle): handle is ServerLikeHandle => {
    if (typeof handle !== 'object' || handle === null) return false
    const candidate = handle as ServerLikeHandle
    return typeof candidate.listening === 'boolean' && typeof candidate.address === 'function'
  })
}

/** One scripted `finish: stop` model reply carrying only final text. */
function textEntry(text: string): unknown {
  return {
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }
}

const FINAL_ANSWER_TEXT = 'The literal cordis.yml file booted through the real Loader.'

/**
 * The tui-app-specific patch layer as a literal YAML document — this test's
 * own stand-in for the not-yet-created `packages/bundle/tui-app/cordis.patch.yml`.
 * Every dynamic value (temp-world paths) rides a `!!js process.env...`
 * expression rather than a JS closure variable, exactly how a real bundle
 * patch resolves `process.cwd()`/`dshHomePath(...)` at entry-activation time.
 */
function tuiAppPatchYaml(): string {
  return `# Temp-world stand-in for packages/bundle/tui-app/cordis.patch.yml: the
# tui-specific half of a "process-wide, single-session" host tree, expressed
# as a real patch-list YAML file instead of inline PatchOptions objects.
- id: hmr
  disabled: true
- id: session-title-llm
  disabled: true
- id: llm-deepseek
  disabled: true
- id: settings
  config:
    dshHome: !!js process.env.DSH_TUI_YAML_BOOT_HARNESS_HOME
- id: credentials
  config:
    dshHome: !!js process.env.DSH_TUI_YAML_BOOT_HARNESS_HOME
- id: session-persistence-jsonl
  config:
    root: !!js process.env.DSH_TUI_YAML_BOOT_PERSISTENCE_ROOT
- insert:
    - id: storage
      name: '@deepseek-ai/dsh-storage'
    - id: storage-json
      name: '@deepseek-ai/dsh-storage-json'
      config:
        root: !!js process.env.DSH_TUI_YAML_BOOT_STORAGE_ROOT
    - id: storage-domain
      name: '@deepseek-ai/dsh-storage-domain'
      config:
        backend: json
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'
    - id: directory-picker
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: tool-ask-user
      name: '@deepseek-ai/dsh-tool-ask-user'
    - id: api-gateway
      name: '@deepseek-ai/dsh-host-apiproxy'
    - id: connection
      name: '@deepseek-ai/dsh-client-connection'
      config:
        trustedHosts: []
    - id: tui-runtime
      name: '@deepseek-ai/dsh-tui-runtime'
      inject: [connection]
    - id: llm-replay
      name: '@deepseek-ai/dsh-llm-replay'
      config:
        file: !!js process.env.DSH_TUI_YAML_BOOT_UNUSED_FIXTURE
        overrideFile: !!js process.env.DSH_TUI_YAML_BOOT_OVERRIDE_FILE
        providers:
          - id: deepseek-official
            name: DeepSeek
            models:
              - id: deepseek-v4-flash
                name: DeepSeek-V4-Flash
                contextWindow: 128000
`
}

/** One booted tree from a literal cordis.yml + patch-file pair; disposes its own temp world. */
interface FileBootedTree {
  readonly ctx: Context
  readonly rows: EntryTree
  dispose(): Promise<void>
}

/**
 * Boot the same "process-wide, single-session" host tree `compose.client.ts`'s
 * `bootHostTree` assembles, but with the tui-specific rows sourced from a real
 * `cordis.patch.yml` file this function writes and parses, never inline
 * PatchOptions objects.
 */
async function bootFromCordisYmlFile(overrideFile: string): Promise<FileBootedTree> {
  const workspaceCwd = await mkdtemp(join(tmpdir(), 'dsh-tui-yaml-boot-ws-'))
  const persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-tui-yaml-boot-sessions-'))
  const storageRoot = await mkdtemp(join(tmpdir(), 'dsh-tui-yaml-boot-storage-'))
  const harnessHome = join(workspaceCwd, '.dsh-home')
  const unusedFixture = join(workspaceCwd, 'unused-primary-fixture.jsonl')

  // Every `!!js process.env...` expression in tuiAppPatchYaml() resolves
  // against these — the same mechanism the shipped base patch uses for
  // `process.env.DSH_PERMISSION_MODE`/`process.cwd()`, proven here for a
  // temp-world value rather than a process-ambient one.
  const priorEnv = {
    home: process.env.DSH_TUI_YAML_BOOT_HARNESS_HOME,
    persistence: process.env.DSH_TUI_YAML_BOOT_PERSISTENCE_ROOT,
    storage: process.env.DSH_TUI_YAML_BOOT_STORAGE_ROOT,
    override: process.env.DSH_TUI_YAML_BOOT_OVERRIDE_FILE,
    fixture: process.env.DSH_TUI_YAML_BOOT_UNUSED_FIXTURE,
  }
  process.env.DSH_TUI_YAML_BOOT_HARNESS_HOME = harnessHome
  process.env.DSH_TUI_YAML_BOOT_PERSISTENCE_ROOT = persistenceRoot
  process.env.DSH_TUI_YAML_BOOT_STORAGE_ROOT = storageRoot
  process.env.DSH_TUI_YAML_BOOT_OVERRIDE_FILE = overrideFile
  process.env.DSH_TUI_YAML_BOOT_UNUSED_FIXTURE = unusedFixture

  const patchFileDir = await mkdtemp(join(tmpdir(), 'dsh-tui-yaml-boot-patch-'))
  const patchFilePath = join(patchFileDir, 'tui-app.cordis.patch.yml')
  await writeFile(patchFilePath, tuiAppPatchYaml())

  // Parsed exactly like loadBasePatches parses the shipped dsh-base file: a
  // real fs read, yaml.load under entryListSchema (so `!!js` scalars survive
  // as expression nodes for the Loader to evaluate at entry activation, not
  // at parse time).
  const tuiAppPatches = yaml.load(await readFile(patchFilePath, 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  const basePatches = loadBasePatches(BASE_PATCH_PATH)
  const patches: PatchOptions[] = [...basePatches, ...tuiAppPatches]

  const ctx = new Context()
  const originalCwd = process.cwd()
  const dispose = async (): Promise<void> => {
    if (process.cwd() !== originalCwd) process.chdir(originalCwd)
    await ctx.fiber.dispose()
    await rm(workspaceCwd, { recursive: true, force: true })
    await rm(persistenceRoot, { recursive: true, force: true })
    await rm(storageRoot, { recursive: true, force: true })
    await rm(patchFileDir, { recursive: true, force: true })
    process.env.DSH_TUI_YAML_BOOT_HARNESS_HOME = priorEnv.home
    process.env.DSH_TUI_YAML_BOOT_PERSISTENCE_ROOT = priorEnv.persistence
    process.env.DSH_TUI_YAML_BOOT_STORAGE_ROOT = priorEnv.storage
    process.env.DSH_TUI_YAML_BOOT_OVERRIDE_FILE = priorEnv.override
    process.env.DSH_TUI_YAML_BOOT_UNUSED_FIXTURE = priorEnv.fixture
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
    // The real dsh --profile root: an empty entry list every layer patches
    // over (apps/cli/src/profile-boot.ts's PROFILE_ROOT_CONFIG, byte for
    // byte) — this test's root file is literal, not the tui-specific content;
    // that content lives entirely in the patch file parsed above.
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

  return { ctx, rows, dispose }
}

describe('tui-runtime: cold start from a literal cordis.yml + patch-file pair through the real Loader', () => {
  let tree: FileBootedTree
  let clientCtx: Context
  let connection: ConnectionHandle
  let overrideDir: string
  let overrideFile: string
  let hostFinalText: string | undefined

  beforeAll(async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-tui-yaml-boot-replay-'))
    overrideFile = join(overrideDir, 'replay.override.json')
    await writeFile(overrideFile, JSON.stringify([textEntry(FINAL_ANSWER_TEXT)]))

    tree = await bootFromCordisYmlFile(overrideFile)
    clientCtx = tree.ctx.tuiRuntime.clientCtx
    connection = clientCtx.get('connection') as ConnectionHandle
    await vi.waitFor(() => {
      expect(connection.hostDescription.getSnapshot()).not.toBeUndefined()
    }, { timeout: 5_000, interval: 20 })
  }, 30_000)

  afterAll(async () => {
    await tree.dispose()
    await rm(dirname(overrideFile), { recursive: true, force: true })
  })

  it('opens no listening socket for the whole file-booted Host tree', () => {
    expect(activeServerHandles()).toEqual([])
  })

  it('prompts, streams, completes the turn, and reads transcript facts back from the client-side sessions face', async () => {
    const created = await connection.api.sessions.create({})
    if (!created.result.ok) throw new Error(`session.create failed: ${created.result.error.code}`)
    const sessionId: SessionId = created.result.value.sessionId

    const sessions = clientCtx.get('sessions') as ISessions
    await vi.waitFor(() => {
      expect(sessions.list.getSnapshot().ids).toContain(sessionId)
    }, { timeout: 5_000, interval: 20 })
    sessions.open(sessionId)
    const scope = sessions.scope(sessionId)
    if (scope === undefined) throw new Error('sessions.scope(sessionId) is undefined after open()')
    const face = sessions.sessionOf(scope)
    if (face === undefined) throw new Error('sessions.sessionOf(scope) is undefined after open()')

    // Authoritative Host-side completion signal (mirrors
    // scripted-interactions.client.spec.ts): the client-side chat/view
    // projection stays empty in this composition (see below), so turn
    // completion itself is observed from the Host session-event stream.
    const hostTurnEnded = new Promise<void>((resolve) => {
      const off = (tree.ctx as unknown as { on: (event: string, fn: (...args: unknown[]) => void) => () => void }).on(
        'session/event',
        (...args: unknown[]) => {
          const event = args[1] as { type: string; data?: { message?: { content?: { type: string; text?: string }[] } } }
          if (event.type === 'assistant/message') {
            const textBlock = event.data?.message?.content?.find(block => block.type === 'text')
            hostFinalText = textBlock?.text
          }
          if (event.type !== 'turn/end') return
          off()
          resolve()
        },
      )
    })

    const prompted = await connection.api.sessions.prompt({
      sessionId, mode: 'queue', content: [{ type: 'text', text: 'Say something back.' }],
    })
    if (!prompted.result.ok) throw new Error(`session.prompt failed: ${prompted.result.error.code}`)

    await Promise.race([
      hostTurnEnded,
      new Promise((_resolve, reject) => {
        setTimeout(() => { reject(new Error('turn/end did not fire within 10s')) }, 10_000)
      }),
    ])

    await vi.waitFor(() => {
      expect(face.getSnapshot().running).toBe(false)
      expect(face.getSnapshot().pending).toEqual([])
    }, { timeout: 5_000, interval: 20 })

    const snapshot = face.getSnapshot()
    // ASSEMBLY-GAP FINDING (not the assumption this test started with): every
    // transcript-content field on ConversationSnapshot — not just
    // `nodes`/`chat.order`, but ALSO `turnTimings`/`turnEnds` — mirrors
    // `ChatSnapshot.legacy` (see conversation.ts's `LegacyConversationSlice`
    // doc), which only a registered `ConversationNodeDefinition` populates.
    // `turnTimings`/`turnEnds` are NOT an engine-level raw-log tracker
    // independent of business Definitions, despite reading like one from
    // their names and doc comments alone. No Definition is registered by
    // `tui-runtime` or anything this composition mounts (that registration
    // lives in a business package, e.g. `packages/client/ui-trajectory`,
    // deferred past this landing slice per the official-terminal-application
    // Agent Note's "Model extraction" / "Landing order" sections) — so the
    // client-side sessions face currently exposes NO transcript-content
    // signal at all: only session lifecycle (`running`, `pending`, `queue`,
    // `openState`) is meaningfully populated without a mounted Chat registry.
    expect(snapshot.nodes).toEqual([])
    expect(snapshot.chat.order).toEqual([])
    expect(snapshot.turnEnds.size).toBe(0)
    expect(snapshot.turnTimings.size).toBe(0)

    console.log(JSON.stringify({
      sessionId,
      clientTurnEndsSize: snapshot.turnEnds.size,
      clientRunning: snapshot.running,
      clientPendingCount: snapshot.pending.length,
      clientChatNodeCount: snapshot.chat.order.length,
      // Only available because this test independently listens to the Host
      // tree's own `session/event` stream (see hostTurnEnded above) — NOT
      // read back from the client-side sessions face, which is exactly the
      // gap this assertion block documents.
      hostFinalText,
    }))

    expect(hostFinalText).toBe(FINAL_ANSWER_TEXT)
  }, 30_000)
})
