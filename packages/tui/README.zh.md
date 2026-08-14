# tui/ — 终端应用

[English](README.md) | 中文

官方交互式终端应用，构建在 Web GUI 所用的同一套客户端数据层之上（`packages/client/*`）。落地顺序见[官方终端应用 Agent Note](../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md)。

| 包 | 职责 | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | 双 Context 引导：在 Host 树的 Connection 传输之上挂载一个进程内 Client cordis Context | `tuiRuntime` |

目前尚无渲染器：`runtime/` 是落地顺序中的第一刀，先证明双 Context 启动、进程内 Connection 握手与 pending 交互载体本身可用，再引入 Ink UI 或 bundle。
