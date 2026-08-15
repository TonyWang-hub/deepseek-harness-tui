# Security Policy

DeepSeek Harness TUI is an unofficial community product tracking the upstream [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) project.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub security advisories](https://github.com/TonyWang-hub/deepseek-harness-tui/security/advisories/new) — do not open a public issue for an unpatched vulnerability.

A vulnerability in the upstream harness itself (anything outside `packages/tui/*`, `packages/bundle/tui-app`, and this fork's carrier changes in `packages/client/connection` / `packages/host/apiproxy`) should also be reported to the upstream project through its own channels; this repository will track and ship the upstream fix through its normal sync procedure.

## Scope notes

The terminal composition binds no listening socket by design; the in-process carrier deliberately bypasses the browser Host/Origin trust fence because a same-process caller is inside the trust domain that fence establishes over a socket it never crosses. The privileged loopback-pinned method set is reachable through that carrier — treat any change that exposes the in-process handler to a network route as a vulnerability.
