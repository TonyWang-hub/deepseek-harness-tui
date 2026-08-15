# DeepSeek Harness TUI

English | [中文](README.zh.md)

**DeepSeek Harness TUI** is the full [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent harness plus an in-process terminal face: one Node process, the complete plugin runtime, and a terminal client that consumes the same client core the Web UI uses — no protocol re-implementation, and no listening socket in terminal mode.

> **Unofficial community product.** This project is not affiliated with or endorsed by DeepSeek. It tracks the upstream MIT-licensed [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) and carries the terminal work on top. Everything the upstream harness does, this repository does — the Web UI, headless runs, ACP, and the plugin ecosystem all work unchanged.

## Why in-process

Existing terminal clients for the harness are external protocol clients: they re-implement session semantics over the SDK/ACP wire, drift on upstream change, and cannot host in-process plugin contributions. This project instead mounts a second client cordis Context **inside the harness process**, wired to the host over an in-process fetch carrier:

```text
┌─ one Node process ───────────────────────────────────────────┐
│  Host Context: agents, sessions, tools, LLM, gateway         │
│        │  connection.inProcessHandler()   (no socket, no WS) │
│  Client Context: connection + Typert Remote + client runtime │
│        │  pending-interaction carrier (questions, approvals) │
│  Terminal renderer (Ink)                                      │
└──────────────────────────────────────────────────────────────┘
```

Because the terminal consumes the shared TypeScript client core, capability parity with the Web face is structural rather than aspirational: same host, same tools, same sessions, same approval and question carriers.

## Status

| Layer | State |
|---|---|
| In-process carrier: generation-owned event streams, abort contract, generic channel routing, webServer optional | ✅ Shipped — 28 adversarial regression tests, proven against the real DeepSeek API |
| Dual-context terminal runtime (`packages/tui/runtime`): zero-socket boot, reconnect across host recomposition, ask-user and approval through the pending carrier | ✅ Shipped |
| Node ESM publication of the client core (`./client-node` companions) | ✅ Shipped |
| Terminal renderer (Ink): scrollback commit plus bounded live region | ✅ Shipped |
| `tui` profile out of the box (`dsh --profile tui`) | ✅ Shipped |
| `/history` pager, client-runtime tail rebase, long-session performance gate | 🗺 Roadmap |

The design record lives in the [terminal-application Agent Note](.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md).

## Quickstart (development)

```sh
pnpm install
pnpm run build:lib:host && pnpm run build:lib:client
pnpm exec vitest run packages/tui/runtime    # dual-context slice, keyless
pnpm dsh web                                 # the full harness Web UI, unchanged
```

With `DEEPSEEK_API_KEY` exported, the real-model smoke proves the terminal composition against the live API:

```sh
pnpm exec vitest run --config vitest.e2e.config.ts packages/tui/runtime/tests/real-model-smoke.e2e.ts
```

## Run

The full harness runs exactly as upstream ships it. See the [Web UI guide](docs/user/guide/index.md).

```sh
pnpm dsh --profile tui               # the terminal application, in-process over the shared client core
```

### Run from source

```sh
git clone https://github.com/TonyWang-hub/deepseek-harness-tui.git
cd deepseek-harness-tui
pnpm install
pnpm run build
pnpm dsh web
```

## Relationship to upstream

This repository carries its own history: it roots at a snapshot import of upstream (currently `47f943859bef`), upstream syncs land as single import commits noted with their upstream range, and the terminal work stays concentrated in `packages/tui/*`, `packages/client/connection`, and `packages/host/apiproxy` so each sync stays small. This `README.md` pair is fork-owned (merge strategy: ours). Everything else — architecture, conventions, gates, documentation — is the upstream project's, unchanged: start at [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md), and for agents [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE), same as upstream. DeepSeek Harness is developed by [DeepSeek AI](https://deepseek.com); this fork adds the terminal application and its supporting carrier work. Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
