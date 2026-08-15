# @deepseek-ai/dsh-tui-ink-ui

English | [中文](README.zh.md)

The terminal application's Ink/React 19 dependency island. This cut (D2.0) is a reconnaissance spike: it stands up the package boundary and dependency island, then answers the three rendering-design questions the [official-terminal-application Agent Note](../../../.agents/notes/proposed/feature/2026-08-15-official-terminal-application.md)'s "Risks" section raises, each with a runnable proof of concept against a real pty. No renderer, input component, or live region ships from this package yet — that is a later cut (D2.2) once these conclusions are reviewed.

## Dependency selection

Ink's latest major (7.1.1) requires `react` and `@types/react` `>=19.2.0`; there is no Ink 6-vs-7 choice to make for React 19 support (Ink 6 already required React 19 too — see `npm view ink@6.0.0 peerDependencies`). This package pins `ink@^7.1.1` and `react@^19.2.8`, isolated from the browser client's `react@^18.2.0` tree the way every pnpm workspace member's own `node_modules` already isolates version islands — no root override, no shared instance. `@xterm/headless` and `node-pty` are devDependencies used only by the PoC scripts under `tests/`.

## Q1 — Scrollback commit without `<Static>`

**Verdict: feasible, but only through Ink's own `console.log()`/`patchConsole` plumbing — not a hand-rolled `instance.clear()` + `process.stdout.write()`.**

`ink/build/ink.js`'s `onRender` confirms the Note's reason for rejecting `<Static>`: `fullStaticOutput` (declared as `''` at construction, line 249) accumulates every `<Static>` child's rendered text forever (`this.fullStaticOutput += staticOutput`, lines 354 and 416) and is replayed as a whole on every `debug`-mode render — real memory growth with session length, exactly as the Note states.

The natural non-`<Static>` alternative — call the render instance's public `clear()`, `process.stdout.write()` the committed line, let the next state-driven render repaint the live region — was tested empirically (`tests/q1-scrollback-commit.poc.ts`, mode `raw-write`) and **fails**: the committed lines vanish from the final screen (0/5 present in the terminal projection, though each was written to the pty exactly once). Reading `Ink#clear()` explains why: it calls `this.log.clear()` then `this.log.sync(this.lastOutputToRender ...)`, which re-anchors log-update's internal "what's already on screen" bookkeeping to the *old* live-region content rather than to nothing. A raw `process.stdout.write()` in between is invisible to that bookkeeping, so log-update's next erase (cursor-relative, not row-number-relative) erases the wrong rows — in the PoC, both the just-committed line and the next live frame collapse onto the same one or two terminal rows instead of scrolling.

The strategy that works (`tests/q1-scrollback-commit.poc.ts`, mode `console-log`, 12/12 assertions pass) commits through `console.log()`. `render()` defaults `patchConsole: true`, which routes `console.log`/`console.error` through `Ink#writeToStdout`/`writeToStderr` (`ink/build/ink.js`): the same clear-then-write sequence, but followed by `restoreLastOutput()` — which replays the live region immediately and keeps log-update's bookkeeping synchronized with the real cursor position before any other code runs. This is Ink's own idiom for interleaving arbitrary writes with its live region, already exercised by the tests that ship in this Ink version; it is not a workaround this package invented.

**Design consequence for D2.2:** the renderer commits a closed step by calling `console.log()` (or an equivalent that goes through the same `writeToStdout` path), never by calling `clear()` and writing to `stdout` directly.

## Q2 — Borderless multiline input with asymmetric first-line/continuation-line prefixes

**Verdict: feasible; no maintained Ink package meets the need, so a from-scratch input is required and its hardest parts are proven tractable.**

