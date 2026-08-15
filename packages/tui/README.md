# tui/ — terminal application

English | [中文](README.zh.md)

The interactive terminal application uses the same client data layer as the Web GUI (`packages/client/*`). `runtime/` boots the in-process Client tree, `ink-ui/` renders it, and [`@deepseek-ai/dsh-tui-app`](../bundle/tui-app/README.md) ships the `dsh --profile tui` composition.

| Package | Role | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | Dual-context bootstrap: mounts an in-process Client cordis Context over the Host tree's Connection transport | `tuiRuntime` |
| [`ink-ui/`](ink-ui/README.md) | Ink/React 19 terminal renderer: scrollback commit, bounded live region, multiline input, approval/question prompts, and terminal-emulator snapshots | none |

The runtime mounts the renderer on a real TTY; the TUI app bundle owns profile startup and process exit.
