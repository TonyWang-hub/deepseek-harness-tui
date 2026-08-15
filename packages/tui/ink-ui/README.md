# @deepseek-ai/dsh-tui-ink-ui

English | [中文](README.zh.md)

The terminal application's renderer, over the Ink 7.1.1/React 19 dependency island: `mountTuiRenderer` (`src/render.ts`) is the sole entry point, opening or creating one session, subscribing to its `ConversationSnapshot`, and driving commit (closed steps to real terminal scrollback), publish (paced repaints of a bounded live region), and control (the multiline composer, approval/question prompts, Esc-to-cancel) — see the [terminal renderer MVP Agent Note](../../../.agents/notes/implemented/feature/2026-08-15-tui-terminal-renderer-mvp.md) for the design decisions this package ships, and the [official-terminal-application Agent Note](../../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md) for this package's place in the landing-order plan.

## Module structure

- `render.ts` — `mountTuiRenderer`, wiring one session's `SessionFace` to the publication scheduler, the row cache, and the mounted Ink `App`.
- `config.ts` — `RendererConfig`, a schemastery-validated `publishRateFps` (default 30) and `sessionListTimeoutMs` (default 5000), plus `resolveRendererConfig`.
- `scheduler/` — `publication-scheduler.ts` (`PublicationScheduler`, pacing `'stream'` repaints at `publishRateFps` while publishing `'structural'` ones immediately) and `classify-update.ts` (`classifySnapshotUpdate`, diffing bounded snapshot counts to tell the two apart).
- `scrollback/` — `commit.ts` (`commitToScrollback`, the `console.log()`/`patchConsole` commit path).
- `activity/` — `activity-model.ts` (`buildActivityModel`, the bounded live view: streaming tail, running tools, pending interactions, queue count).
- `transcript/` — `node-lines.ts` (closed-node rendering), `tool-cards.ts` (`generic`/`terminal`/`diff` tool-result cards), `content-text.ts` (content-block flattening shared by both), `row-cache.ts` (the width-keyed `RowCache`).
- `input/` — `edit-model.ts` (`composerReducer` and `foldKeypressEvent`, Ink-free) and `layout.ts` (`layoutMultilineInput`, the CJK-aware wrap/cursor algorithm).
- `components/` — `App.tsx`, `ActivityRegion.tsx`, `Composer.tsx`, `ApprovalPrompt.tsx`, `QuestionPrompt.tsx`, `ToolRunningRow.tsx`.
- `ansi/` — `style.ts` (SGR roles for scrollback-committed plain strings) and `sanitize-terminal.ts` (`sanitizeTerminalOutput`, stripping OSC/DCS/cursor-control sequences from captured terminal output while keeping SGR).
- `invariant.ts` — this package's invariant companion; it installs no check, because `mountTuiRenderer`'s owned state (the scheduler, the row cache, the scrollback watermark) is private closure state torn down by its own `dispose()`/`waitUntilExit()`.

## Scrollback commit through `patchConsole`

`commitToScrollback` (`scrollback/commit.ts`) commits one closed step's rendered lines by calling `console.log()`, never a hand-rolled `instance.clear()` plus `process.stdout.write()`: Ink's default `render({ patchConsole: true })` reroutes `console.log` through `Ink#writeToStdout`, which clears the live region, writes the line, then calls `restoreLastOutput()` to repaint the live region and keep its cursor bookkeeping synchronized with the real terminal cursor — the one mechanism `tests/q1-scrollback-commit.poc.ts` proves keeps committed lines from vanishing.

## Bounded activity region and pending interactions

`ActivityRegion.tsx` renders the only part of the transcript the Ink tree ever holds live: the streaming assistant tail (tail-limited to `activity-model.ts`'s `streamingTailBudget`, which reserves rows for the rest of the region's chrome), running-tool rows, at most one focused pending interaction (an approval or a question), and the composer beneath — every closed node commits to scrollback and is dropped, never re-entered into the Ink tree. `ApprovalPrompt.tsx` and `QuestionPrompt.tsx` answer their pending interaction through the same `PendingWait.respond()` carrier the web face uses, never a second `UserQuestionProvider` or approval listener of their own.

## Composer

