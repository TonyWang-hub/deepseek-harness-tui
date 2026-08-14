# Agent Note: Official terminal application over the shared client core

Status: proposed

English | [中文](2026-08-15-official-terminal-application.zh.md)

## Problem

The harness ships Web, ACP, JSON-RPC, and one-shot CLI entry points but no interactive terminal interface, and a non-browser interface is the most requested product gap. Community terminal clients fill it as external protocol clients: they re-implement session semantics over the SDK/ACP surface, drift on every upstream change, and cannot host in-process plugin contributions.

The previous terminal frontend was deleted because it had no shipped composition — the package existed but no profile, example, or product command mounted it ([removal record](../../implemented/simplification/2026-08-04-remove-tui-package.md)). That record sets four reintroduction preconditions: a named product or deployment, an explicit package boundary, a concrete interaction provider, and assembled lifecycle and transcript acceptance.

## Proposal

Reintroduce a terminal application as a shipped composition satisfying all four preconditions, rendering with Ink over the existing client data layer connected in-process.

**Named product.** `dsh --profile tui` joins the shipped templates in [profile.ts](../../../../packages/boot/app-boot/src/profile.ts) (`PROFILE_TEMPLATES`) beside `web` and `headless`, auto-initializing on first use; the composition ships in the same PR as the first terminal plugin, so no unshipped package state exists at any merge point.

**Connection.** One Node process hosts two root cordis Contexts — the host tree and the client tree — because `connection`, `sessions`, and `loader` are different services under the same keys and a second `provide` of one key throws at runtime ([GUI layering](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)). The client tree reaches the host through the existing in-process fetch surface: `InProcessApiClient` ([fetch client](../../../../packages/host/apiproxy/src/fetch/client.ts)) over the host's composed `/api` handler, inheriting the SSE event streams `toFetchHandler` already serves. New work: an in-process `ClientConnectionRpc` (the web implementation hardcodes `globalThis.fetch`), a public accessor for the host's composed fetch handler (today a private method fed straight to `node:http`), and a deliberate route around the [browser trust fence](../../../../packages/client/connection/src/api-request-trust.ts) — an in-process caller is same-trust-domain, and the privileged loopback-only method set needs an explicit trust statement for it. The host half splits transport-neutral from carrier: the connection registry and in-process access stand alone, and the HTTP/WebSocket routes become an adapter over them, so a terminal composition binds no listening socket. Three carrier requirements are part of the design: in-process streams are generation-owned (a withdrawn or recomposed ApiProxy aborts its streams so the client reconnects and resyncs instead of holding a stale connected state), the in-process RPC rejects on an aborted signal even when a handler ignores it (the contract `InProcessApiClient.doFetch` already keeps), and generic `rpc.handle` channels resolve through the same registry in-process so a channel serving the web face cannot 404 in the terminal.

**Publication face.** The client data layer is already React-free and its client-face tests already run under plain Node; the gap is packaging — `./client` compiles to a `window.__ModuleLoader__` browser artifact. Each reused package gains a `./client-node` ESM companion built with the existing node library tsdown config, and `tsconfig.base.json` gains the missing `/client` paths aliases (connection today; locale if consumed).

**Model extraction.** Conversation and interaction logic that is already pure moves out of the React packages into platform-neutral packages: the chat snapshot builder and conversation-node builders, the input machine, the popup select controller, and the six tool card-model functions over the [presentation union](../../../../packages/core/tools/src/presentation.ts) (eight call kinds; unknown kinds fall through a documented generic default). The ui-primitives prop types declared inside `.tsx` files split into JSX-free `*.types.ts` companions. Browser-only attachment handling (File/Blob/ObjectURL) stays behind a platform seam; the terminal application ships without image attachments first.

**Rendering.** A closed step is serialized once and committed to the terminal scrollback via stdout writes; the Ink tree holds only a bounded live region (streaming tail, running tools, approvals, questions, composer). Ink's `Static` is not used because it accumulates the full static output. A publication scheduler paces stream repaints (default 30 FPS as a validated Config field) while structural events publish immediately. The shared step-timing tracker and width-keyed row caches from the deleted implementation are ported as patterns — its measured 796ms→17ms keystroke fix ([render-cost history](../../archived/bug-fix/2026-08-03-tui-long-session-render-costs.md)). Terminal tool output is sanitized (OSC, DCS, and cursor-control sequences stripped) before passthrough. Resume loads only a bounded tail window, and the client runtime gains a tail-rebase operation with explicit semantics: a committed watermark marks the highest event whose projection is final across every chat node kind (user, command, compaction, retry, error, and turn-tail nodes as well as closed steps), rebase runs only at safe points (no pending interaction, no open turn or step), repaged history is never committed to the scrollback twice, and history behind the tail window opens in an alternate-screen `/history` pager.

**Terminal ownership.** The terminal application is the sole owner of stdout and stderr: host and plugin logging reroutes to a file sink while the renderer holds the terminal, large tool outputs commit in bounded batches against write backpressure, and raw mode, bracketed paste, and cursor state are restored on normal exit, Ctrl-C, and abnormal termination alike.

