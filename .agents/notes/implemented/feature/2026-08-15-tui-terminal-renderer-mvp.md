# Agent Note: Terminal renderer MVP (D2.2)

Status: implemented

English | [中文](2026-08-15-tui-terminal-renderer-mvp.zh.md)

## Problem

`packages/tui/ink-ui` shipped only the Ink/React 19 dependency island and the Q1/Q2/Q3 reconnaissance PoCs (D2.0): no renderer, input component, or live region existed, so the landing-order plan in [the official-terminal-application Agent Note](../../proposed/feature/2026-08-15-official-terminal-application.md) had nothing a person could sit down and use. `packages/tui/runtime` (D2.1) bootstrapped the dual-context Client tree but mounted no renderer over it.

## Decision

`mountTuiRenderer` (`packages/tui/ink-ui/src/render.ts`) is the renderer's entry point: given a bootstrapped Client tree, it opens (or creates) one session's `SessionFace`, subscribes to its `ConversationSnapshot`, and drives three things built directly on the three PoC verdicts:

- **Commit**: a `renderClosedNodeLines()` (`transcript/node-lines.ts`) result for every settled node beyond the last committed one is pushed to scrollback through `console.log()` (`scrollback/commit.ts`) — the Q1-proven mechanism, never a hand-rolled `clear()` + `stdout.write()`. A width-keyed `RowCache` (`transcript/row-cache.ts`) memoizes each rendering; within one mount it never hits (every node commits exactly once), so it exists for a future `/history` pager that re-renders an already-committed node at a different width, not for this cut.
- **Publish**: `createPublicationScheduler` (`scheduler/publication-scheduler.ts`) paces `'stream'` snapshot changes at a validated `publishRateFps` (schemastery, default 30) and publishes `'structural'` ones (a pending interaction, a turn boundary, a closed node, the transient inbox) immediately; `classifySnapshotUpdate` (`scheduler/classify-update.ts`) tells the two apart by diffing bounded counts, since `ObservableSnapshot.subscribe` carries no reason payload.
- **Control**: `Composer.tsx` is a from-scratch multiline input (Q2 verdict: no maintained Ink package covers asymmetric first-line/continuation prefixes with CJK-aware wrapping) over an Ink-free edit model (`input/edit-model.ts`, `input/layout.ts`); Esc cancels the running turn through `SessionFace.cancel()`; approvals and questions answer through the pending carrier's own `PendingWait.respond()` (`ApprovalPrompt.tsx`, `QuestionPrompt.tsx`), never a second `UserQuestionProvider`/approval listener; Ctrl-C and every other exit path restore the terminal through Ink's own lifecycle (Q3 verdict) — this module never calls `process.exit()` itself.

