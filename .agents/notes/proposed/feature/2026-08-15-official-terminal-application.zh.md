# Agent Note: 基于共享客户端核心的官方终端应用

Status: proposed

[English](2026-08-15-official-terminal-application.md) | 中文

## 问题

harness 已交付 Web、ACP、JSON-RPC 和一次性 CLI 入口，但没有交互式终端界面，而非浏览器界面是呼声最高的产品缺口。社区终端客户端以外挂协议客户端的形态填补它：在 SDK/ACP 面上重复实现会话语义，随上游每次变更而漂移，且无法承载进程内插件贡献。

上一个终端前端因没有 shipped composition 被删除——包存在，但没有任何 profile、示例或产品命令装配它（[删除记录](../../implemented/simplification/2026-08-04-remove-tui-package.md)）。该记录为重新引入设定了四个前提：具名的产品或部署、明确的包边界、具体的交互 provider、以及装配态的生命周期与 transcript 验收。

## 提案

以满足全部四个前提的 shipped composition 重新引入终端应用，用 Ink 渲染，经进程内连接复用既有客户端数据层。

**具名产品。** `dsh --profile tui` 加入 [profile.ts](../../../../packages/boot/app-boot/src/profile.ts) 的出厂模板表（`PROFILE_TEMPLATES`），与 `web`、`headless` 并列，首用自动初始化；composition 与首个终端插件同 PR 落地，任何合并点都不存在无主包状态。

**连接。** 同一 Node 进程承载两棵根 cordis Context——host 树与 client 树——因为 `connection`、`sessions`、`loader` 是同名不同型的服务，对同一 key 的二次 `provide` 在运行时直接抛异常（[GUI 分层](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)）。client 树经既有进程内 fetch 面抵达 host：`InProcessApiClient`（[fetch 客户端](../../../../packages/host/apiproxy/src/fetch/client.ts)）覆于 host 组合出的 `/api` handler 之上，继承 `toFetchHandler` 已原生提供的 SSE 事件流。新增工作：进程内 `ClientConnectionRpc`（web 实现硬编码 `globalThis.fetch`）、host 组合 fetch handler 的公开访问器（现为私有方法直喂 `node:http`）、以及对[浏览器信任栅栏](../../../../packages/client/connection/src/api-request-trust.ts)的刻意绕行——进程内调用方与 host 同属一个信任域，特权 loopback-only 方法组需要为它写下明确的信任声明。host 半区把传输中立与载体分离：连接注册表与进程内访问独立成立，HTTP/WebSocket 路由降为其上的适配器，因此终端组合不绑定任何监听 socket。三项载体要求纳入设计：进程内流由 generation 持有（ApiProxy 撤销或重组时中止其流，客户端转入重连并重新同步，而不是抱着陈旧的 connected 状态）、进程内 RPC 在信号中止时即使 handler 无视信号也立即拒绝（`InProcessApiClient.doFetch` 已守住的契约）、以及泛型 `rpc.handle` channel 在进程内经同一注册表解析——服务 web 面的 channel 不得在终端 404。

**发布面。** 客户端数据层已是 React-free，其 client 面测试已在纯 Node 下运行；缺口在打包——`./client` 编译为 `window.__ModuleLoader__` 浏览器产物。每个被复用的包新增一个 `./client-node` ESM companion，用既有的 node library tsdown 配置构建，并在 `tsconfig.base.json` 补齐缺失的 `/client` paths 别名（connection 现在就缺；locale 视消费而定）。

**模型抽取。** 已经纯净的对话与交互逻辑从 React 包移入平台中立包：chat snapshot builder 与 conversation-node builder 群、输入状态机、popup select 控制器、以及覆于[呈现联合类型](../../../../packages/core/tools/src/presentation.ts)之上的六个工具 card-model 函数（八种 call kind；未知种类落入文档化的 generic 默认）。声明在 `.tsx` 内的 ui-primitives prop 类型拆出无 JSX 的 `*.types.ts` 伴生文件。浏览器专属的附件处理（File/Blob/ObjectURL）留在平台接缝之后；终端应用首版不支持图片附件。

**渲染。** 已关闭的 step 序列化一次后经 stdout 写入终端 scrollback；Ink 树只持有有界活动区（流式尾部、运行中工具、审批、问题、输入框）。不使用 Ink 的 `Static`，因为它累积全量静态输出。发布调度器为流式重绘限速（默认 30 FPS，作为受校验的 Config 字段），结构性事件立即发布。被删实现的共享 step 计时追踪器与宽度键控行缓存作为模式移植——其实测 796ms→17ms 的按键修复（[渲染成本历史](../../archived/bug-fix/2026-08-03-tui-long-session-render-costs.md)）。terminal 工具输出先净化（剥除 OSC、DCS 与光标控制序列）再透传。resume 仅加载有界尾窗，且 client runtime 新增语义明确的 tail-rebase 操作：committed 水位线标记投影已定稿的最高事件（覆盖全部 chat 节点种类——user、command、compaction、retry、error、turn-tail 节点以及已关闭的 step）、rebase 只在安全点执行（无 pending 交互、无未闭合的 turn 或 step）、重新分页的历史绝不二次提交进 scrollback、尾窗之外的历史经 alternate-screen 的 `/history` 分页器查看。

**终端所有权。** 终端应用是 stdout 与 stderr 的唯一所有者：渲染器持有终端期间，host 与插件日志改道文件 sink；大体量工具输出按写入背压有界分批提交；raw mode、bracketed paste 与光标状态在正常退出、Ctrl-C 与异常终止下都得到恢复。

