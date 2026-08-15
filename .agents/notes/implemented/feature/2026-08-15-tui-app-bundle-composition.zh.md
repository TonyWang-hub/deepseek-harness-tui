# Agent Note: `dsh --profile tui` 出厂组合（D2.3）

Status: implemented

[English](2026-08-15-tui-app-bundle-composition.md) | 中文

## Problem

`packages/tui/runtime`（D2.1）引导了双 Context Client 树，`packages/tui/ink-ui`（D2.2）在其上交付了终端渲染器，但没有任何出厂组合挂载这两个包：`PROFILE_TEMPLATES` 里不存在 `dsh --profile tui`，没有任何东西把 `mountTuiRenderer` 的退出转换成进程退出，`--resume` 也没有命令行界面。D2.2 的 Agent Note 明确把这个缺口列为自己遗留的最后一项；上一代终端前端的移除记录（[2026-08-04](../simplification/2026-08-04-remove-tui-package.md)）要求终端包必须先有出厂组合，才算真正被重新引入。

## Decision

`packages/bundle/tui-app`（`@deepseek-ai/dsh-tui-app`）是第四个出厂 bundle，与 `dsh-base`、`dsh-web-app`、`dsh-headless` 并列。`PROFILE_TEMPLATES.tui`（`packages/boot/app-boot/src/profile.ts`）是 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-app']`；`dsh --profile tui` 与 `web`、`headless` 一样从模板自动初始化。

`cordis.patch.yml` 叠在 `dsh-base` 之上，agent 层原封不动——base 已经把 agent 组合成进程级常驻（与 headless 保持的姿态相同），所以本 bundle 只增加终端组合在 base 之外还需要的行：`ApiProxyService.inject` 要求但 base 自己不挂载的存储/工作区/目录选择器行、`tool-ask-user`（出现在每个 agent preset 里，但从不在 base 自己的顶层）、API 网关、Connection 的 Host 半区（`trustedHosts: []`，没有监听端口需要信任）、本 bundle 自己的 `tui-startup` 命令行 provider、`tui-runtime` 行，以及本 bundle 自己的 `tui-runner` 进程所有者。Web 界面那份禁用清单（`tool-bash`、`skill-filesystem`、`plan-mode`、subagent 系列……）在这里不适用：那份清单存在是因为 Web 把 agent 层挪到了按会话的 preset 之后，而终端组合并不这样做。

`tui-runner`（`src/index.ts`）是唯一决定 `ctx.tuiRuntime` 就绪后进程该做什么的插件。`inject: ['tuiRuntime']` 只是一个普通字符串，所以 cordis 会挂起 `apply()` 直到该行 provide 出服务，不需要任何 TypeScript 类型合并——这个服务本身经包内定义的窄结构类型 `TuiRuntimeLike`（`{ renderer?: { waitUntilExit(): Promise<void> } }`）与 `ctx.get('tuiRuntime')` 读取，绝不静态 import `@deepseek-ai/dsh-tui-runtime` 或 `@deepseek-ai/dsh-tui-ink-ui`。这两个包都按 CLIENT 聚合（各自的 `tsconfig.client.json`）做类型检查，而 `dsh-tui-app` 按 HOST 聚合做类型检查，与 `dsh-headless`、`dsh-web-app` 同列——这正是 `dsh-tui-runtime` 自己的模块文档在下一层为 `ctx.connection` 记录的同一种 Host/Client 交叉合并风险，这里用完全相同的方式规避。真实 TTY 会挂载渲染器（`tui-runtime` 自己的 `Config.render`，默认 `true`，以 `process.stdout.isTTY` 为门槛）：`tui-runner` 等待 `renderer.waitUntilExit()`，再通过启动器提供的 `ctx.appExit` 请求进程退出。没有挂载渲染器（管道、CI 或其他非交互式调用）对本 profile 而言是一种真实的误配置——组合里的其他任何东西都不会产生输出或退出——所以 `tui-runner` 会响亮失败而不是永远挂起；这正是 `tui-runtime` 自己刻意不提供的行为（它在非 TTY `stdout` 下悄悄跳过挂载，这对一个也被测试环境组合使用的包而言是正确的）。

`--resume <sessionId>` 是本 bundle 自己的 `tui-startup` provider（照搬 `headless-startup`/`web-startup` 的模式）：它注入 `cmdlineArgs`，解析该参数与本应用的 `--help`，并 provide `tuiStartup`，不声明任何 `Context` 合并（与 `headlessStartup`/`webStartup` 自己的先例一致——一次普通的 `ctx.provide()`，对 `SERVICE_PAGE`/`SERVICE_WALK_EXEMPTIONS` 目录扫描不可见，因为该扫描只遍历已声明的 `Context` 合并）。`tui-runtime` 的 `Config` 新增了一个字段 `resumeSessionId?: string`，由该行自己的 `!!js ctx.tuiStartup.resumeSessionId` 表达式接入；`apply()` 在唯一读取它的那一点把它打上品牌，变成 `MountOptions.sessionId`（与 `SessionId()` 自身"编译期转换、零运行时开销"的契约相同）。`mountTuiRenderer` 自身的 MVP 限制原样延续：被恢复会话里已有的节点是已提交的基线，绝不会被回放进 scrollback。

