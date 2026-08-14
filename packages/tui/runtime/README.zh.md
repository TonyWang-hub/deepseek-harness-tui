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

无。本包没有自己的部署可变调优项；它只是原样接好一个已有的 Config 表面（Connection 的、Runtime 的）。

## Known Limitations and Deferred Work

- **尚无渲染器** ——本包只交付双 Context 引导；`packages/tui/ink-ui`（渲染、输入、实时区域）与 `packages/bundle/tui-app`（发行的 `dsh --profile tui` 组合）是同一落地顺序计划里的后续几刀。
- **`ctx.tuiRuntime.clientCtx` 是整个 Client `Context`，而不是更窄的门面** ——最终渲染器的具体需求尚未定型；在还没有第二个真实消费者之前收窄这个契约，只会是猜测。
