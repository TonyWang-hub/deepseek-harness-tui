# DeepSeek Harness TUI

[English](README.md) | 中文

**DeepSeek Harness TUI** 是完整的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 智能体框架，外加一张进程内的终端脸：同一个 Node 进程、完整的插件运行时，以及一个消费 Web UI 同一套客户端核心的终端客户端——不重复实现任何协议，终端模式下不监听任何 socket。

> **非官方社区产品。** 本项目与 DeepSeek 无隶属或背书关系。它跟踪上游 MIT 许可的 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，并在其上承载终端工作。上游 harness 能做的一切本仓库原样可用——Web UI、headless 运行、ACP 与插件生态全部不变。

## 为什么是进程内

现有的 harness 终端客户端都是外挂协议客户端：在 SDK/ACP 线协议上重复实现会话语义、随上游变更漂移、无法承载进程内插件贡献。本项目改为在 **harness 进程内部**挂载第二棵 client cordis Context，经进程内 fetch 载体接通 host：

```text
┌─ one Node process ───────────────────────────────────────────┐
│  Host Context: agents, sessions, tools, LLM, gateway         │
│        │  connection.inProcessHandler()   (no socket, no WS) │
│  Client Context: connection + Typert Remote + client runtime │
│        │  pending-interaction carrier (questions, approvals) │
│  Terminal renderer (Ink) — in development                    │
└──────────────────────────────────────────────────────────────┘
```

因为终端消费的是共享的 TypeScript 客户端核心，与 Web 面的能力对等是结构性的而非愿望性的：同一个 host、同样的工具、同样的会话、同样的审批与问题载体。

## 现状

| 层 | 状态 |
|---|---|
| 进程内载体：generation 持有的事件流、中止契约、泛型 channel 路由、webServer 可选 | ✅ 已交付——28 个对抗性回归测试，经真实 DeepSeek API 验证 |
| 双 Context 终端运行时（`packages/tui/runtime`）：零 socket 启动、跨 host 重组重连、经 pending 载体完成 ask-user 与审批 | ✅ 已交付 |
| 客户端核心的 Node ESM 发布面（`./client-node` companions） | ✅ 已交付 |
| 终端渲染器（Ink）：scrollback 提交 + 有界活动区 | 🚧 下一步 |
| 开箱即用的 `tui` profile（`dsh --profile tui`） | 🚧 下一步 |
| `/history` 分页器、client runtime tail rebase、长会话性能门 | 🗺 路线图 |

设计记录见[终端应用 Agent Note](.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md)。

## 快速开始（开发）

```sh
pnpm install
pnpm run build:lib:host && pnpm run build:lib:client
pnpm exec vitest run packages/tui/runtime    # dual-context slice, keyless
pnpm dsh web                                 # the full harness Web UI, unchanged
```

导出 `DEEPSEEK_API_KEY` 后，真模型冒烟测试用真实 API 验证终端组合：

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/tui/runtime/tests/real-model-smoke.e2e.ts
```

## 运行

完整 harness 按上游出厂形态原样运行。参见 [Web UI 指南](docs/user/guide/index.md)。

### 从源码运行

```sh
git clone https://github.com/TonyWang-hub/deepseek-harness-tui.git
cd deepseek-harness-tui
pnpm install
pnpm run build
pnpm dsh web
```

## 与上游的关系

本仓库是跟踪型 fork：定期合入上游 `master`，终端工作集中在 `packages/tui/*`、`packages/client/connection` 与 `packages/host/apiproxy`，让每次同步保持小巧。这对 `README.md` 归 fork 所有（合并策略：ours）。其余一切——架构、约定、gate、文档——都是上游项目的原样：从 [docs/architecture.md](docs/architecture.md) 与 [docs/development.md](docs/development.md) 开始，智能体请循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)，与上游一致。DeepSeek Harness 由 [DeepSeek AI](https://deepseek.com) 开发；本 fork 增加终端应用及其配套载体工作。第三方依赖及其许可证披露于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