**Interaction surface.** The host ApiProxy already registers the sole `UserQuestionProvider` and the `approval/request` waterfall listener, so a second registration is a `DUPLICATE_PROVIDER` error. The terminal therefore renders questions and approvals from the client runtime's pending interactions and answers them through the `PendingWait` respond carrier, exactly like the web face; command execution and autocomplete ride the commands runtime's Remote face with a `commands/change` subscription, and permission presets display read-only.

**Capability parity.** The browser module roster (`platform: 'web'` client bundles) is out of the terminal's scope by construction, so parity is stated per capability rather than as a blanket claim: each first-party surface lands as terminal-native, generic fallback, same-host web surface, or explicitly deferred, and the shipped documentation carries that matrix. Image attachments start in the deferred column behind the platform seam.

**Landing order.** A narrow assembled slice precedes model extraction and full tool rendering: dual-context boot with no listening socket, all connection faces live, one question and one approval answered through the pending carrier, the live region and scrollback commit running under a real PTY, and terminal restoration on every exit path. The broad extraction starts only after this slice is green.

**Acceptance surface.** The terminal snapshot harness returns: the headless xterm terminal with frame-marker synchronization and semantic buffer projection recovered from git history ([prior harness](../../archived/testing/2026-07-18-tui-terminal-state-snapshots.md)), theme-agnosticism assertions, a fixed terminal-size matrix, a PTY smoke test at the process boundary, and an examples leaf with keyless replay fixtures.

**React island.** The terminal packages declare React 19 (Ink's requirement); the data layer's React coupling is types-only, so the existing React 18 browser tree is untouched.

## Package topology

`packages/bundle/tui-app` (`@deepseek-ai/dsh-tui-app`) owns the composition, patch layer, and startup flags; `packages/tui/runtime` (`@deepseek-ai/dsh-tui-runtime`) owns the dual-context bootstrap and in-process connection assembly; `packages/tui/ink-ui` (`@deepseek-ai/dsh-tui-ink-ui`) owns the renderer, input, and live region. The extracted platform-neutral packages live beside their current homes under `packages/client/`. No package is named `packages/tui/app`, which would collide with the bundle's npm name.

## Alternatives considered

**External terminal client over SDK/ACP** (the community shape) — rejected: it duplicates session semantics, drifts on upstream change, and cannot host in-process plugin contributions.

**Reviving the deleted pi-tui implementation** — rejected: its dependency patch was dist-layer surgery pinned to one version; behavior, harness, and fixtures are ported as patterns and references, not code.

**Ink `Static` for the transcript** — rejected: Ink retains the accumulated static output for clear-screen replay, so memory still grows with the session.

**One shared Context for host and client plugins** — rejected: the service registry throws on the second `provide` of `connection`/`sessions`; `ctx.isolate` is vendored but unused in this repository and unproven in a product composition.

**A native Rust/ratatui client** — rejected for the first version: it abandons the shared TypeScript client core, which is the strongest upgrade lever this proposal exists to keep.

## Acceptance criteria

- `dsh --profile tui` auto-initializes from the shipped template and completes a real task end to end — prompt, streaming, a tool call with approval, result — on macOS and Linux.
- The composition ships in the same PR as the first terminal plugin.
- The keyless snapshot lane is green: semantic terminal projections across the size matrix plus a PTY smoke, with approval, ask-user, slash-command, and resume flows visible in assembled transcripts.
- The default terminal composition opens no listening socket; the web management surface mounts only on request.
- A built-artifact smoke imports each `./client-node` artifact under plain Node from `lib/`, not through source-plane path aliases.
- A performance gate runs on a regenerated benchmark corpus (a scripted long session of at least 100k events; the historical 196k-event corpus was never committed): input-to-echo p50 ≤20ms and p95 ≤50ms, cold and warm prompt-ready within stated budgets, RSS delta over the headless baseline within a stated cap, and a steady-state ceiling on retained events and nodes after tail rebase.
- All repository gates are green: typecheck, per-file coverage, doc-sync, hygiene, and cordis-config.

## Risks

- The full `ConnectionController` start/reconnect loop has never run over the in-process SSE path; `onOpen` timing against the stream-open timeout needs an integration test before the connection design is trusted.
- Extending trust to an in-process caller for the privileged loopback-only method set needs an explicit security review.
- Ink's stock input must support borderless multi-line editing with distinct first-line and continuation prefix widths; the deleted implementation needed a dist-layer dependency patch for exactly this, and if Ink cannot, the input component becomes custom work.
- The benchmark corpus is synthetic and may not reproduce the historical session's distribution; the gate therefore measures bounded work per frame, not a historical number.
- Client-runtime tail rebase is new shared-runtime behavior; the web face needs regression coverage in the same change.
- The pending-interaction carrier is shaped by the web face's frame protocol; terminal interaction rendering couples to it, so a carrier change now has two consumers.
- Upstream client churn is high; the extraction PRs land first and independently so each web-face regression stays visible.
