# Agent Note: `dsh-tui-runtime` 通过 `./conversation-nodes` Node 伴生触达 Chat 业务 Definition

Status: implemented

[English](2026-08-15-tui-conversation-nodes-node-companion.md) | 中文

## Problem

`packages/tui/runtime` 的双 Context 启动流程通过各自的 `./client-node` Node ESM 伴生挂载 `connection`、Typert registry、Typert Remote 与 client Runtime 对象层的 Client 半（见[官方终端应用](../../proposed/feature/2026-08-15-official-terminal-application.md)）。该 Runtime 对象层提供 `ctx.conversationEvents`/`ctx.conversationViews`——即 `ConversationNodeDefinition`/`ConversationViewDefinition` 填充的注册表——但整个装配从未向其中注册过任何内容。

`cordis-yml-file-boot.client.spec.ts` 直接证实了这一后果：`ConversationSnapshot` 上每一个 transcript 内容字段（`nodes`、`chat.order`、`turnTimings`、`turnEnds`）都镜像自 `ChatSnapshot.legacy`（`packages/client/runtime/src/client/sessions/conversation.ts` 的 `LegacyConversationSlice`），而这些字段只有注册过的 Definition 才会填充——它们并非独立于业务 Definition 之外的引擎级原始日志追踪器，尽管仅从名称与文档注释看容易误以为是。由于没有任何 Definition 被注册，一次经完整双 Context 启动的脚本化回合，client 侧 sessions face 只能暴露会话生命周期信息（`running`、`pending`、`queue`、`openState`）；该测试当时只能靠独立监听 Host 树自身的 `session/event` 流才能取回最终 assistant 文本，而这绝非真实终端渲染器会读取的路径。

Chat 业务 Definition 及其 `ChatSnapshotBuilder` target builder 早已存在且早已纯净——`packages/client/ui-conversation/src/client/conversation-nodes/`（`register.ts` 及其导入的每个模块）与 `packages/client/ui-conversation/src/client/contract/chat-nodes.ts` 不携带任何 `.tsx`/React 导入。该包其余部分并不纯净：`src/client/apply.ts` 与 `./client` 入口所转出的 `src/client/index.ts` 都会触达 `.tsx` 组件（`InputBar`、`ChatView` 等），二者都无法在纯 Node 下加载。

## Decision

`dsh-client-ui-conversation` 新增 `./conversation-nodes` 导出子路径，仅将 `conversation-nodes` 子树的编译入口点（`register.ts`，导出 `registerConversationNodes`）以纯 Node ESM 模块形式发布——绝非该包的 `./client` 入口或包根，二者都会触达 React 闭包。该子路径的 `types` target 指向 `lib/types/client/conversation-nodes/register.d.ts`（既有 client 面 tsc pass 的产物）；其 `default` target 是一个新的 tsdown 伴生（`packages/client/ui-conversation/tsdown.config.ts` 中的 `conversationNodesCompanion`），构建方式与 `dsh-client-connection` 的 `clientNodeCompanion` 构建 `./client-node` 完全一致——ESM、`platform: 'node'`、不产出 dts、入口锁定到已产出的 `.js`，而非 `.ts` 源码。

`packages/tui/runtime/src/index.ts` 从 `@deepseek-ai/dsh-client-ui-conversation/conversation-nodes` 导入 `registerConversationNodes`，并在挂载 client Runtime 插件（`clientCtx.plugin(runtimeClient)`，正是它提供了 `ctx.conversationEvents`/`ctx.conversationViews`）之后立即直接对根 `clientCtx` 调用它。`registerConversationNodes` 把每一次注册的销毁都绑定到调用时所传入的那个 Context 的 `ctx.effect()` 上，因此直接对根 `clientCtx` 调用——而非另包一层 `ctx.plugin()`——就能让这些注册随整棵 client 树自身的拆卸（`clientCtx.fiber.dispose()`）一起销毁；对一个本身并非具名插件的普通函数而言，无需额外的插件作用域。

