# tui/ — terminal application

English | [中文](README.zh.md)

The official interactive terminal application, over the same client data layer the Web GUI runs (`packages/client/*`). See the [official-terminal-application Agent Note](../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md) for the landing-order plan.

| Package | Role | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | Dual-context bootstrap: mounts an in-process Client cordis Context over the Host tree's Connection transport | `tuiRuntime` |
| [`ink-ui/`](ink-ui/README.md) | Ink/React 19 dependency island; reconnaissance spike answering the scrollback-commit, multiline-input, and terminal-restoration design questions | none |

No renderer ships yet: `runtime/` is the landing-order slice that proves the dual-context boot, the in-process Connection handshake, and the pending-interaction carrier, and `ink-ui/` is the reconnaissance spike that answers three rendering-design questions in the Agent Note's "Risks" section before any renderer or bundle exists.
