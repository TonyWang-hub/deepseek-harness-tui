import type { UserConfig } from 'tsdown'
import { clientBundle } from '../tsdown.client.ts'

const id = '@deepseek-ai/dsh-client-ui-conversation'

/**
 * Node ESM publication of one pure subtree of the browser client half — the
 * Chat business Definitions and their `ChatSnapshotBuilder` target builder
 * (`src/client/conversation-nodes/`) — for a plain Node consumer, the
 * official TUI's `@deepseek-ai/dsh-tui-runtime`, imported through
 * `@deepseek-ai/dsh-client-ui-conversation/conversation-nodes`. This is
 * narrower than the `/client-node` companion pattern (see
 * `dsh-client-connection/tsdown.config.ts`): that pattern republishes the
 * SAME `lib/types/client/index.js` entry the browser bundle wraps, which this
 * package cannot do because `src/client/index.ts` re-exports `apply.ts`,
 * whose import closure reaches React components (`.tsx`). The
 * `conversation-nodes` subtree's own closure — `register.ts` plus every
 * module it imports — is proven React-free (see the tui-runtime module doc
 * for the verification this entry depends on), so its own compiled entry
 * point publishes safely on its own. Shares the primary Node library build's
 * shape (ESM, platform node, no dts — types ship from the shared
 * `lib/types/client/conversation-nodes/register.d.ts`); entry is the
 * client-face tsc pass's already-emitted `lib/types/client/conversation-nodes/register.js`,
 * not the `.ts` source, so this companion only runs after that pass, exactly
 * like the client bundle it sits beside.
 *
 * Its source files (assistant.ts, tool.ts, fallback.ts, turn-error.ts,
 * turn-tail.ts, command.ts) value-import `@deepseek-ai/dsh-client-runtime/client`
 * — the SAME specifier the browser bundle purity gate recognizes as an
 * inline-safe external (`RUNTIME_STORE_EXEMPTION` in `tsdown.client.ts`), so
 * the source cannot instead write `/client-node` without breaking that gate
 * for the browser build sharing these files. Under plain Node resolution
 * `/client` is client-runtime's own browser artifact (`window.__ModuleLoader__`-
 * wrapped CJS), which throws when `import()`ed directly. tsdown's own
 * dependency-externalization step resolves and marks package.json
 * dependencies external before any user `resolveId` plugin can intervene (it
 * does not run through the ordinary plugin pipeline), so the redirect below
 * uses Rolldown's `output.paths` instead — an output-only rename of an
 * already-external id's emitted specifier, applied after bundling decisions
 * are made. The import stays external (a real cross-package service
 * boundary, never inlined); only the string naming it in the compiled output
 * changes.
 */
const conversationNodesCompanion: UserConfig = {
  name: `${id}/conversation-nodes`,
  entry: { 'conversation-nodes-node': 'lib/types/client/conversation-nodes/register.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: {
    entryFileNames: 'conversation-nodes-node.js',
    paths: { '@deepseek-ai/dsh-client-runtime/client': '@deepseek-ai/dsh-client-runtime/client-node' },
  },
}

export default clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'], {
  companions: [conversationNodesCompanion],
})