有两处全仓级别的 gate 需要与 `./client-node` 完全同形的豁免：`tsconfig.base.json` 新增一条 `@deepseek-ai/dsh-client-ui-conversation/conversation-nodes` 路径别名，直接解析到 `register.ts`（源码面解析，与其余每一条 `/client-node` 别名一致）；Typert 生成器的 `hostExportSubpaths`/`clientExportSubpaths`（`packages/typert/generator/src/analyzer.ts`）把 `./conversation-nodes` 与 `./client-node` 一视同仁——在 Host 面分析（其程序排除 `packages/client/*/src/**`）中排除，在 Client 面分析中纳入。

`cordis-yml-file-boot.client.spec.ts` 的脚本化回合断言现在直接从 client 侧 sessions face 读取最终 assistant 文本以及非空的 `nodes`/`chat.order`/`turnEnds`/`turnTimings`，取代了 ASSEMBLY-GAP finding 曾经要求的 Host `session/event` 流兜底方案。

## Alternatives considered

**抽取新包 `packages/client/conversation-model`**（`official-terminal-application` 笔记最初的"模型抽取"计划）——推迟，而非否决：把 `ChatSnapshotBuilder`、Chat Definition 与 `contract/chat-nodes.ts` 物理搬迁进一个平台中立包，是输入状态机与 popup select 控制器随之一并抽取时的最终形态，但这会牵动当前每一个消费 `dsh-client-ui-conversation` conversation-node 类型的调用点（含 `declare module` 增量类型），而这条落地纵切只需要一个能在纯 Node 下调用的函数。更窄的伴生方案以新增一个文件的成本交付同等能力，且不牵动包依赖图其余部分的导入路径；完整抽取仍可作为后续独立变更进行。

**把整个 `./client` 入口原样发布为 `./client-node`，完全复用既有模式**——否决：`src/client/index.ts`（该既有模式发布目标所对应的编译产物）转出了 `apply.ts`，其导入闭包会触达 `.tsx` React 组件。该既有模式自身的 analyzer 豁免注释已经说明了原因：Host 面程序排除 `packages/client/*/src/**`，同一个文件之所以能在 Client 面程序下正常解析，只是因为整个 client 半在别处已被证明浏览器安全——而这正是本包 `./client` 入口不具备的性质。

**把 `registerConversationNodes(clientCtx)` 包进它自己的 `clientCtx.plugin({ apply: registerConversationNodes })`**——否决：Definition 注册表内部的 `ctx.effect()` 早已把销毁绑定到调用者传入的那个 Context 上；直接对根 `clientCtx` 裸调用（与同一函数里既有的裸调用 `clientCtx.remote.$mount(commandsRemote)` 手法一致）能达到完全相同的生命周期耦合，且少一层间接——因为 `registerConversationNodes` 是普通函数，不是拥有自己 `apply`/`inject`/`name` 契约的具名插件。

## Consequences

经完整双 Context Loader 启动的脚本化回合，现在会在 client 侧 sessions face 上产出非空的 `ConversationSnapshot`——这正是终端渲染器真正会读取的形态——关闭了 `cordis-yml-file-boot.client.spec.ts` 记录的缺口。`./conversation-nodes` 子路径是纯增量：不改变任何既有导出，`dsh-client-ui-conversation` 的浏览器 bundle 不受影响（该伴生是共享同一份已产出 `lib/types` 产物的独立 tsdown 配置项）。"UI 插件的 `.` 导出保持封闭表面"这一包不变式（[packages/client/AGENTS.md](../../../../packages/client/AGENTS.md)）并不约束这次新增：新增的值导出是供另一个包（`dsh-tui-runtime`）消费的纯 Node 伴生子路径，而非拓宽面向 Loader 的 `.`/`./client` 入口所暴露的内容。

完整的"模型抽取"包搬迁仍是待办；落地时，本子路径要么变成对新包的一层薄再导出，要么被淘汰、改为直接导入新包自身的 Node 伴生——无论哪种，`dsh-tui-runtime` 的调用点（`registerConversationNodes(clientCtx)`）预期都只是一行改动。
