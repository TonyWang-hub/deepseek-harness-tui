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

## Known Limitations and Deferred Work

- **No renderer yet** — this package ships the dual-context bootstrap only; `packages/tui/ink-ui` (rendering, input, live region) and `packages/bundle/tui-app` (the shipped `dsh --profile tui` composition) are later cuts in the same landing-order plan.
- **`ctx.tuiRuntime.clientCtx` is the whole Client `Context`, not a narrower facade** — the eventual renderer's exact needs are not yet fixed; narrowing ahead of a real second consumer would guess at a contract this package cannot yet justify.
- **Tests resolve every Client package through its built `lib/client-node.js`** — `apply()` mounts `@deepseek-ai/dsh-client-connection/client-node` and its siblings by package specifier, which Node resolves to the built companion, never `src`. Editing a Client package's `src` and running this package's tests without first running `pnpm run build:lib:client` exercises the stale built output, not the edit.
