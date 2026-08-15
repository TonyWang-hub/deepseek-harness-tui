# @deepseek-ai/dsh-tui-ink-ui

[English](README.md) | 中文

终端应用的 Ink/React 19 依赖孤岛。这一刀（D2.0）是一次技术侦察 spike：先搭起包边界与依赖孤岛，再回答[官方终端应用 Agent Note](../../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md)「Risks」一节提出的三个渲染设计问题，每个问题都配一个针对真实 pty 运行的可执行 PoC。本包目前不交付渲染器、输入组件或实时区域——那是后续的 D2.2，要等这些结论过审之后才会落地。

## 依赖选型

Ink 最新 major（7.1.1）要求 `react` 与 `@types/react` `>=19.2.0`；在"支持 React 19"这件事上并不存在 Ink 6 与 7 的取舍——Ink 6 本就已经要求 React 19（见 `npm view ink@6.0.0 peerDependencies`）。本包锁定 `ink@^7.1.1` 与 `react@^19.2.8`，与浏览器客户端的 `react@^18.2.0` 树相互隔离——和 pnpm workspace 里每个成员自己的 `node_modules` 天然隔离版本孤岛的方式一样，不需要根级 override，也不共享同一份实例。`@xterm/headless` 与 `node-pty` 仅作为 devDependency 供 `tests/` 下的 PoC 脚本使用。

## Q1——不用 `<Static>` 的 scrollback 提交

**裁决：实证可行，但只能走 Ink 自身的 `console.log()`/`patchConsole` 管道——不能靠手搓的 `instance.clear()` + `process.stdout.write()`。**

`ink/build/ink.js` 的 `onRender` 证实了 Note 拒绝 `<Static>` 的理由：`fullStaticOutput`（构造时声明为 `''`，第 249 行）会把每个 `<Static>` 子节点渲染出的文本永久累积下去（`this.fullStaticOutput += staticOutput`，第 354 行与第 416 行），并在 `debug` 模式下每次渲染整体重放——内存随会话长度增长，与 Note 所述完全一致。

不用 `<Static>` 的自然替代方案——调用渲染实例公开的 `clear()`、`process.stdout.write()` 写入已提交的行、让下一次由 state 驱动的渲染重画活动区——已实证测试（`tests/q1-scrollback-commit.poc.ts`，`raw-write` 模式）且**不通过**：已提交的行会从最终屏幕上消失（5 行里 0 行留在终端投影中，尽管每一行确实各自只写入 pty 一次）。读 `Ink#clear()` 能解释原因：它先调用 `this.log.clear()`，再调用 `this.log.sync(this.lastOutputToRender ...)`——后者把 log-update 内部"屏幕上已经是什么"的记账重新锚定到*旧的*活动区内容，而不是锚定到"空"。中间插入的一次裸 `process.stdout.write()` 对这份记账是不可见的，于是 log-update 下一次擦除（是相对光标位置计算的，不是相对行号计算的）会擦掉错误的行——在 PoC 里，刚提交的那一行和下一帧活动区会一起塌缩进同一到两行终端行，而不是正常向上滚动。

真正可行的策略（`tests/q1-scrollback-commit.poc.ts`，`console-log` 模式，12/12 项断言通过）改走 `console.log()` 提交。`render()` 默认 `patchConsole: true`，会把 `console.log`/`console.error` 路由到 `Ink#writeToStdout`/`writeToStderr`（`ink/build/ink.js`）：同样是"清除再写入"的序列，但之后还会调用 `restoreLastOutput()`——它会立即重放活动区，在其他代码开始运行之前就让 log-update 的记账与真实光标位置保持同步。这是 Ink 自己用来把任意写入与活动区交错在一起的既有惯用法，也是这个版本自带测试已经在用的路径；不是本包发明出来的变通办法。

**对 D2.2 的设计结论：** 渲染器提交一个已完成的 step 时调用 `console.log()`（或走同一条 `writeToStdout` 路径的等价物），绝不手动调用 `clear()` 后直接写 `stdout`。

