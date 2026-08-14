# tui/ — terminal application

English | [中文](README.zh.md)

The official interactive terminal application, over the same client data layer the Web GUI runs (`packages/client/*`). See the [official-terminal-application Agent Note](../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md) for the landing-order plan.

| Package | Role | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | Dual-context bootstrap: mounts an in-process Client cordis Context over the Host tree's Connection transport | `tuiRuntime` |

No renderer ships yet: `runtime/` is the landing-order slice that proves the dual-context boot, the in-process Connection handshake, and the pending-interaction carrier before any Ink UI or bundle exists.
