# `@deepseek-ai/dsh-tui-app`

English | [中文](README.zh.md)

The dsh terminal bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it supplies the coding persona and tool mode, disables HMR (same reasoning as the headless and web bundles), and mounts the terminal-specific rows this app needs — Code Mode's worker, the storage/workspace rows and directory-picker backend [`ApiProxyService`](../../host/apiproxy/README.md) requires, `ask_user_question` (present in every shipped agent preset but never at `dsh-base`'s own top level), the [API gateway](../../host/apiproxy/README.md), Connection's Host half ([`dsh-client-connection`](../../client/connection/README.md)), this app's `tui-startup` command-line provider, [`dsh-tui-runtime`](../../tui/runtime/README.md)'s dual-context bootstrap, and this package's own `tui-runner` process owner. `dsh-base`'s own agent-plane rows (`tool-bash`, `tool-fs`, `skill-filesystem`, `plan-mode`, subagents, …) stay exactly as base composes them: base keeps that plane process-wide for the terminal, the same way it does for the headless bundle — the Web surface is what disables it, behind per-session agent presets. It mounts no HTTP server or browser plugin: the terminal reaches the same object layer the Web GUI runs through an in-process connection, never a listening socket.

`tui-runtime` bridges a second, in-process Client cordis `Context` onto the Host tree's Connection in-process transport and, under a real TTY `stdout`, mounts the terminal renderer ([`dsh-tui-ink-ui`](../../tui/ink-ui/README.md)'s `mountTuiRenderer`) over it. This bundle's own `tui-runner` row is the one plugin that decides what the process does once that bootstrap is ready: on a real terminal it waits for the mounted renderer to exit (normal exit, Ctrl-C, or an uncaught exception unwinding through Ink) and requests process exit through the launcher-provided `ctx.appExit` host hook ([`dsh-cmdline`](../../boot/cmdline/README.md)); a non-TTY invocation (piped, CI, or any process with no terminal attached) mounted no renderer, which is a genuine misconfiguration for this profile, so `tui-runner` fails loud instead of hanging forever. The app's own `tui-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs`, parses `dsh --profile tui`'s `--resume <sessionId>` flag and `--help`, and provides `tuiStartup`; the `tui-runtime` row injects that service and reads `resumeSessionId` from lazy config, opening the named existing session instead of creating a fresh one.

## Model Experience

None, as this bundle mounts no additional model-visible prompt section or tool; the base and terminal-renderer rows own the model-facing surface.

#### KV Cache effect

None; this bundle adds nothing to the request prefix.

## Known Limitations and Deferred Work

- **`--resume` opens a session without backfill** — `mountTuiRenderer`'s own MVP limitation carries through unchanged: nodes already in the resumed session at mount time are the committed baseline and are never replayed into scrollback (no `/history` pager or tail rebase in this cut; see the [terminal-renderer-MVP Agent Note](../../../.agents/notes/implemented/feature/2026-08-15-tui-terminal-renderer-mvp.md)).
- **`ctx.appExit` is launcher-owned** — booting the tui profile outside the `dsh` launcher fails loud at activation until the host provides the exit request.
- **No web management surface** — this bundle opens no listening socket by design; a deployment that also wants the browser GUI runs a separate `dsh --profile web` process.