## Q2——无边框多行输入 + 首行/续行不同前缀宽度

**裁决：实证可行；生态里没有现成维护中的包能满足需求，因此必须自建，且其中最难的两点已证明可解。**

`ink-text-input`（最接近的维护中候选）在设计上就是单行的：它的 `useInput` 处理器把 `key.return` 无条件当作提交，也没有携带任何行/row 状态（`ink-text-input@6.0.0` 的 `build/index.js`）。npm 上找到的唯一多行候选 `ink-multiline-input@0.1.0`，发布于 2026 年 1 月，没有可配置的首行/续行非对称前缀，也没有使用track record；它无法替代 Note 的 Risks 一节点名的那两个难点。

`tests/fixtures/q2-multiline-input-app.tsx` 是一个从零自建的多行输入，证明了这两点：

1. **非对称前缀宽度。** 首行用 `❯ `（2 个显示列）；此后每一行——无论是折行续接还是下一条逻辑行——都用 `    `（4 列）。两类行各自算出不同的折行预算（`COLUMNS - 前缀宽度`），按每个渲染行现算，而不是假设统一。
2. **CJK 感知的折行。** `string-width`（本就是 Ink 的传递依赖；这里直接使用）逐字符测量终端列宽，因此折行永远不会切开一个双宽字符，也不会在中英混排行里数错列数。

真实的终端光标——而不是 `ink-text-input` 那种假的反色光标块——通过 `useCursor()`（`ink/build/hooks/use-cursor.js`，Ink 7 自带；这里没有发明任何光标 trick）跟踪编辑位置。

`tests/q2-multiline-input.poc.ts` 在真实 pty 上以刻意收窄的 20 列宽度驱动该 fixture，按键脚本经过特意挑选，使预期的折行结果与光标位置可以手工推导（推导过程写在 PoC 自己的注释里），4 项断言全部通过：渲染出的行与手工推导的折行结果完全一致（包括一行恰好落在 20 列边界、无一位偏差），3 次左方向键之后真实 xterm 光标位置与手工推导的插入点一致，Ctrl+D 导出的 fixture 内部逻辑行模型也与按键脚本一致，且这一项验证与渲染结果彼此独立。

**对 D2.2 的设计结论：** 把输入组件当作真实的、有明确范围的工作来做预算（编辑模型、折行算法、光标定位，未来还要考虑真正 Shift+Enter 所需的 IME/kitty-keyboard），而不是"接入一个现成包"。这个 PoC 用 Ctrl+J（发送一个字面字节）触发换行的按键绑定，只是"插入换行但不提交"的替身；真正的 Shift+Enter 需要 kitty keyboard 协议或对应终端的转义序列，超出本次 spike 范围，留待后续。

## Q3——退出时的终端恢复

**裁决：Ink 7.1.1 在已测试的三条路径上均已妥善处理——未发现需要自建补丁的缺口。**

读 `ink/build/components/App.js` 的卸载清理 effect（`useEffect(() => () => { cliCursor.show(stdout); 如仍启用则关闭 raw mode; 如仍启用则关闭 bracketed paste }, ...)`）可见 Ink 已经把光标可见性、raw mode、bracketed paste 的恢复收敛到同一处，只要 React 树卸载就会执行。`ink/build/ink.js` 把这次卸载接到了全部三条路径上：

- **正常退出**：`useApp().exit()` 调用 `onExit` → `Ink#handleAppExit` → `Ink#unmount()` → 树卸载 → 清理 effect 执行。
- **Ctrl+C**：`App.js` 的 `handleInput` 检查 `input === '\x03' && exitOnCtrlC`（默认 `true`），直接调用 `handleExit()`，在同一条卸载路径跑之前就显式关闭了 raw mode。
- **未捕获异常**：`this.unsubscribeExit = signalExit(this.unmount, { alwaysLast: false })`（`ink.js` 构造函数）挂钩了 `signal-exit` 这个依赖对进程 `exit` 事件的拦截——即使在 Node 默认的未捕获异常处理展开之后，这个事件通常仍会触发（除非某个竞争的 exit handler 内部又调用了 `process.exit()`）——同一条卸载路径也会从这里执行。

