# @deepseek-ai/dsh-tui-runtime

English | [中文](README.zh.md)

Dual-context bootstrap for the terminal application: mounts an in-process Client cordis `Context` over the Host Connection transport, publishes it as `ctx.tuiRuntime`, and mounts the Ink renderer by default when `stdout` is a real TTY.

## Why two cordis Contexts in one process

`connection`, `sessions`, and `loader` are Host and Client services under the same keys with different implementations; a second `ctx.provide()` of one key throws at runtime. A terminal composition therefore runs one Node process holding two root cordis `Context`s: the Host tree (the product composition — session, agent, tools, ApiProxy, …) and a Client tree (the same object layer the Web GUI runs, browser-free). This package is the Host-tree row that bridges them.

## What it mounts

Given `ctx.connection` (the Host half of `@deepseek-ai/dsh-client-connection`, providing `inProcessHandler()`), `apply()`:

1. Builds a fresh Client `Context`.
2. Provides `clientConnectionInProcessTransport` on it — `{ fetch }` from `ctx.connection.inProcessHandler().fetch`.
3. Mounts, in order, the Client halves of Connection, the Typert registry, the Typert Remote, one generated Remote contribution (`@deepseek-ai/dsh-commands/remote`), and the Client Runtime object layer — through their `/client-node` Node ESM companions (plain Node ESM, no `window.__ModuleLoader__` wrapper), never their package roots.
4. Registers the Node ESM conversation-node definitions that populate `ConversationSnapshot`.
5. When `render` is true and `stdout` is a real TTY, mounts `mountTuiRenderer(clientCtx, options)`.
6. Provides `{ clientCtx, renderer? }` as `ctx.tuiRuntime`.

The renderer and Client tree share this plugin fiber's lifecycle; disposal tears down the renderer first, then the Client tree.

## Host-merge-free by design

This package never imports a Host-half package root (`@deepseek-ai/dsh-host-apiproxy`, `@deepseek-ai/dsh-agent`, …), each of which carries its own `declare module '@deepseek-ai/cordis'` augmentation for a Host-only service. Importing one would pull that augmentation into this package's TypeScript program, which type-checks under the Client aggregate (`tsconfig.client.json`) even though this plugin runs inside the Host tree at runtime. The one Host member this package calls — `connection.inProcessHandler()` — is reached through the package-local narrow structural type `HostConnectionLike` and `ctx.get('connection')`, never a declared injection or a Context merge.

## `ctx.tuiRuntime`

`TuiRuntimeHandle` exposes the bootstrapped Client `Context` as `clientCtx` and the optional `MountedTuiRenderer` as `renderer`. The shipped renderer reads `clientCtx` services directly; `renderer` is absent for headless or non-TTY compositions. The source interface in [`src/index.ts`](src/index.ts) owns the exact TypeScript declaration.

## Config

- `render` (default `true`) — mount the terminal renderer over the bootstrapped Client tree once ready, gated on a real TTY `stdout` (a piped/CI process or a test harness has no terminal to render into, so this plugin silently skips mounting rather than treating `render` as unset).
- `resumeSessionId` (optional) — an existing session id to open instead of creating a fresh one (`dsh --profile tui --resume <sessionId>`). Passed to `mountTuiRenderer`'s `MountOptions.sessionId` unchanged, branded at that single point; `mountTuiRenderer`'s own MVP limitation still applies — nodes already in the session at mount time are the committed baseline and are never replayed into scrollback.

## Performance gate

`tests/perf/` holds the terminal application's performance gate: a deterministic synthetic long-session corpus generator plus four benchmark shards, outside the default test lane (`*.perf.client.ts`, not `*.spec.ts`) and run through their own config.

```sh
# One shard at a time — each boots a real host tree over a ~30 MB corpus.
pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts corpus-generation
pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts prompt-ready
pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts input-to-echo
pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts resident-state
```

| Shard | Measures | Agent Note threshold |
|---|---|---|
| `corpus-generation` | corpus size, shape, and byte-for-byte reproducibility | ≥100k events, deterministic |
| `prompt-ready` | cold/warm time to a typable composer, plus the resume history load, against a fresh-session control | budgets stated per run |
| `input-to-echo` | keystroke echo latency, 240 samples, p50/p95/p99 | p50 ≤20 ms, p95 ≤50 ms |
| `resident-state` | steady-state RSS against a renderer-free headless baseline, Ink-tree height, and client retention | RSS delta cap, retained-event ceiling |

The corpus (`corpus.client.ts`) is generated from a fixed seed — message ids, timestamps, and every shape decision are drawn from one seeded PRNG — so two generations produce identical bytes and a measured regression is a renderer regression, not a corpus difference. It is ~30 MB at the 100k-event target, so it is cached rather than committed: the first run writes it and the seeded persistence root beside it under `node_modules/.cache/dsh-tui-perf/` (override with `DSH_TUI_PERF_CORPUS_DIR`), and later runs reuse both. Delete that directory to force regeneration.

The renderer mounts on controlled TTY streams, not a terminal emulator: every metric here is a property of what the renderer writes and when, and an emulator in the loop would add its own parse cost to each latency sample. Semantic terminal projection belongs to the snapshot lane.

The shards report measured values against the Agent Note's thresholds in a table and assert only structural facts (a real corpus was resumed, the tail window bounded the client's retained events, the Ink tree held no history). Wall-clock enforcement belongs on a pinned CI runner, not on a developer machine.

## Known Limitations and Deferred Work

- **Renderer mounting requires a real TTY** — `render` defaults to true, but a piped or CI process leaves `renderer` undefined; the shipped TUI profile treats that as a misconfiguration and exits.
- **`ctx.tuiRuntime.clientCtx` remains the whole Client `Context`** — the current renderer directly consumes its sessions and connection services; no narrower stable facade is defined.
- **Tests resolve every Client package through its built `lib/client-node.js`** — `apply()` mounts `@deepseek-ai/dsh-client-connection/client-node` and its siblings by package specifier, which Node resolves to the built companion, never `src`. Editing a Client package's `src` and running this package's tests without first running `pnpm run build:lib:client` exercises the stale built output, not the edit.
