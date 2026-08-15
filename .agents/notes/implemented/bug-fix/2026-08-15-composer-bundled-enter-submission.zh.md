# Agent Note: composer 提交与文本合并进同一 `useInput` 事件的 Enter 字节

Status: implemented

[English](2026-08-15-composer-bundled-enter-submission.md) | 中文

## 问题

`dsh --profile tui` 对真实 DeepSeek API 可确定性复现：composer 就绪后，一次调用把完整提示词写入 pty（文本以 `\r` 结尾），随后在整个等待窗口内零响应——无流式、无 spinner、无报错——键入的文本仍停留在 composer 行。同一渲染器自己的 pty 冒烟测试（`packages/tui/runtime/tests/pty-smoke.client.spec.ts`）保持绿色，因为它把提示词文本和 `\r` 拆成两次带间隔的 `shell.write()`；`packages/tui/ink-ui/tests/components/Composer.spec.tsx` 自己的 "Enter submits" 测试也是同样的拆分写法。

根因：Ink 的 `useInput`（`ink/build/hooks/use-input.js`）对每个原始 stdin chunk 只调用一次 handler，其 JSDoc 明说——"if the user pastes text and it's more than one character, the callback will be called only once, and the whole string will be passed as `input`."。Ink 的输入解析器（`ink/build/input-parser.js` 的 `parseKeypresses`）只把 chunk 按转义序列和单个退格字节切分，其余任何连续串——包括内嵌或结尾的 `\r`/`\n`——保持为一个未切分的字符串，因为这些字节可以合法出现在粘贴文本里。Ink 的 `parseKeypress` 只在整个 chunk 恰为单字节 `\r` 时（`s === '\r'`）才置位 `key.return`。`packages/tui/ink-ui/src/input/edit-model.ts` 原先的 `mapKeyToAction(input, key)` 完全依据 `key.return`/`key.shift`/单字符精确判断做决定，于是形如 `"hello\r"` 的合并 chunk——一次 `write()` 携带"提示词文本+Enter"必然产生的形状（自动化驱动、粘贴、或终端把快速击键 burst 合成单次 `read()` 交付）——穿过所有分支落进默认的 `{ type: 'insert', text: input }`：整个字符串连同 `\r` 被当作字面文本插入。Enter 被静默吞掉；`SessionFace.prompt()` 从未被调用；文本滞留 composer 且无任何可见错误，与现场症状完全吻合。

## 决定

`edit-model.ts` 以 `foldKeypressEvent(state, input, key): KeypressFold`（`{ state, submissions }`）替换 `mapKeyToAction`。单个已解码的特殊键（`key.return`、方向键、退格、Escape、Ctrl/Meta 组合）仍走 Ink 自身解码认出的直接路径，与之前一致。当 `input` 完全不含 `\r`/`\n` 时仍是一次普通 `insert`，同样不变。只有含 `\r` 或 `\n` 的连续串才逐字符遍历：裸 `\r`（后面不紧跟 `\n`）提交 composer 当前文本并清空——同一串中其后的字符续入新的 composer——`\n`（或 `\r\n` 对的后半，保持为单个换行，使粘贴的 Windows 风格行尾不会各自触发一次多余提交）插入换行，控制字节之间的其余字符串各为一次 `insert`。`Composer.tsx` 的 `useInput` handler 直接以自身 `useReducer` 状态调用 `foldKeypressEvent`，把每个 submission 的文本派发给 `onSubmit`，并经一个新增的 `ComposerAction` 变体 `{ type: 'replaceState'; state }` 把结果状态折回 `composerReducer`——其既有的逐迁移 case 不变（`foldKeypressEvent` 内部仍对批次的每一步调用它们，因此其自身测试与语义均未受影响）。

## 考虑过的替代方案

**把含 `\r` 的多字符输入检测为错误并拒绝。** 否决：携带 Enter 字节的合并串是普通且预期的形状（任何快速 burst、粘贴或自动化输入），不是畸形输入；拒绝提交只是把同一 bug 的用户可见症状从"沉默"换成"另一种沉默"。

**在 Ink/`useInput` 层修（用包装器在调用应用 handler 前重切合并 chunk）。** 否决：Ink 此处的行为是有文档的刻意设计（整段粘贴文本按设计作为单个事件到达）；在 Ink 已把 chunk 解码为 `(input, key)` 之后重切，需要重推导本包并不拥有的原始转义序列边界，而 `edit-model.ts` 本就拥有这个 composer 的行/提交语义。

## 后果

`Composer` 的 `useInput` handler 现在从一个 Ink 事件折叠出一批迁移（可能是数次 insert、换行与提交），而不是至多映射一次迁移；`composerReducer` 的既有 case 不变且仍被逐一单测，另加一个新的 `replaceState` case。回归覆盖：`packages/tui/ink-ui/tests/input/edit-model.spec.ts` 的 `foldKeypressEvent` 套件（含两个 `REGRESSION:` 前缀用例——ASCII 与 CJK 文本合并结尾 `\r`——以及串中 `\r`、`\r\n` 对、裸 `\n`）、`packages/tui/ink-ui/tests/components/Composer.spec.tsx` 的 `REGRESSION: text and Enter delivered in ONE stdin write still submit and clear the composer`（单次 `stdin.write('hello\r')`，不同于该文件其他刻意把文本与 `\r` 拆成两次写入的测试）、以及 `packages/tui/runtime/tests/pty-smoke.client.spec.ts` 的第二个脚本化回合——在真实 pty 上以一次 `shell.write('bundled prompt\r')` 发出——复用该文件既有拆分写法回合已启动的同一会话（同文件内再做一次完整 Loader 启动在主机高负载下明显更易超时），断言脚本化回复流式到达且 composer 最终为空。

本包其他 `useInput` 驱动的输入路径（`ApprovalPrompt`、`QuestionPrompt`）只接受 `y`/`n`/数字的单字符输入，未改动；未来任一方若加入多字符输入面并接受自由文本，需要本 Agent Note 所述的同款合并串处理。