`tests/q3-terminal-restoration.poc.ts` 没有只依赖读源码的结论，而是对真实进程状态做了核验：针对三种模式（`normal`、`ctrlc`、`throw`，定义在 `tests/fixtures/q3-exit-app.tsx`）各自起一个真实的 `bash`、在它自己的 pty 里运行，该 fixture（同时通过 `useInput` 启用 raw mode、通过 `usePaste` 启用 bracketed paste）作为它的子进程运行；等 fixture 退出、shell 提示符回来之后，用 `stty -a` 读 pty 的真实 termios 状态——而不是从已经死掉的 fixture 进程内部读一个值。光标可见性与 bracketed paste 不是 termios 的位，因此改从原始字节流里最后一次相关的 DEC 私有模式转义序列（`\x1b[?25h`/`l`、`\x1b[?2004h`/`l`）读取。全部 12 项断言（4 个维度 × 3 种模式）通过：`icanon` 与 `echo` 均已恢复，光标留在可见状态，bracketed paste 留在关闭状态，三条路径概莫能外。

这个结果与 Note 的预期框架（把它列为待解决的风险）以及历史先例（已删除的、基于 pi-tui 的旧实现当年为终端恢复打过 dist 层依赖补丁）都不一致——Ink 已经成熟了不少：这次 spike 在已测试的三条路径上没有发现需要自建补丁的缺口。本次 spike 未覆盖的边缘情况：单独的 SIGTERM（本次只测了 Ctrl+C 的原始字节与一次未捕获异常）、清理 effect 自身崩溃的情形，以及 Linux（本次 spike 只在 macOS/darwin 上跑过；恢复机制——一个 React 卸载 effect 加上 `signal-exit` 依赖——原理上与平台无关，但本次未在 Linux 上复核）。

**对 D2.2 的设计结论：** 针对本次测试的这三条路径，不需要在 Ink 自身的 `render()`/`unmount()` 生命周期之上再加一层自建的终端恢复垫片；如果上述未测边缘情况对最终交付有影响，把时间预算留给它们。

## 已知局限与延后事项

- **本包尚不交付渲染器、输入组件或实时区域**——这一刀是依赖孤岛加三个 PoC；真正的组件树落在后续的 `D2.2`。
- **`tests/` 下的 PoC 脚本不是 vitest spec**（文件名是 `*.poc.ts`，不是 `*.spec.ts`——见 `vitest.config.ts` 的 `testIncludes`），因此没有任何东西会在每次提交时执行它们；它们会起一个真实 pty、按真实时钟驱动定时器，速度慢，也会把 PTY/ANSI 解析的不稳定性带进覆盖率门禁——而这次 spike 的证据是用来被人读的，不是每次提交都要重跑一遍。`tsconfig.client.json` 的 `include` 确实覆盖了它们（`packages/tui/ink-ui/tests/**/*.ts(x)`），所以 `tsc -b tsconfig.client.json` 仍会对 PoC 驱动脚本和它们的 fixture 做静态类型检查——被排除在日常测试/覆盖率运行之外的，只是它们那次真实 pty 执行本身。手动运行：`pnpm exec tsx packages/tui/ink-ui/tests/q1-scrollback-commit.poc.ts`（以及 `q2-...`、`q3-...`）。
- **Q3 只覆盖了 macOS**——恢复机制（一个 React 卸载 effect 加 `signal-exit` 依赖）原理上与平台无关；本次 spike 未在 Linux 上复核。
- **Q2 的换行按键绑定（Ctrl+J）只是 PoC 的替身**——真正的 Shift+Enter 需要 kitty keyboard 协议或对应终端的转义序列，留给渲染器那一刀处理。
