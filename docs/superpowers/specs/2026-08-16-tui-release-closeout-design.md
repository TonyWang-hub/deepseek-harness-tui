# TUI release closeout design

## Scope

This change closes the documentation and CI maintenance work after the TUI renderer release, then audits the repository for a patch release. It does not create or move a Git tag, publish packages, implement `/history`, or change terminal behavior.

## Documentation

Update the English and Chinese root, `packages/tui`, and `packages/tui/runtime` README pairs where they contradict the shipped renderer, profile, snapshot lane, or performance harness. Each README keeps facts at its owning level: the root summarizes product status, `packages/tui` names package roles, and the runtime README describes runtime configuration and retained limitations. Existing roadmap items remain roadmap items unless source and tests prove they ship.

Re-record every changed bilingual pair and run the documentation checks required for those files.

## TUI CI maintenance

Upgrade only the reusable actions in `.github/workflows/tui-ci.yml` that emit the Node 20 action-runtime warning. Preserve triggers, permissions, operating-system matrix, Node version under test, commands, and job ordering. Use maintained major versions consistent with the repository's tag-based action policy.

## Patch-release audit

Inspect the release scripts, package versions, tag position, and release documentation to determine the exact requirements for a `v0.1.1` patch release. Apply only mechanical metadata corrections that are necessary and proven by the release tooling. Report any operation that requires release authority instead of tagging or publishing.

## Parallel execution

One worker audits and edits the README pairs. A second worker audits the TUI workflow and patch-release prerequisites. The parent agent reviews both results, resolves overlap, and runs the narrow checks for documentation, workflow syntax or policy, release verification, and the final diff.

## Acceptance

- Current TUI behavior is described consistently in every changed README pair.
- The TUI CI workflow no longer uses an action runtime that produces the observed Node 20 deprecation warning.
- Release prerequisites and remaining authority-dependent steps are explicit.
- No tag or publication is created.
- The working tree passes the selected documentation, CI-policy, release, and diff checks.
