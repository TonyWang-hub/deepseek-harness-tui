# TUI 发布收尾设计

[English](2026-08-16-tui-release-closeout-design.md) | 中文

## 范围

本次改动收尾 TUI 渲染器发布后的文档与 CI 维护工作，并审计仓库是否具备补丁版本发布条件。本次改动不创建或移动 git tag、不发布包、不实现 `/history`，也不改变终端行为。

## 文档

更新根目录、`packages/tui` 与 `packages/tui/runtime` README 的中英文配对文件，修正其中与已交付渲染器、profile、快照测试和性能测试工具不一致的内容。每份 README 只保留其层级拥有的事实：根目录概述产品状态，`packages/tui` 说明各包职责，runtime README 说明运行时配置及保留的限制。除非源码与测试证明某个路线图项目已经交付，否则它仍保留在路线图中。

重新记录每组变更的双语配对，并运行这些文件要求的文档检查。

## TUI CI 维护

只升级 `.github/workflows/tui-ci.yml` 中产生 Node 20 Action 运行时警告的可复用 Actions。保持触发器、权限、操作系统矩阵、受测 Node 版本、命令与 job 顺序不变。采用仓库 tag 引用策略所允许的受维护主版本。

## 补丁版本发布审计

检查发布脚本、包版本、tag 位置与发布文档，确定发布 `v0.1.1` 补丁版本的准确要求。只有发布工具能够证明某项机械元数据修正必不可少时才应用该修正。需要发布权限的操作只报告，不创建 tag，也不执行发布。

## 并行执行

一个 worker 审计并编辑 README 配对文件；另一个 worker 审计 TUI workflow 与补丁版本发布条件。父 agent 复核两边结果、解决重叠，并运行文档、workflow 语法或策略、发布验证及最终 diff 所需的最小检查。

## 验收

- 每组变更的 README 配对文件一致描述当前 TUI 行为。
- TUI CI workflow 不再使用会产生已观察到的 Node 20 弃用警告的 Action 运行时。
- 发布前提及仍需发布权限的步骤明确无歧义。
- 不创建 tag，也不执行发布。
- 工作区通过选定的文档、CI 策略、发布及 diff 检查。
