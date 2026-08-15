# TUI 发布收尾实施计划

[English](2026-08-16-tui-release-closeout.md) | 中文

> **供 agent worker 使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 让 TUI 文档与已交付行为一致，消除 TUI CI 的 Node 20 Action 运行时警告，并明确发布 `v0.1.1` 产品补丁版本所需但不含发布操作的准确前提。

**架构：** 文档事实保留在其所属层级，中英文配对文件同步变更。workflow 只升级可复用 Action 的主版本；发布工作仅做审计，因为产品 tag（`v*`）与 npm family tag（`dsh-v*`）属于不同机制。

**技术栈：** Markdown 双语配对、TypeScript JSDoc、GitHub Actions YAML、pnpm 发布脚本、Vitest。

---

### 任务 1：修正 TUI 当前状态文档

**文件：**
- 修改：`README.md:29-36`
- 修改：`README.zh.md:29-36`
- 修改：`README.i18n.yaml`
- 修改：`packages/tui/README.md:5-12`
- 修改：`packages/tui/README.zh.md:5-12`
- 修改：`packages/tui/README.i18n.yaml`
- 修改：`packages/tui/runtime/README.md:5,36,68-72`
- 修改：`packages/tui/runtime/README.zh.md:5,36,68-72`
- 修改：`packages/tui/runtime/README.i18n.yaml`
- 修改：`packages/tui/runtime/src/index.ts:2-6,133-140`

- [ ] **步骤 1：拆分已交付性能测试工具与剩余路线图**

把根目录状态表的最后一行替换为以下两行英文及对应中文：

```markdown
| Terminal renderer (Ink): scrollback commit, bounded live region, and terminal-emulator snapshot lane | ✅ Shipped |
| Long-session performance harness: deterministic 100k-event corpus, prompt-ready, input-to-echo, and resident-state shards | ✅ Shipped |
| `/history` pager, client-runtime tail rebase, and pinned-runner wall-clock enforcement | 🗺 Roadmap |
```

```markdown
| 终端渲染器（Ink）：scrollback 提交、有界活动区与终端模拟器快照 lane | ✅ 已交付 |
| 长会话性能测试工具：确定性 10 万事件语料、prompt-ready、input-to-echo 与 resident-state 分片 | ✅ 已交付 |
| `/history` 分页器、client runtime tail rebase 与固定 runner 墙钟门槛 | 🗺 路线图 |
```

同时把根目录指向 proposed 落地顺序记录的链接替换为已实现的终端渲染器 MVP 与 TUI 应用 bundle Agent Note 链接。

- [ ] **步骤 2：描述已交付的包职责**

修改 `packages/tui/README.md`，让 `ink-ui` 行将其描述为负责 scrollback、有界活动区、交互和 composer 的 Ink/React 19 渲染器。将末段替换为：

```markdown
The shipped `dsh --profile tui` composition mounts `runtime/` and its `ink-ui/` renderer in one process over the shared Client data layer; `packages/bundle/tui-app` owns the profile and startup wiring.
```

使用以下中文对侧内容：

```markdown
已交付的 `dsh --profile tui` 组合在同一进程内基于共享 Client 数据层挂载 `runtime/` 及其 `ink-ui/` 渲染器；`packages/bundle/tui-app` 负责 profile 与启动装配。
```

- [ ] **步骤 3：修正 runtime README 与 JSDoc 的职责描述**

在两份 runtime README 中说明：该包引导 Client Context，并在 `render` 启用且 stdout 为真实 TTY 时挂载 `mountTuiRenderer`。在编号装配列表中加入 conversation-node 注册、条件式渲染器挂载以及 `{ clientCtx, renderer? }` 的发布。更新两边一致的 `TuiRuntimeHandle` 代码围栏，导入 `MountedTuiRenderer` 并声明 `readonly renderer?: MountedTuiRenderer`。

把“尚无渲染器”限制替换为真实 TTY 要求：非 TTY 组合让 `renderer` 保持 undefined，已交付的 TUI profile 会拒绝这种状态。保留已构建 `lib/client-node.js` 测试注意事项，并说明 `clientCtx` 仍是整个 Client Context，因为当前渲染器直接消费 sessions 与 connection 服务；目前没有定义更窄的稳定门面。

把相同的当前状态事实应用到 `packages/tui/runtime/src/index.ts`：模块向自身渲染器发布 Client Context，`TuiRuntimeHandle.clientCtx` 由已挂载渲染器消费。不要修改类型或运行时语句。

- [ ] **步骤 4：确认过期描述已消失**

运行：

```bash
grep -RInE 'No renderer|no renderer ships|later package|ships no renderer|尚无渲染器|后续包' packages/tui --include='*.md' --include='*.ts'
```

