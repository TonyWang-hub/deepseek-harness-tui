# tui/ — 终端应用

[English](README.md) | 中文

交互式终端应用使用 Web GUI 的同一套客户端数据层（`packages/client/*`）。`runtime/` 引导进程内 Client 树，`ink-ui/` 负责渲染，[`@deepseek-ai/dsh-tui-app`](../bundle/tui-app/README.md) 则交付 `dsh --profile tui` 组合。

| 包 | 职责 | ctx key |
|---|---|---|
| [`runtime/`](runtime/README.md) | 双 Context 引导：在 Host 树的 Connection 传输之上挂载一个进程内 Client cordis Context | `tuiRuntime` |
| [`ink-ui/`](ink-ui/README.md) | Ink/React 19 终端渲染器：scrollback 提交、有界活动区、多行输入、审批/提问提示与终端模拟器快照 | 无 |

runtime 在真实 TTY 上挂载渲染器；TUI 应用 bundle 负责 profile 启动与进程退出。