`Composer.tsx` is a from-scratch, borderless multiline input over the Ink-free edit model (`input/edit-model.ts`) and layout algorithm (`input/layout.ts`): Enter submits non-blank content, Shift+Enter or a literal `\n` byte inserts a line break, and the real terminal cursor tracks the edit position through Ink's own `useCursor()`. `useCursor`'s position is relative to Ink's own output origin, not to the composer's local rows, so `ActivityRegion.tsx` measures its own rendered height above the composer with `measureElement` and passes that measured row count down as the composer's `rowOffset` prop, landing the cursor on the row the terminal actually draws it on rather than the composer's own first row.

## Publish rate scheduler and Config

`createPublicationScheduler` (`scheduler/publication-scheduler.ts`) coalesces `'stream'` requests (a token delta, a spinner tick) to at most one repaint per `RendererConfig.publishRateFps` interval, while a `'structural'` request (a pending interaction appearing or resolving, a turn boundary, a closed node, the transient inbox) publishes at once and cancels any pending coalesced timer. `RendererConfig` exposes two validated fields:

- `publishRateFps` — maximum streaming repaint rate in frames per second (schemastery-bounded 1–240, default 30).
- `sessionListTimeoutMs` — milliseconds `mountTuiRenderer` waits for a freshly created or caller-named session to appear in `ISessions.list` before opening it (schemastery-bounded 1–60000, default 5000).

## Snapshot lane

`tests/tui.snapshot.ts` paints each interaction state into a real terminal emulator (`tests/support/headless-terminal.ts`, an `@xterm/headless` instance behind a fake TTY) and pins a cell-level projection: line-wrapping at the actual width, cursor placement, scrollback committed through the real `console.log` path, and the SGR attributes of every cell — evidence the component specs beside it (`ink-testing-library`'s `lastFrame()` string) cannot give, since that string is what Ink intended to write, not what a terminal shows after parsing the real byte stream. Every checkpoint is recorded at 80 and 120 columns, the pair that straddles this package's own wrap-sensitive fixture text.

```sh
pnpm exec vitest run --config vitest.snapshot.config.ts packages/tui/ink-ui
DSH_SNAPSHOT=refresh pnpm exec vitest run --config vitest.snapshot.config.ts packages/tui/ink-ui
```

## Known Limitations and Deferred Work

- **`read`/`search`/`web` tool results render through the generic card** — `transcript/tool-cards.ts` has no dedicated card for those three tool kinds yet; only `terminal` and `diff` results get a specialized layout.
- **No `/history` pager or tail rebase** — `--resume <sessionId>` (the [shipped `dsh --profile tui` composition](../../../.agents/notes/implemented/feature/2026-08-15-tui-app-bundle-composition.md)) opens an existing session without backfilling its prior transcript; nodes already in the snapshot at mount time are the committed baseline and are never replayed into scrollback.
- **Only the first sub-question of a multi-part `ask_user_question` is answerable** — `QuestionPrompt.tsx` renders every later sub-question as informational text, and a sub-question with no `options` (free text) shows an informational line instead of accepting input.
- **Shift+Enter needs the kitty keyboard protocol to be reported distinctly** — everywhere else a literal `\n` byte (Ctrl+J) is the documented composer stand-in for inserting a line break without submitting.
- **Terminal-restoration coverage is macOS-only** — `tests/q3-terminal-restoration.poc.ts` verified Ink's own unmount cleanup (cursor visibility, raw mode, bracketed paste) on macOS across three exit paths; the mechanism is platform-neutral in principle but unverified on Linux.
- **The Q1/Q2/Q3 reconnaissance scripts under `tests/` are not vitest specs** (`*.poc.ts`, excluded by `vitest.config.ts`'s `testIncludes`), so nothing runs them on every commit, though `tsc -b tsconfig.client.json` still type-checks them; each runs manually, e.g. `pnpm exec tsx packages/tui/ink-ui/tests/q1-scrollback-commit.poc.ts`.
- **The renderer checkpoint snapshot lane pins seven interaction states at two widths, not every possible screen** — `tests/tui.snapshot.ts` covers the idle composer, a mid-stream turn, running tools, an approval prompt, a question prompt, post-answer scrollback, and a multiline draft; a new interaction state needs its own checkpoint.