预期：只剩性能基线中有意保留的“无渲染器”描述；不存在产品或包状态的过期描述。

- [ ] **步骤 5：重新记录并验证三组双语配对**

运行：

```bash
pnpm run verify-translation-pairing --write README.md packages/tui/README.md packages/tui/runtime/README.md
pnpm run verify-translation-pairing README.md packages/tui/README.md packages/tui/runtime/README.md
pnpm exec tsx scripts/run-oxlint.ts packages/tui/runtime/src/index.ts
```

预期：写入三组配对记录，三组命名配对一致，lint 成功退出。

- [ ] **步骤 6：提交文档修正**

```bash
git add README.md README.zh.md README.i18n.yaml packages/tui/README.md packages/tui/README.zh.md packages/tui/README.i18n.yaml packages/tui/runtime/README.md packages/tui/runtime/README.zh.md packages/tui/runtime/README.i18n.yaml packages/tui/runtime/src/index.ts
git commit -m "docs(tui): describe the shipped terminal application"
```

### 任务 2：升级 TUI CI Action 运行时

**文件：**
- 修改：`.github/workflows/tui-ci.yml:22-24`

- [ ] **步骤 1：只升级可复用 Action 主版本**

应用以下准确替换，保持所有触发器、矩阵项、输入和命令不变：

```yaml
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
```

- [ ] **步骤 2：验证 YAML 与 Action 运行时**

运行：

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { load } from 'js-yaml'; load(readFileSync('.github/workflows/tui-ci.yml', 'utf8')); console.log('tui-ci.yml: valid YAML')"
for spec in actions/checkout:v6 actions/setup-node:v6 pnpm/action-setup:v6; do repo=${spec%:*}; ref=${spec#*:}; gh api "repos/$repo/contents/action.yml?ref=$ref" --jq .content | base64 --decode | grep -q 'using:.*node24'; done
```

预期：YAML 解析成功，每个所选 Action 都声明 Node 24 运行时。

- [ ] **步骤 3：确认 workflow 行为未漂移**

运行：

```bash
git diff --unified=0 -- .github/workflows/tui-ci.yml
```

预期：只有三处 `@v4` 到 `@v6` 的替换。

- [ ] **步骤 4：提交 workflow 维护改动**

```bash
git add .github/workflows/tui-ci.yml
git commit -m "ci(tui): use Node 24 action runtimes"
```

### 任务 3：审计补丁版本发布条件但不发布

**文件：**
- 检查：`package.json`
- 检查：`scripts/release/bump.ts`
- 检查：`scripts/release/verify.ts`
- 检查：`scripts/release/families.ts`
- 检查：`.github/workflows/release.yml`
- 检查：`v0.1.0` 的 git tag 与 GitHub release 元数据

- [ ] **步骤 1：验证 npm 发布 family 基线**

运行：

```bash
pnpm run release:verify --family dsh
pnpm exec vitest run scripts/release/families.spec.ts
git tag --list --sort=-version:refname | head -20
```

预期：dsh family 以一个共享版本通过验证；测试通过；产品 tag 列表包含 `v0.1.0`，且不存在用于发布的 `dsh-v*` tag。

- [ ] **步骤 2：确认产品发布机制相互独立**

运行：

```bash
gh release view v0.1.0 --json tagName,name,isDraft,isPrerelease,publishedAt,url,targetCommitish
```

预期：`v0.1.0` 是 GitHub 产品 release。不要运行 `pnpm release:dsh`：该命令会改写所有 dsh family manifest，并准备另一套 `dsh-v*` npm 发布流程。

- [ ] **步骤 3：在最终报告中记录发布结论**

报告产品 `v0.1.1` 必须指向两笔收尾提交或其后的提交，并且需要人工发布权限。另行说明本次工作没有准备 npm 发布：224 个 dsh 发布成员仍为 `0.1.0-rc.5`，不存在 `dsh-v*` tag，而且本 fork 的手动 release workflow 没有 publish 输入，因此 publish job 仍被禁用。

### 任务 4：运行收尾验证

**文件：**
- 验证任务 1 与任务 2 变更的全部文件。

- [ ] **步骤 1：运行文档检查**

```bash
pnpm run doc-sync
```

预期：所有文档检查通过，包括全量双语配对。

- [ ] **步骤 2：运行仓库 lint 与发布验证**

```bash
pnpm run lint
pnpm run release:verify --family dsh
```

预期：两个命令都成功退出。

- [ ] **步骤 3：检查最终仓库状态**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -6
```

预期：无空白错误、工作区干净且没有新 tag。不要 push、打 tag、创建 GitHub release 或发布 npm 包。