真组合验收测试（`packages/bundle/tui-app/tests/pty-smoke.spec.ts`）经 `loadProfile`/`healProfilesModuleFallback`/`boot`（`@deepseek-ai/dsh-app-boot`）启动出厂组合——这正是生产环境的 profile 解析路径，直接练到 `PROFILE_TEMPLATES.tui`，而不是临时拼凑的行列表——在真实 pty 下运行，配合在已就绪 context 上事后安装的脚本化 `dsh-llm-replay` 回合（照搬 `apps/web/tests/scaffold.ts` 自己的模式，而不是 `packages/tui/runtime/tests/compose.client.ts` 那套 Client 聚合重实现，因为本包的测试按 HOST 聚合做类型检查，可以直接 import `dsh-app-boot` 与 `dsh-llm-replay`）。它复用了 `packages/tui/runtime/tests/pty-smoke.client.spec.ts` 完全相同的标记协议与 `stty -a` 终端恢复检查。

## Alternatives considered

**让 `tui-runner` 自己调用 `mountTuiRenderer`，关掉 `tui-runtime` 自身的自动挂载** ——已拒绝：这要求 `dsh-tui-app` 静态 import `@deepseek-ai/dsh-tui-ink-ui` 来拿 `mountTuiRenderer`/`MountOptions`，把该包 Client 聚合的 Context 合并（`connection`、`sessions`）带进 `dsh-headless`、`dsh-web-app` 已经共享的 Host 聚合程序里——正是 `dsh-tui-runtime` 自己的模块文档在下一层警告过的那种风险。经本地结构类型读取 `ctx.tuiRuntime`、让 `tui-runtime` 继续拥有挂载（按设计），不需要这样的 import。

**给 `dsh-tui-app` 套上与 `dsh-web-app` 相同的 preset 层禁用清单** ——已拒绝：那份清单存在是因为 Web 把 agent 层挪到了按会话的 preset 之后；终端组合没有 preset 层，agent 保持进程级常驻，与 `dsh-headless` 已有的姿态相同。照搬禁用清单会悄悄移除终端组合按文档（`compose.client.ts` 自己的注释）需要保持启用的工具与 prompt 分区。

**照搬 `compose.client.ts` 的临时行列表来建模真组合测试，而不是走真实 bundle patch** ——已拒绝：`compose.client.ts` 之所以存在，正是因为 `packages/tui/runtime` 自己的测试按 Client 聚合做类型检查，无法 import `dsh-app-boot`（一个 Host 包）而不污染那个程序。`dsh-bundle/tui-app` 的测试没有这层约束，因此经 `loadProfile`/`PROFILE_TEMPLATES.tui` 与真实 `cordis.patch.yml` 启动，对"出厂 bundle patch 能跑通"而言是严格更可信的证据，并且直接练到了 `PROFILE_TEMPLATES` 的改动。

**给 `tui-runtime` 的行加一条显式 `inject: ['apiProxy']` 排序依赖，来堵上 D2.2 Agent Note 的 Consequences 一节记录过的启动顺序隐患** ——本刀拒绝：该隐患已被证明只在快速的进程内 Loader 驱动测试时序下才会复现，而不是 pty 冒烟测试真实、更慢的进程时序（D2.2 note 自己的发现）。修复它超出 D2.3 的范围；真组合测试用的正是那种已经规避它的真实 pty 手法，所以本刀不交付一个未经证实的排序修复。

## Consequences

`dsh --profile tui` 是一个真实、能跑的产品入口：一个人跑 `pnpm dsh --profile tui`，就能得到一个能用的终端会话——提示词、流式输出、scrollback 提交、Ctrl-C 退出且终端被恢复——由一个经真实 pty、走真实出厂 bundle patch（而非仅测试用的组合）的冒烟测试证明。`--resume <sessionId>` 打开一个既有会话（不回填，与渲染器自身的 MVP 限制一致，记在本包自己的 README 里）。

`packages/tui/runtime` 的 `Config` 新增了 `resumeSessionId`，是一个小的、向后兼容的追加（默认缺席，对每一个现有消费者和测试都行为不变）。

留到后续几刀的已知遗留工作：`tui-runtime` 自己的 `apply()` 与 `api-gateway` 路由注册之间的启动顺序隐患（D2.2 Agent Note 的 Consequences 一节记录过）尚未解决；`/history`、tail rebase 与长会话性能门是官方终端应用 Agent Note 自己后续落地顺序里的条目，不属于本刀。
