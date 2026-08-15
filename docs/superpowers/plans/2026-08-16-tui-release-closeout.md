# TUI Release Closeout Implementation Plan

English | [中文](2026-08-16-tui-release-closeout.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align TUI documentation with shipped behavior, remove the TUI CI Node 20 action-runtime warning, and establish the exact non-publishing prerequisites for a `v0.1.1` product patch release.

**Architecture:** Documentation stays at its owning level and bilingual pairs move together. The workflow changes only reusable Action majors, while release work remains an audit because product tags (`v*`) and npm-family tags (`dsh-v*`) are separate mechanisms.

**Tech Stack:** Markdown bilingual pairing, TypeScript JSDoc, GitHub Actions YAML, pnpm release scripts, Vitest.

---

### Task 1: Correct current-state TUI documentation

**Files:**
- Modify: `README.md:29-36`
- Modify: `README.zh.md:29-36`
- Modify: `README.i18n.yaml`
- Modify: `packages/tui/README.md:5-12`
- Modify: `packages/tui/README.zh.md:5-12`
- Modify: `packages/tui/README.i18n.yaml`
- Modify: `packages/tui/runtime/README.md:5,36,68-72`
- Modify: `packages/tui/runtime/README.zh.md:5,36,68-72`
- Modify: `packages/tui/runtime/README.i18n.yaml`
- Modify: `packages/tui/runtime/src/index.ts:2-6,133-140`

- [ ] **Step 1: Separate the shipped performance harness from the remaining roadmap**

Replace the final root status row with these two English rows and the equivalent Chinese rows:

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

Also replace the root link to the proposed landing-order note with links to the implemented terminal-renderer MVP and TUI app-bundle Agent Notes.

- [ ] **Step 2: Describe the shipped package roles**

Change `packages/tui/README.md` so the `ink-ui` row calls it the Ink/React 19 renderer that owns scrollback, the bounded live region, interactions, and the composer. Replace the final paragraph with:

```markdown
The shipped `dsh --profile tui` composition mounts `runtime/` and its `ink-ui/` renderer in one process over the shared Client data layer; `packages/bundle/tui-app` owns the profile and startup wiring.
```

Use this Chinese counterpart:

```markdown
已交付的 `dsh --profile tui` 组合在同一进程内基于共享 Client 数据层挂载 `runtime/` 及其 `ink-ui/` 渲染器；`packages/bundle/tui-app` 负责 profile 与启动装配。
```

- [ ] **Step 3: Correct runtime README and JSDoc ownership**

State in both runtime READMEs that the package bootstraps the Client Context and mounts `mountTuiRenderer` on a real TTY when `render` is enabled. Extend the numbered assembly list with conversation-node registration, conditional renderer mounting, and publication of `{ clientCtx, renderer? }`. Update the mirrored `TuiRuntimeHandle` code fences to import `MountedTuiRenderer` and declare `readonly renderer?: MountedTuiRenderer`.

Replace the “No renderer yet” limitation with the real-TTY requirement: non-TTY compositions leave `renderer` undefined, and the shipped TUI profile rejects that state. Keep the built-`lib/client-node.js` test caveat and state that `clientCtx` remains the whole Client Context because the current renderer directly consumes sessions, workspaces, and connection services; no narrower stable facade is defined.

Apply the same current-state facts to `packages/tui/runtime/src/index.ts`: the module publishes the Client Context to its renderer, and `TuiRuntimeHandle.clientCtx` is consumed by the mounted renderer. Do not change types or runtime statements.

- [ ] **Step 4: Confirm stale claims are gone**

Run:

```bash
grep -RInE 'No renderer|no renderer ships|later package|ships no renderer|尚无渲染器|后续包' packages/tui --include='*.md' --include='*.ts'
```

Expected: only intentional “no renderer” performance-baseline descriptions remain; no product/package status claim remains.

- [ ] **Step 5: Re-record and validate all three bilingual pairs**

Run:

```bash
pnpm run verify-translation-pairing --write README.md packages/tui/README.md packages/tui/runtime/README.md
pnpm run verify-translation-pairing README.md packages/tui/README.md packages/tui/runtime/README.md
pnpm exec tsx scripts/run-oxlint.ts packages/tui/runtime/src/index.ts
```

Expected: three pair records written, all three named pairs consistent, and lint exits successfully.

- [ ] **Step 6: Commit the documentation correction**

```bash
git add README.md README.zh.md README.i18n.yaml packages/tui/README.md packages/tui/README.zh.md packages/tui/README.i18n.yaml packages/tui/runtime/README.md packages/tui/runtime/README.zh.md packages/tui/runtime/README.i18n.yaml packages/tui/runtime/src/index.ts
git commit -m "docs(tui): describe the shipped terminal application"
```

### Task 2: Upgrade the TUI CI action runtime

**Files:**
- Modify: `.github/workflows/tui-ci.yml:22-24`

- [ ] **Step 1: Upgrade only the reusable Action majors**

Apply this exact replacement and leave every trigger, matrix entry, input, and command unchanged:

```yaml
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
```

- [ ] **Step 2: Validate YAML and Action runtimes**

Run:

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { load } from 'js-yaml'; load(readFileSync('.github/workflows/tui-ci.yml', 'utf8')); console.log('tui-ci.yml: valid YAML')"
for spec in actions/checkout:v6 actions/setup-node:v6 pnpm/action-setup:v6; do repo=${spec%:*}; ref=${spec#*:}; gh api "repos/$repo/contents/action.yml?ref=$ref" --jq .content | base64 --decode | grep -q 'using:.*node24'; done
```

Expected: YAML parses, and every selected Action declares a Node 24 runtime.

- [ ] **Step 3: Confirm workflow behavior did not drift**

Run:

```bash
git diff --unified=0 -- .github/workflows/tui-ci.yml
```

Expected: exactly three `@v4` to `@v6` replacements.

- [ ] **Step 4: Commit the workflow maintenance**

```bash
git add .github/workflows/tui-ci.yml
git commit -m "ci(tui): use Node 24 action runtimes"
```

### Task 3: Audit patch-release prerequisites without publishing

**Files:**
- Inspect: `package.json`
- Inspect: `scripts/release/bump.ts`
- Inspect: `scripts/release/verify.ts`
- Inspect: `scripts/release/families.ts`
- Inspect: `.github/workflows/release.yml`
- Inspect: Git tag and GitHub release metadata for `v0.1.0`

- [ ] **Step 1: Verify the npm release-family baseline**

Run:

```bash
pnpm run release:verify --family dsh
pnpm exec vitest run scripts/release/families.spec.ts
git tag --list --sort=-version:refname | head -20
```

Expected: the dsh family verifies at one shared version; tests pass; the product tag list contains `v0.1.0` and no `dsh-v*` publication tag.

- [ ] **Step 2: Confirm the product-release mechanism is distinct**

Run:

```bash
gh release view v0.1.0 --json tagName,name,isDraft,isPrerelease,publishedAt,url,targetCommitish
```

Expected: `v0.1.0` is a GitHub product release. Do not run `pnpm release:dsh`: that command rewrites all dsh-family manifests and prepares a separate `dsh-v*` npm release sequence.

- [ ] **Step 3: Record the release conclusion for the final report**

Report that a product `v0.1.1` must point at or after the two closeout commits and requires human release authority. State separately that npm publication is not prepared by this work: all 224 dsh release members remain at `0.1.0-rc.5`, no `dsh-v*` tag exists, and this fork's manual release workflow has no publish input, so its publish job remains disabled.

### Task 4: Run closeout verification

**Files:**
- Verify all files changed by Tasks 1 and 2.

- [ ] **Step 1: Run documentation checks**

```bash
pnpm run doc-sync
```

Expected: every documentation check passes, including corpus-wide bilingual pairing.

- [ ] **Step 2: Run repository lint and release verification**

```bash
pnpm run lint
pnpm run release:verify --family dsh
```

Expected: both commands exit successfully.

- [ ] **Step 3: Check the final repository state**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -6
```

Expected: no whitespace errors, a clean tree, and no new tag. Do not push, tag, create a GitHub release, or publish npm packages.
