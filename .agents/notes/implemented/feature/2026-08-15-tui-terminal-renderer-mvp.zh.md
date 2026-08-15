# Agent Note: 终端渲染器 MVP（D2.2）

Status: implemented

[English](2026-08-15-tui-terminal-renderer-mvp.md) | 中文

## Problem

`packages/tui/ink-ui` 此前只交付了 Ink/React 19 依赖孤岛与 Q1/Q2/Q3 侦察 PoC（D2.0）：没有渲染器、输入组件或活动区，[official-terminal-application Agent Note](../../proposed/feature/2026-08-15-official-terminal-application.md) 中的落地顺序计划因此还没有一个人可以坐下来实际使用的产物。`packages/tui/runtime`（D2.1）搭建了双上下文 Client 树的引导，但没有在其上挂载任何渲染器。

## Decision

`mountTuiRenderer`（`packages/tui/ink-ui/src/render.ts`）是渲染器的入口：给定一个已引导的 Client 树，它打开（或创建）一个会话的 `SessionFace`，订阅其 `ConversationSnapshot`，并直接基于三条 PoC 结论驱动三件事：

- **提交（Commit）**：每个超出上次已提交范围的已结束节点，其 `renderClosedNodeLines()`（`transcript/node-lines.ts`）结果通过 `console.log()`（`scrollback/commit.ts`）推入 scrollback——这是 Q1 已证实的机制，绝不是手写的 `clear()` + `stdout.write()`。宽度键控的 `RowCache`（`transcript/row-cache.ts`）对每次渲染做记忆化；在一次挂载内它永远不会命中（每个节点只提交一次），它的存在是为将来某个会以不同宽度重新渲染已提交节点的 `/history` 分页器准备的基础设施，不是为本次这一刀。
- **发布（Publish）**：`createPublicationScheduler`（`scheduler/publication-scheduler.ts`）以一个经过 schemastery 校验的 `publishRateFps`（默认 30）为 `'stream'` 类快照变化合帧，`'structural'`（一个待处理交互、一个 turn 边界、一个已关闭节点、瞬态收件箱）类变化立即发布；由于 `ObservableSnapshot.subscribe` 不携带原因载荷，`classifySnapshotUpdate`（`scheduler/classify-update.ts`）通过比较若干有界计数来区分两者。
- **控制（Control）**：`Composer.tsx` 是一个从零自研的多行输入（Q2 结论：没有任何维护中的 Ink 包覆盖非对称首行/续行前缀加 CJK 感知折行），构建在一个不依赖 Ink 的编辑模型之上（`input/edit-model.ts`、`input/layout.ts`）；Esc 通过 `SessionFace.cancel()` 取消当前回合；审批与问题通过 pending 载体自身的 `PendingWait.respond()`（`ApprovalPrompt.tsx`、`QuestionPrompt.tsx`）应答，绝不注册第二个 `UserQuestionProvider`/审批监听器；Ctrl-C 及其他一切退出路径都通过 Ink 自身的生命周期恢复终端（Q3 结论）——本模块自己从不调用 `process.exit()`。

工具卡（`transcript/tool-cards.ts`）覆盖了来自 `@deepseek-ai/dsh-tools/presentation` 的 `generic`（文档化的兜底形态，含 `read`/`search`/`web`——留待后续）、`terminal`（`sanitizeTerminalOutput` 剥离 OSC/DCS/光标控制序列，保留 SGR）与 `diff`（用 `diff` 包的 `diffLines`，是"精确改动行比对"而非整块替换）三种卡片。

`packages/tui/runtime` 将 Host Connection 与 ApiProxy 声明为硬注入，确保渲染器不会在进程内 API 就绪前发起初始会话 RPC。其 `Config.render`（默认 `true`）在 Client 树就绪后挂载渲染器，以真实 TTY `stdout` 为门槛；其生命周期折叠进拥有该 Client 树的同一个插件 fiber，先于该树被释放。

### 在这一确切的 Ink/React 版本组合下，`React.memo` 与 `useInput` 不兼容

