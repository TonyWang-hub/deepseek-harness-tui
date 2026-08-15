# `@deepseek-ai/dsh-tui-app`

[English](README.md) | 中文

dsh 终端 bundle。[`cordis.patch.yml`](cordis.patch.yml) 叠在 [`dsh-base`](../base/README.md) 之上：提供编码 persona 与工具模式，关闭 HMR（与 headless、web bundle 同样的理由），并挂载本应用需要的终端专属行——Code Mode 的 worker、[`ApiProxyService`](../../host/apiproxy/README.md) 要求的存储/工作区行与目录选择器后端、`ask_user_question`（出现在每个出厂 agent preset 里，但从不在 `dsh-base` 自己的顶层）、[API 网关](../../host/apiproxy/README.md)、Connection 的 Host 半区（[`dsh-client-connection`](../../client/connection/README.md)）、本应用的 `tui-startup` 命令行 provider、[`dsh-tui-runtime`](../../tui/runtime/README.md) 的双 Context 引导，以及本包自己的 `tui-runner` 进程所有者。`dsh-base` 自己的 agent 层行（`tool-bash`、`tool-fs`、`skill-filesystem`、`plan-mode`、subagent 系列……）原样保留：base 让这一层为终端保持进程级常驻，正如它为 headless bundle 所做的那样——把它关掉、转到按会话的 agent preset 之后，是 Web 界面自己的事。本 bundle 不挂载任何 HTTP 服务器或浏览器插件：终端通过进程内连接触达 Web GUI 所用的同一套对象层，绝不开监听端口。

`tui-runtime` 在 Host 树的 Connection 进程内传输之上桥接出第二个进程内 Client cordis `Context`，并在真实 TTY `stdout` 下在其上挂载终端渲染器（[`dsh-tui-ink-ui`](../../tui/ink-ui/README.md) 的 `mountTuiRenderer`）。本 bundle 自己的 `tui-runner` 行是唯一决定该引导就绪后进程该做什么的插件：在真实终端上，它等待挂载好的渲染器退出（正常退出、Ctrl-C，或是从 Ink 内部一路展开的未捕获异常），并通过启动器提供的 `ctx.appExit` 宿主钩子（[`dsh-cmdline`](../../boot/cmdline/README.md)）请求进程退出；非 TTY 调用（管道、CI，或任何没有终端接入的进程）不会挂载渲染器，这对本 profile 而言是一种真实的误配置，所以 `tui-runner` 会响亮失败而不是永远挂起。本应用自己的 `tui-startup` provider（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`，解析 `dsh --profile tui` 的 `--resume <sessionId>` 参数与 `--help`，并 provide `tuiStartup`；`tui-runtime` 行注入该服务，从惰性 config 里读取 `resumeSessionId`，打开指定的既有会话而不是新建一个。

## Model Experience

无，本 bundle 不挂载任何额外的 model-visible prompt 分区或工具；模型侧界面由 base 与终端渲染器各行拥有。

#### KV Cache effect

无；本 bundle 不给请求前缀添加任何内容。

## Known Limitations and Deferred Work

- **`--resume` 打开会话时不回填** ——`mountTuiRenderer` 自身的 MVP 限制原样延续：挂载时既有会话里已有的节点是已提交的基线，绝不会被回放进 scrollback（本刀没有 `/history` 分页器或 tail rebase；见[终端渲染器 MVP Agent Note](../../../.agents/notes/implemented/feature/2026-08-15-tui-terminal-renderer-mvp.md)）。
- **`ctx.appExit` 由启动器拥有** ——在 `dsh` 启动器之外启动 tui profile，会在激活时响亮失败，直到宿主提供退出请求为止。
- **没有 Web 管理界面** ——本 bundle 按设计不开监听端口；同时想要浏览器 GUI 的部署需另起一个 `dsh --profile web` 进程。
