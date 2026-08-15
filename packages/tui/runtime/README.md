# @deepseek-ai/dsh-tui-runtime

English | [中文](README.zh.md)

Dual-context bootstrap for the terminal application: mounts a second, in-process Client cordis `Context` over the Host tree's Connection in-process transport, and publishes it as `ctx.tuiRuntime` for a terminal renderer (a later package) to consume. See the [official-terminal-application Agent Note](../../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md) for the landing-order plan this package's slice belongs to.

## Why two cordis Contexts in one process

`connection`, `sessions`, and `loader` are Host and Client services under the same keys with different implementations; a second `ctx.provide()` of one key throws at runtime. A terminal composition therefore runs one Node process holding two root cordis `Context`s: the Host tree (the product composition — session, agent, tools, ApiProxy, …) and a Client tree (the same object layer the Web GUI runs, browser-free). This package is the Host-tree row that bridges them.

## What it mounts

Given `ctx.connection` (the Host half of `@deepseek-ai/dsh-client-connection`, providing `inProcessHandler()`), `apply()`:

1. Builds a fresh Client `Context`.
2. Provides `clientConnectionInProcessTransport` on it — `{ fetch }` from `ctx.connection.inProcessHandler().fetch`.
3. Mounts, in order, the Client halves of Connection, the Typert registry, the Typert Remote, one generated Remote contribution (`@deepseek-ai/dsh-commands/remote`), and the Client Runtime object layer — through their `/client-node` Node ESM companions (plain Node ESM, no `window.__ModuleLoader__` wrapper), never their package roots.
4. Provides the mounted Client `Context` as `ctx.tuiRuntime.clientCtx`.

The Client tree's lifecycle is one effect of this plugin's fiber: disposing the Host row (unmount, HMR reload, process shutdown) disposes the Client tree with it, never independently.

## Host-merge-free by design

This package never imports a Host-half package root (`@deepseek-ai/dsh-host-apiproxy`, `@deepseek-ai/dsh-agent`, …), each of which carries its own `declare module '@deepseek-ai/cordis'` augmentation for a Host-only service. Importing one would pull that augmentation into this package's TypeScript program, which type-checks under the Client aggregate (`tsconfig.client.json`) even though this plugin runs inside the Host tree at runtime. The one Host member this package calls — `connection.inProcessHandler()` — is reached through the package-local narrow structural type `HostConnectionLike` and `ctx.get('connection')`, never a declared injection or a Context merge.

## `ctx.tuiRuntime`

```ts
import type { Context } from '@deepseek-ai/cordis'

interface TuiRuntimeHandle {
  readonly clientCtx: Context
}
```

A later renderer package reads `clientCtx`'s services directly (`ctx.sessions`, `ctx.workspaces`, `ctx.connection`) — this package publishes the whole Client `Context` rather than a narrower facade, because no consumer exists yet to justify one.

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

- **No renderer yet** — this package ships the dual-context bootstrap only; `packages/tui/ink-ui` (rendering, input, live region) and `packages/bundle/tui-app` (the shipped `dsh --profile tui` composition) are later cuts in the same landing-order plan.
- **`ctx.tuiRuntime.clientCtx` is the whole Client `Context`, not a narrower facade** — the eventual renderer's exact needs are not yet fixed; narrowing ahead of a real second consumer would guess at a contract this package cannot yet justify.
- **Tests resolve every Client package through its built `lib/client-node.js`** — `apply()` mounts `@deepseek-ai/dsh-client-connection/client-node` and its siblings by package specifier, which Node resolves to the built companion, never `src`. Editing a Client package's `src` and running this package's tests without first running `pnpm run build:lib:client` exercises the stale built output, not the edit.
