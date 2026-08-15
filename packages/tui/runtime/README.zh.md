# @deepseek-ai/dsh-tui-runtime

[English](README.md) | 中文

终端应用的双 Context 引导：在 Host 树的 Connection 进程内传输之上挂载第二个进程内 Client cordis `Context`，并以 `ctx.tuiRuntime` 发布给终端渲染器（后续包）使用。落地顺序见[官方终端应用 Agent Note](../../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md)。

## 为什么一个进程里要有两个 cordis Context

`connection`、`sessions`、`loader` 在 Host 与 Client 两侧是同名但实现不同的服务；同一个 key 第二次 `ctx.provide()` 会在运行时抛出。因此终端组合让一个 Node 进程持有两棵根 cordis `Context`：Host 树（产品组合——session、agent、工具、ApiProxy……）与 Client 树（Web GUI 所用的同一套对象层，无浏览器依赖）。本包就是桥接两者的 Host 树插件行。

## 它挂载了什么

给定 `ctx.connection`（`@deepseek-ai/dsh-client-connection` 的 Host 半区，提供 `inProcessHandler()`），`apply()`：

1. 新建一个 Client `Context`。
2. 在其上 provide `clientConnectionInProcessTransport`——取自 `ctx.connection.inProcessHandler().fetch` 的 `{ fetch }`。
3. 依次挂载 Connection、Typert 注册表、Typert Remote 的 Client 半区，一个生成的 Remote 贡献（`@deepseek-ai/dsh-commands/remote`），以及 Client Runtime 对象层——全部通过它们的 `/client-node` Node ESM 伴生产物（纯 Node ESM，不带 `window.__ModuleLoader__` 包装），绝不通过各自的包根。
4. 把挂载好的 Client `Context` 以 `ctx.tuiRuntime.clientCtx` 的形式 provide 出去。

Client 树的生命周期是本插件 fiber 的一个 effect：卸载 Host 行（卸载、HMR 重载、进程关闭）会一并释放 Client 树，绝不独立存在。

## 设计上不触碰 Host 半区的类型合并

本包从不 import 任何 Host 半区包的根导出（`@deepseek-ai/dsh-host-apiproxy`、`@deepseek-ai/dsh-agent` 等）——每一个都带着自己对某个 Host-only 服务的 `declare module '@deepseek-ai/cordis'` 类型合并。导入其中任何一个都会把该合并带进本包的 TypeScript 程序里；而本包按 Client 聚合（`tsconfig.client.json`）做类型检查，尽管这个插件在运行时是挂在 Host 树里的。本包唯一调用的 Host 成员——`connection.inProcessHandler()`——是通过包内定义的窄结构类型 `HostConnectionLike` 与 `ctx.get('connection')` 触达的，绝不通过声明式注入或 Context 合并。

## `ctx.tuiRuntime`

```ts
import type { Context } from '@deepseek-ai/cordis'

interface TuiRuntimeHandle {
  readonly clientCtx: Context
}
```

后续的渲染器包直接读取 `clientCtx` 的各项服务（`ctx.sessions`、`ctx.workspaces`、`ctx.connection`）——本包发布整个 Client `Context`，而不是一个更窄的门面，因为目前还没有真正的消费者能为收窄这个契约提供依据。

## 配置

- `render`（默认 `true`）——在 Client 树就绪后挂载终端渲染器，以真实 TTY `stdout` 为门槛（管道/CI 进程或测试环境没有终端可渲染，所以本插件在那种情况下悄悄跳过挂载，而不是把 `render` 当作未设置处理）。
- `resumeSessionId`（可选）——打开一个既有会话而不是新建一个（`dsh --profile tui --resume <sessionId>`）。原样传给 `mountTuiRenderer` 的 `MountOptions.sessionId`，在这一个点上打上品牌；`mountTuiRenderer` 自身的 MVP 限制依旧成立——挂载时会话里已有的节点是已提交的基线，绝不会被回放进 scrollback。

## 性能门

`tests/perf/` 是终端应用的性能门：一个确定性的合成长会话语料生成器，加上四个基准分片。它们在默认测试 lane 之外（命名为 `*.perf.client.ts` 而非 `*.spec.ts`），通过自带的配置运行。

```sh
# One shard at a time — each boots a real host tree over a ~30 MB corpus.
pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts corpus-generation
pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts prompt-ready
pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts input-to-echo
pnpm exec vitest run --config packages/tui/runtime/tests/perf/vitest.perf.config.ts resident-state
```

| 分片 | 度量 | Agent Note 门槛 |
|---|---|---|
| `corpus-generation` | 语料规模、形态与逐字节可复现性 | ≥100k 事件，确定性 |
| `prompt-ready` | 冷/热启动到 composer 可输入的耗时，以及 resume 载入历史的耗时，对照全新会话的控制组 | 每次运行如实报告 |
| `input-to-echo` | 按键回显延迟，240 次采样，p50/p95/p99 | p50 ≤20 ms，p95 ≤50 ms |
| `resident-state` | 稳态 RSS 与不挂渲染器的 headless 基线之差、Ink 树高度、client 侧驻留量 | RSS 增量上限、驻留事件上限 |

语料（`corpus.client.ts`）由固定种子生成——消息 id、时间戳以及每一处形态决策都取自同一条带种子的伪随机流——因此两次生成的字节完全一致，测到的回归就是渲染器的回归，而不是语料差异。在 100k 事件目标下它约 30 MB，因此是缓存而非入库：首次运行把它连同已灌入语料的持久化根一起写到 `node_modules/.cache/dsh-tui-perf/`（可用 `DSH_TUI_PERF_CORPUS_DIR` 覆盖），之后的运行复用两者。删掉该目录即可强制重新生成。

渲染器挂载在受控的 TTY 流上，而不是终端模拟器：这里的每一项指标都是"渲染器写了什么、何时写"的属性，而在链路里放一个模拟器只会把它自己的解析开销加进每一次延迟采样。语义化的终端投影属于快照 lane。

各分片把实测值与 Agent Note 的门槛并列成表，只断言结构性事实（确实 resume 了真实语料、尾窗确实约束住了 client 侧驻留事件、Ink 树里没有历史）。以墙钟时间做强制门槛属于固定配置的 CI runner，不属于开发机。

## Known Limitations and Deferred Work

- **尚无渲染器** ——本包只交付双 Context 引导；`packages/tui/ink-ui`（渲染、输入、实时区域）与 `packages/bundle/tui-app`（发行的 `dsh --profile tui` 组合）是同一落地顺序计划里的后续几刀。
- **`ctx.tuiRuntime.clientCtx` 是整个 Client `Context`，而不是更窄的门面** ——最终渲染器的具体需求尚未定型；在还没有第二个真实消费者之前收窄这个契约，只会是猜测。
- **本包测试经每个 Client 包已构建的 `lib/client-node.js` 解析，而非其 `src`** ——`apply()` 按包名挂载 `@deepseek-ai/dsh-client-connection/client-node` 及其同类，Node 会把它解析到已构建的伴生产物。改了某个 Client 包的 `src` 后若不先跑 `pnpm run build:lib:client` 就跑本包测试，跑的是陈旧产物，不是刚改的代码。