Tool cards (`transcript/tool-cards.ts`) cover the `generic` (the documented fallback, including `read`/`search`/`web` — deferred), `terminal` (`sanitizeTerminalOutput` strips OSC/DCS/cursor-control sequences, keeps SGR), and `diff` (`diff`'s `diffLines`, an "exact changed-row comparison" rather than a whole-block replace) cards from `@deepseek-ai/dsh-tools/presentation`.

`packages/tui/runtime`'s `Config.render` (default `true`) mounts the renderer once the Client tree is ready, gated on a real TTY `stdout`; its lifecycle folds into the same plugin fiber that owns the Client tree, disposed before it.

### `React.memo` does not compose with `useInput` under this exact Ink/React pin

`Composer.tsx`, `ApprovalPrompt.tsx`, and `QuestionPrompt.tsx` are deliberately **not** wrapped in `React.memo`. Ink 7.1.1's `useInput` (`ink/build/hooks/use-input.js`) is built on React's `useEffectEvent` for its "the handler always sees the latest closure" guarantee. Under this package's exact pin (Ink 7.1.1, React 19.2.8), wrapping a component that owns `useInput`-read state in `React.memo` breaks that guarantee: a second keystroke's handler invocation observes the state from the *first* render, not the committed one — confirmed with a minimal `useState` counter reproduction outside this package's own code before treating it as a framework interaction rather than a bug here. Re-verify against current Ink/React versions before reapplying `React.memo` to a `useInput`-owning component.

### `mountTuiRenderer` waits for its session to appear in `sessions.list`

`ISessions.open()` throws `unknown session` unless the id is already in the client-side session list, which populates from a `host/session-added` event delivered asynchronously over the same connection the `session.create` RPC response arrived on. `mountTuiRenderer` therefore waits (`waitForSessionListed`, bounded by validated `sessionListTimeoutMs`, default 5000) before opening a freshly created or caller-named session. This closes a real race a direct in-process unit test surfaced (a hand-built `ctx.plugin({apply, inject}, {render: true})` fixture, and the real `bootHostTree`-driven Loader composition, both raced this — the real Loader case additionally raced the API-gateway route registration itself, which this fix does not address, see Consequences).

## Alternatives considered

**Wrap `ApprovalPrompt`/`QuestionPrompt`/`Composer` in `React.memo` per the original design intent** ("settled 卡用 React.memo + 稳定 props" from the D2.2 brief) — rejected once the staleness bug was found: settled (closed) nodes are never rendered as JSX at all in this design (they commit to scrollback as plain strings via `console.log`), so the width-keyed `RowCache` is this cut's actual realization of that discipline; the *live* interactive components' correctness outranks a speculative render-avoidance optimization that this exact framework pin does not support safely.

**Retry `bootHostTree`'s session.create-during-boot race with a delay loop** — rejected: masks a latent Loader/api-gateway boot-ordering hazard rather than fixing or documenting it; a direct `ctx.plugin()` fixture with a controlled fetch stub gives equivalent unit coverage without hiding the hazard (see Consequences).

**A full `/history` alternate-screen pager and resume/tail-rebase in this cut** — rejected as out of the landing-order plan's D2.2 scope; the row cache exists as forward-looking infrastructure only, and nodes existing at mount time are the committed baseline (never replayed).

## Consequences

The terminal renderer is real, working code with a passing pty-driven smoke (`packages/tui/runtime/tests/pty-smoke.client.spec.ts`): start, type a prompt, stream, scrollback carries the final text, Ctrl-C restores the terminal (verified via a real `stty -a`, the Q3 technique). Per-file coverage is 100% (branches included) across both `packages/tui/ink-ui/src` and `packages/tui/runtime/src`.

A genuine boot-order hazard surfaced during this work: driving the full `bootHostTree` Loader composition in-process (not through a real pty's slower module-loading timing) can race `tui-runtime`'s own `apply()` — which now performs a real `session.create` RPC during its own mount — against `api-gateway`'s route registration, observed as a `transport failure ... HTTP 404`. The pty smoke test's real, slower process timing does not hit it; a direct in-process Loader-driven unit attempt (not shipped) hit it consistently. This is not fixed in this cut — it predates this change (no earlier row performed a real RPC synchronously during its own `apply()`, so nothing exercised it) and is out of D2.2's scope to resolve. A future cut should either give `tui-runtime` an explicit ordering dependency on `api-gateway`'s route readiness or make `mountTuiRenderer`'s session creation retry-tolerant of a transient transport failure.

Known deferred work carried into a later cut: `read`/`search`/`web` tool result cards stay on the generic fallback; the `/history` pager and client-runtime tail rebase are unbuilt (nodes present at mount are the committed baseline, never replayed — `--resume <sessionId>` opens an existing session without backfilling its prior transcript, see the [D2.3 Agent Note](2026-08-15-tui-app-bundle-composition.md)); only the first sub-question of a multi-part `ask_user_question` is answerable, and a question with no `options` (free text) shows an informational line rather than accepting input; Shift+Enter is a literal `\n` byte (Ctrl+J) stand-in outside the kitty keyboard protocol. `packages/bundle/tui-app`'s shipped `dsh --profile tui` composition (D2.3) has since shipped over this renderer; this cut's own dev-run driver (`packages/tui/runtime/tests/dev-run.manual.ts`) remains a keyless way to exercise the renderer directly.
