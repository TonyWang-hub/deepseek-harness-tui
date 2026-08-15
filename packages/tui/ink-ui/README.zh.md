# @deepseek-ai/dsh-tui-ink-ui

[English](README.md) | 中文

终端应用的渲染器，构建在 Ink 7.1.1/React 19 依赖孤岛之上：`mountTuiRenderer`（`src/render.ts`）是唯一入口，负责打开或创建一个 session、订阅它的 `ConversationSnapshot`，并驱动三件事——提交（把已完成的 step 提交进真实终端 scrollback）、发布（对有界活动区做限速重绘）、控制（多行输入框、审批/提问弹窗、Esc 取消）——本包所落地的设计决策见[终端渲染器 MVP Agent Note](../../../.agents/notes/implemented/feature/2026-08-15-tui-terminal-renderer-mvp.md)，本包在落地顺序计划中所处的位置见[官方终端应用 Agent Note](../../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md)。

## 模块结构

- `render.ts` —— `mountTuiRenderer`，把一个 session 的 `SessionFace` 接到发布调度器、行缓存以及已挂载的 Ink `App` 上。
- `config.ts` —— `RendererConfig`，经 schemastery 校验的 `publishRateFps`（默认 30）与 `sessionListTimeoutMs`（默认 5000），以及 `resolveRendererConfig`。
- `scheduler/` —— `publication-scheduler.ts`（`PublicationScheduler`，把 `'stream'` 重绘限速在 `publishRateFps` 节奏内，同时立即发布 `'structural'` 重绘）与 `classify-update.ts`（`classifySnapshotUpdate`，靠比较快照的有界计数来区分这两类）。
- `scrollback/` —— `commit.ts`（`commitToScrollback`，走 `console.log()`/`patchConsole` 这条提交路径）。
- `activity/` —— `activity-model.ts`（`buildActivityModel`，有界实时视图：流式尾部、运行中的工具、待处理交互、队列计数）。
- `transcript/` —— `node-lines.ts`（已关闭节点的渲染）、`tool-cards.ts`（`generic`/`terminal`/`diff` 工具结果卡片）、`content-text.ts`（两者共用的内容块展平）、`row-cache.ts`（按宽度分键的 `RowCache`）。
- `input/` —— `edit-model.ts`（`composerReducer` 与 `foldKeypressEvent`，不依赖 Ink）与 `layout.ts`（`layoutMultilineInput`，CJK 感知的折行/光标算法）。
- `components/` —— `App.tsx`、`ActivityRegion.tsx`、`Composer.tsx`、`ApprovalPrompt.tsx`、`QuestionPrompt.tsx`、`ToolRunningRow.tsx`。
- `ansi/` —— `style.ts`（scrollback 提交的纯字符串所用的 SGR 角色）与 `sanitize-terminal.ts`（`sanitizeTerminalOutput`，从捕获到的终端输出里剥离 OSC/DCS/光标控制序列，同时保留 SGR）。
- `invariant.ts` —— 本包的不变量伴生插件；它不装任何检查，因为 `mountTuiRenderer` 拥有的状态（调度器、行缓存、scrollback 水位线）都是私有闭包状态，由它自己的 `dispose()`/`waitUntilExit()` 负责收尾。

## 通过 `patchConsole` 提交 scrollback

`commitToScrollback`（`scrollback/commit.ts`）提交一个已关闭 step 的渲染行时调用的是 `console.log()`，绝不是手搓的 `instance.clear()` 加 `process.stdout.write()`：Ink 默认的 `render({ patchConsole: true })` 会把 `console.log` 重新路由到 `Ink#writeToStdout`，它先清空活动区、写入这一行，再调用 `restoreLastOutput()` 重画活动区，让它的光标记账与真实终端光标保持同步——`tests/q1-scrollback-commit.poc.ts` 证明了正是这一个机制让已提交的行不会消失。

## 有界活动区与待处理交互

`ActivityRegion.tsx` 渲染的是 Ink 树唯一会实时持有的那部分记录：流式的 assistant 尾部（按 `activity-model.ts` 的 `streamingTailBudget` 做尾部限长，为活动区其余的 chrome 预留行数）、运行中的工具行、至多一个被聚焦的待处理交互（一个审批或一个提问），以及下方的输入框——每个已关闭的节点都会提交进 scrollback 并被丢弃，绝不会重新进入 Ink 树。`ApprovalPrompt.tsx` 与 `QuestionPrompt.tsx` 都通过 web 端同样使用的 `PendingWait.respond()` 载体来应答各自的待处理交互，绝不自建第二个 `UserQuestionProvider` 或审批监听器。

## 输入框