**交互面。** host 的 ApiProxy 已注册唯一的 `UserQuestionProvider` 和 `approval/request` waterfall 监听器，二次注册即 `DUPLICATE_PROVIDER` 错误。因此终端从 client runtime 的 pending 交互渲染问题与审批，经 `PendingWait` 的 respond 载体作答，与 web 面完全同构；命令执行与自动补全走 commands runtime 的 Remote 面（订阅 `commands/change`），权限预设只读展示。

**能力对等。** 浏览器模块花名册（`platform: 'web'` 的 client bundle）在构造上就不属于终端范围，因此对等按能力逐项声明而非一揽子承诺：每个一方产品面落在终端原生、generic 回退、同 Host web 面或明确延后四列之一，交付文档携带这张矩阵。图片附件起始于延后列，待平台接缝就位。

**落地次序。** 一个窄的装配态纵切先于模型抽取与完整工具渲染：双 Context 启动且不监听任何 socket、全部连接面走通、一个问题与一个审批经 pending 载体完成、活动区与 scrollback 提交在真实 PTY 下运行、每条退出路径都恢复终端。纵切全绿后才展开大范围抽取。

**验收面。** 终端快照 harness 回归：从 git 历史恢复的 headless xterm 终端（帧标记同步 + 语义缓冲区投影，[既有 harness](../../archived/testing/2026-07-18-tui-terminal-state-snapshots.md)）、主题无关性断言、固定终端尺寸矩阵、进程边界的 PTY 冒烟测试、以及带 keyless 回放 fixture 的 examples leaf。

**React 岛。** 终端包群声明 React 19（Ink 的要求）；数据层对 React 的耦合仅限类型，既有 React 18 浏览器树不受影响。

## 包拓扑

`packages/bundle/tui-app`（`@deepseek-ai/dsh-tui-app`）持有 composition、patch 层与启动 flag；`packages/tui/runtime`（`@deepseek-ai/dsh-tui-runtime`）持有双 Context bootstrap 与进程内连接装配；`packages/tui/ink-ui`（`@deepseek-ai/dsh-tui-ink-ui`）持有渲染器、输入与活动区。抽出的平台中立包与其现居所并列于 `packages/client/` 下。不设 `packages/tui/app`——它会与 bundle 的 npm 名冲突。

## 考虑过的替代方案

**SDK/ACP 之上的外挂终端客户端**（社区形态）——否决：重复会话语义、随上游漂移、无法承载进程内插件贡献。

**复活被删的 pi-tui 实现**——否决：其依赖补丁是钉死单一版本的 dist 层手术；行为、harness 与 fixture 作为模式与参照移植，不移植代码。

**用 Ink `Static` 承载 transcript**——否决：Ink 为清屏重放保留累积的静态输出，内存仍随会话增长。

**host 与 client 插件共用一棵 Context**——否决：服务注册表对 `connection`/`sessions` 的二次 `provide` 直接抛异常；`ctx.isolate` 虽在 vendored 代码中存在，但本仓库零使用、未经产品组合验证。

**原生 Rust/ratatui 客户端**——首版否决：它放弃共享 TypeScript 客户端核心，而那正是本提案要保住的最强升级杠杆。

## 验收标准

- `dsh --profile tui` 从出厂模板自动初始化，并端到端完成一个真实任务——提示、流式输出、一次带审批的工具调用、结果——覆盖 macOS 与 Linux。
- composition 与首个终端插件同 PR 交付。
- keyless 快照 lane 全绿：尺寸矩阵下的语义终端投影加 PTY 冒烟，审批、ask-user、斜杠命令与 resume 流程在装配态 transcript 中可见。
- 默认终端组合不打开任何监听 socket；web 管理面仅按请求挂载。
- built 产物冒烟测试在纯 Node 下从 `lib/` 导入每个 `./client-node` 产物，而非经源码面 path 别名。
- 性能门在再生成的基准语料上运行（脚本生成的长会话，至少 10 万事件；历史 19.6 万事件语料从未入库）：input-to-echo p50 ≤20ms 且 p95 ≤50ms、冷/暖 prompt-ready 在声明预算内、相对 headless 基线的 RSS 增量在声明上限内、tail rebase 后驻留事件与节点数有稳态上限。
- 全部仓库 gate 绿：typecheck、逐文件覆盖率、doc-sync、hygiene、cordis-config。

## 风险

- 完整的 `ConnectionController` 启动/重连循环从未跑过进程内 SSE 路径；`onOpen` 时序与流打开超时的关系需要集成测试验证后，连接设计才可被信任。
- 为进程内调用方向特权 loopback-only 方法组扩展信任，需要一次明确的安全评审。
- Ink 的原生输入组件必须支持无边框多行编辑及首行/续行不同前缀宽度；被删实现正是为此给依赖打了 dist 层补丁——若 Ink 不支持，输入组件将成为自研工作。
- 基准语料是合成的，可能无法复现历史会话的分布；因此性能门度量的是每帧工作量有界这一机制，而非某个历史数字。
- client runtime 的 tail rebase 是新的共享运行时行为；web 面需在同一变更中获得回归覆盖。
- pending 交互载体由 web 面的帧协议塑形；终端交互渲染与之耦合，载体一旦变更即有两个消费者。
- 上游客户端变更速度很高；抽取类 PR 先行且各自独立落地，使每个 web 面回归保持可见。