`ink-text-input` (the closest maintained candidate) is single-line by construction: its `useInput` handler treats `key.return` as submit unconditionally and carries no line/row state (`ink-text-input@6.0.0`'s `build/index.js`). The only multiline candidate found on the npm registry, `ink-multiline-input@0.1.0`, published in January 2026, has no configurable asymmetric first-line/continuation-line prefix and no track record; it is not a substitute for the two difficulties the Note's Risks section names.

`tests/fixtures/q2-multiline-input-app.tsx` is a from-scratch multiline input proving both:

1. **Asymmetric prefix widths.** First line uses `❯ ` (2 display columns); every later row — a wrap continuation or the next logical line — uses `    ` (4 columns). The two row classes get different wrap budgets (`COLUMNS - prefixWidth`), computed once per rendered row, not assumed uniform.
2. **CJK-aware wrapping.** `string-width` (already a transitive Ink dependency; used directly here) measures each character's terminal column width, so wrapping never splits a double-width character or miscounts a mixed ASCII/CJK line.

The real terminal cursor — not a fake inverse-video block the way `ink-text-input` renders its caret — tracks the edit position through `useCursor()` (`ink/build/hooks/use-cursor.js`, shipped by Ink 7 itself; no cursor trick invented here).

`tests/q2-multiline-input.poc.ts` drives the fixture at a deliberately narrow 20-column width under a real pty with a keystroke script chosen so the expected wrap and caret position can be hand-derived (worked in the PoC's own comments), and all 4 assertions pass: the rendered rows match the hand-derived wrap exactly (including a row that lands on the exact 20-column boundary with no off-by-one), the real xterm cursor position after three left-arrows matches the hand-derived caret, and a Ctrl+D dump of the fixture's internal logical-line model matches the keystroke script independent of rendering.

**Design consequence for D2.2:** budget the input component as real, scoped work (edit model, wrap algorithm, cursor placement, and eventually IME/kitty-keyboard considerations for a real Shift+Enter), not an integration of an existing package. This PoC's LF-splitting keybinding (Ctrl+J, sent as a literal byte) stands in for "insert a line break without submitting"; a real Shift+Enter needs the kitty keyboard protocol or an equivalent terminal-specific escape, out of this spike's scope.

## Q3 — Terminal restoration on exit

**Verdict: already handled by Ink 7.1.1 on all three paths tested — no gap found requiring a custom patch.**

Reading `ink/build/components/App.js`'s unmount cleanup effect (`useEffect(() => () => { cliCursor.show(stdout); disableRawMode-if-still-enabled; bracketed-paste-off-if-still-enabled }, ...)`) shows Ink already restores cursor visibility, raw mode, and bracketed paste in one place, run whenever the React tree unmounts. `ink/build/ink.js` wires that unmount to fire on all three paths:

- **Normal exit**: `useApp().exit()` calls `onExit` → `Ink#handleAppExit` → `Ink#unmount()` → the tree unmounts → the cleanup effect runs.
- **Ctrl+C**: `App.js`'s `handleInput` checks `input === '\x03' && exitOnCtrlC` (default `true`) and calls `handleExit()` directly, which disables raw mode explicitly before the same unmount path runs.
- **Uncaught exception**: `this.unsubscribeExit = signalExit(this.unmount, { alwaysLast: false })` (`ink.js` constructor) hooks the `signal-exit` dependency's process-`exit`-event interception, which still fires after Node's default uncaught-exception handling unwinds (unless something calls `process.exit()` from inside a competing exit handler) — the same unmount path runs from there too.

`tests/q3-terminal-restoration.poc.ts` verifies this against real process state rather than trusting the source reading alone: for each of the three modes (`normal`, `ctrlc`, `throw`, in `tests/fixtures/q3-exit-app.tsx`), a real `bash` runs in its own pty, the fixture (which engages both raw mode via `useInput` and bracketed paste via `usePaste`) runs as its child, and once the fixture exits and the shell prompt returns, `stty -a` reads the pty's actual termios state — not a value read from inside the now-dead fixture process. Cursor visibility and bracketed paste are not termios bits, so those are read from the last relevant DEC private-mode escape sequence (`\x1b[?25h`/`l`, `\x1b[?2004h`/`l`) in the raw byte stream instead. All 12 assertions (4 facets × 3 modes) pass: `icanon` and `echo` are restored, the cursor is left shown, and bracketed paste is left disabled, on every path.

This result was unexpected against the Note's framing (which lists this as a risk to resolve) and against the historical precedent — the deleted pi-tui-based implementation needed a dist-layer dependency patch for terminal restoration. Ink has matured since: this spike found no gap that needs a custom patch for the three paths tested. Residual, untested-by-this-spike edges: SIGTERM specifically (not exercised — only Ctrl+C's raw byte and an uncaught exception were), a crash during the cleanup effect itself, and Linux (this spike ran on macOS/darwin only; the restoration mechanism — a React unmount effect plus the `signal-exit` dependency — is platform-neutral in principle, but is not re-verified here on Linux).

**Design consequence for D2.2:** no custom terminal-restoration shim is needed on top of Ink's own `render()`/`unmount()` lifecycle for the three paths tested here; budget time instead for the untested edges above if they matter to the shipped composition.

## Known Limitations and Deferred Work

- **No renderer, input component, or live region ships from this package** — this cut is the dependency island plus the three PoCs; `D2.2` is where a real component tree lands.
- **The PoC scripts under `tests/` are not vitest specs** (`*.poc.ts`, not `*.spec.ts` — see `vitest.config.ts`'s `testIncludes`), so nothing executes them on every commit; they spawn a real pty and drive wall-clock timers, which is slow and would add PTY/ANSI-parsing flakiness to the coverage gate for a spike whose evidence is meant to be read, not re-run on every commit. `tsconfig.client.json`'s `include` does cover them (`packages/tui/ink-ui/tests/**/*.ts(x)`), so `tsc -b tsconfig.client.json` still statically type-checks both the PoC drivers and their fixtures — only their real-pty execution is kept out of the ordinary test/coverage run. Run them manually: `pnpm exec tsx packages/tui/ink-ui/tests/q1-scrollback-commit.poc.ts` (and `q2-...`, `q3-...`).
- **Q3 covers macOS only** — the mechanism (a React unmount effect plus the `signal-exit` dependency) is platform-neutral in principle; Linux is not re-verified by this spike.
- **Q2's line-break keybinding (Ctrl+J) is a PoC stand-in** — a real Shift+Enter needs the kitty keyboard protocol or a terminal-specific escape sequence, deferred to the renderer cut.