`Composer.tsx` 是一个从零自建的无边框多行输入框，构建在不依赖 Ink 的编辑模型（`input/edit-model.ts`）与排版算法（`input/layout.ts`）之上：Enter 提交非空内容，Shift+Enter 或一个字面的 `\n` 字节插入换行，真实终端光标通过 Ink 自带的 `useCursor()` 跟踪编辑位置。`useCursor` 的坐标是相对 Ink 自身输出原点的，而不是相对输入框的本地行号，因此 `ActivityRegion.tsx` 会用 `measureElement` 测量它自己渲染在输入框上方的高度，把这个测得的行数当作 `rowOffset` 属性传给输入框，让光标落在终端实际画出它的那一行，而不是输入框自己的第一行。

## 发布速率调度器与 Config

`createPublicationScheduler`（`scheduler/publication-scheduler.ts`）把 `'stream'` 请求（一个 token 增量、一次 spinner 滴答）合并到每个 `RendererConfig.publishRateFps` 区间至多一次重绘，而 `'structural'` 请求（一个待处理交互出现或解决、一个 turn 的边界、一个已关闭节点、临时收件箱变化）立即发布，并取消任何待处理的合并计时器。`RendererConfig` 暴露两个经校验的字段：

- `publishRateFps` —— 流式重绘的最大帧率，单位 fps（schemastery 约束 1–240，默认 30）。
- `sessionListTimeoutMs` —— `mountTuiRenderer` 等待一个新建或调用方指定的 session 出现在 `ISessions.list` 里的毫秒数，超时才会打开它（schemastery 约束 1–60000，默认 5000）。

## 快照 lane

`tests/tui.snapshot.ts` 把每种交互状态画进一个真实的终端模拟器（`tests/support/headless-terminal.ts`，一个跑在假 TTY 之后的 `@xterm/headless` 实例），钉住一份 cell 级投影：按实际宽度折行、光标位置、经真实 `console.log` 路径提交的 scrollback，以及每个 cell 的 SGR 属性——这些都是它旁边的组件用例（`ink-testing-library` 的 `lastFrame()` 字符串）给不出的证据，因为那个字符串是 Ink*打算*写出的内容，不是终端解析真实字节流之后*显示*出来的内容。每个 checkpoint 都在 80 与 120 列各录一份，这一对宽度正好跨在本包自身对折行敏感的 fixture 文本两侧。

```sh
pnpm exec vitest run --config vitest.snapshot.config.ts packages/tui/ink-ui
DSH_SNAPSHOT=refresh pnpm exec vitest run --config vitest.snapshot.config.ts packages/tui/ink-ui
```

## 已知局限与延后事项

- **`read`/`search`/`web` 工具结果走通用卡片渲染** —— `transcript/tool-cards.ts` 目前还没有为这三种工具类别单独做卡片；只有 `terminal` 与 `diff` 结果拿到了专门的排版。
- **没有 `/history` 分页器，也没有尾部重建** —— `--resume <sessionId>`（[已上线的 `dsh --profile tui` 组合](../../../.agents/notes/implemented/feature/2026-08-15-tui-app-bundle-composition.md)）打开一个既有 session 时不会回填它此前的记录；挂载时快照里已有的节点是提交基线，绝不会被重新回放进 scrollback。
- **多段 `ask_user_question` 只有第一段可应答** —— `QuestionPrompt.tsx` 把之后的每一段都渲染成提示性文字，没有 `options`（自由文本）的一段只显示一行提示，不接受输入。
- **Shift+Enter 需要 kitty keyboard 协议明确上报** —— 其他情况下，一个字面的 `\n` 字节（Ctrl+J）是"插入换行但不提交"的既定替身。
- **终端恢复的验证只覆盖了 macOS** —— `tests/q3-terminal-restoration.poc.ts` 在 macOS 上验证了 Ink 自己的卸载清理（光标可见性、raw mode、bracketed paste）覆盖三条退出路径；这个机制原理上与平台无关，但未在 Linux 上复核。
- **`tests/` 下的 Q1/Q2/Q3 侦察脚本不是 vitest spec**（`*.poc.ts`，被 `vitest.config.ts` 的 `testIncludes` 排除），因此没有任何东西会在每次提交时运行它们，不过 `tsc -b tsconfig.client.json` 仍会对它们做类型检查；每一个都手动运行，例如 `pnpm exec tsx packages/tui/ink-ui/tests/q1-scrollback-commit.poc.ts`。
- **渲染器 checkpoint 快照 lane 钉住的是两种宽度下的七种交互状态，不是每一种可能的画面** —— `tests/tui.snapshot.ts` 覆盖了空闲输入框、一次进行中的流式回合、运行中的工具、一个审批弹窗、一个提问弹窗、应答之后的 scrollback，以及一份多行草稿；新增一种交互状态需要补它自己的 checkpoint。