`Composer.tsx`、`ApprovalPrompt.tsx` 与 `QuestionPrompt.tsx` 刻意**没有**包一层 `React.memo`。Ink 7.1.1 的 `useInput`（`ink/build/hooks/use-input.js`）依赖 React 的 `useEffectEvent` 来保证"处理函数总是看到最新闭包"。在本包锁定的确切版本组合（Ink 7.1.1、React 19.2.8）下，给一个自身持有 `useInput` 读取状态的组件包 `React.memo` 会破坏这一保证：第二次按键的处理函数调用观察到的是*第一次*渲染时的状态，而非已提交的最新状态——在把它归为框架交互问题而非本包自身的 bug 之前，已用一个脱离本包代码的最小 `useState` 计数器复现进行了确认。日后若要给一个持有 `useInput` 的组件重新加上 `React.memo`，须先针对当时的 Ink/React 版本重新验证。

### `mountTuiRenderer` 会等待会话出现在 `sessions.list` 中

`ISessions.open()` 在会话 id 尚未出现在客户端会话列表中时会抛出 `unknown session`，而该列表由一个 `host/session-added` 事件异步填充；该事件与 `session.create` RPC 响应经由同一连接到达，但两者到达时刻不同步。因此 `mountTuiRenderer` 在打开一个刚创建或调用方指定的会话之前会等待（`waitForSessionListed`，以经过校验的 `sessionListTimeoutMs` 为界，默认 5000）。Host runtime 还通过硬注入分别等待 Connection 与 ApiProxy，确保 `session.create` 不会在进程内 API 路由存在前运行。

## Alternatives considered

**按 D2.2 简报最初的设计意图（"settled 卡用 React.memo + 稳定 props"）给 `ApprovalPrompt`/`QuestionPrompt`/`Composer` 包一层 `React.memo`**——在发现失效 bug 后被否决：本设计中，已结束（关闭）节点从不会被渲染成 JSX（它们通过 `console.log` 以纯字符串形式提交进 scrollback），因此宽度键控的 `RowCache` 才是本次这一刀对该纪律的实际落实；*实时*交互组件的正确性优先于这一确切框架版本组合并不能安全支持的、纯属推测性的重渲避免优化。

**用重试延时循环规避 `bootHostTree` 的 session.create-during-boot 竞态**——被否决：这会掩盖一个潜在的 Loader/api-gateway 启动顺序隐患，而非修复或记录它；一个带受控 fetch 桩的直接 `ctx.plugin()` fixture 能提供等价的单元覆盖，且不会把隐患藏起来（见 Consequences）。

**在本次这一刀中就实现完整的 `/history` 备用屏分页器与恢复/尾部重建**——被否决，超出落地顺序计划中 D2.2 的范围；行缓存的存在只是前瞻性基础设施，挂载时已存在的节点是已提交基线（永不重放）。

## Consequences

这个终端渲染器是真实可用的代码，并有一个通过的 pty 驱动冒烟测试（`packages/tui/runtime/tests/pty-smoke.client.spec.ts`）：启动、输入 prompt、流式渲染、scrollback 中含有最终文本、Ctrl-C 恢复终端（用真实的 `stty -a` 验证，即 Q3 的手法）。`packages/tui/ink-ui/src` 与 `packages/tui/runtime/src` 两侧的逐文件覆盖率（含分支）均为 100%。

Host 启动关系是显式的：`tui-runtime` 仅在 Connection 与 ApiProxy 均处于激活状态时存在，并在两项依赖就绪后挂载 Client 树与渲染器。初始挂载时缺少 `session.create` 路由属于组合顺序错误，而不是瞬时传输状态；渲染器不会重试 HTTP 404 响应。若 ApiProxy 随后撤销，Cordis 会释放 TUI Client 树；正式 runner 将渲染器释放视为终端应用退出，而不会把普通新启动静默切换到另一个空白会话。

留给后续刀的已知延后工作：`read`/`search`/`web` 工具结果卡仍走通用兜底形态；`/history` 分页器与 client-runtime tail rebase 尚未构建（挂载时已存在的节点是已提交基线，永不重放——`--resume <sessionId>` 打开一个既有会话但不回填它之前的记录，见 [D2.3 Agent Note](2026-08-15-tui-app-bundle-composition.md)）；多段式 `ask_user_question` 只有第一个子问题可应答，没有 `options`（自由文本）的问题只显示一行提示而不接受输入；Shift+Enter 在 kitty 键盘协议之外用字面 `\n` 字节（Ctrl+J）代替。`packages/bundle/tui-app` 的正式 `dsh --profile tui` 组合（D2.3）已经在本渲染器之上出厂；本次这一刀自带的开发运行脚本（`packages/tui/runtime/tests/dev-run.manual.ts`）仍是一种可以直接练习渲染器本身的无密钥方式。
