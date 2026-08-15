# Security policy

## Reporting vulnerabilities

Do not open a public issue for a suspected vulnerability. Report it privately to the repository maintainers with the affected version or commit, a minimal reproduction, the expected security boundary, and the observed result. Do not include provider credentials, subscription data, access tokens, cookies, authorization headers, private keys, or user content in a report.

Maintainers should acknowledge a report, reproduce it against a pinned candidate, classify the affected trust boundary, and coordinate remediation and disclosure. A report is not considered resolved until the public-edge reproduction is closed and the relevant security or system suite passes against the corrected candidate.

## Trust boundaries

Horseness treats protocol peers, adapter output, artifact paths, imported state, native-host contributions, installer inputs, daemon endpoint records, cursors, receipts, proposals, and retained recovery records as hostile until validated by their owning authority. Provider authentication remains owned by the native host. Claude and Codex live validation uses the invoking user's existing subscription session without reading, copying, hashing, logging, or revoking the native authentication store.

The project requires:

- exact workspace, run, task, attempt, generation, ForkPin, context, receipt, proposal, output, evidence, and decision binding;
- fail-closed authentication, scope, cursor, quota, policy, approval, and revocation checks;
- canonical state advancement only after a durable accepted decision;
- bounded framing, subprocess duration, output, evidence, tool calls, turns, and retained state;
- private regular-file and realpath confinement, with symlink and import substitution rejected;
- atomic journal, lock, install, upgrade, repair, and uninstall recovery across crash boundaries;
- daemon endpoint ownership and live process-incarnation validation rather than PID-only trust;
- provenance verification of pinned native archives, executables, packages, and installed contributions;
- redacted receipts and diagnostics that exclude credentials and provider account data.

## Validation suites

Run with Node 22 and the repository's pinned pnpm version:

```sh
corepack pnpm run test:security
corepack pnpm run test:system
corepack pnpm run test:closed-loop -- --hosts pi,omp,claude,codex
```

`test:security` aggregates hostile public-edge protocol, policy, authority, SQLite import/path, installer trust, journal, migration, repair, and uninstall behavior. `test:system` exercises completion predicates, the real daemon and SQLite authority, packed CLI lifecycle, neutral online/offline installation, hostile doctor behavior, and crash recovery. These suites invoke existing public package test entry points and public executables; they do not validate implementation source text.

`test:closed-loop` accepts only the exact ordered host list shown above and invokes the actual root `host:smoke:*` commands sequentially. It requires pinned native provenance, all five authority-produced outcomes, one canonical advance, resume/fork behavior, uninstall and revocation, and fresh candidate-bound Claude and Codex receipts with `authMode: existing-user-subscription-session`. Skips, synthetic decisions, hermetic substitutions, stale credential-reference routes, stale candidate receipts, and authentication data in output are failures.

Live Claude and Codex validation consumes the user's subscription and can fail closed when the native session, pinned model, provider, or host is unavailable. It must never attempt login, logout, credential extraction, or account mutation.
