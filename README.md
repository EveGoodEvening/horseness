# Horseness

Horseness is a planned local-first, provider-neutral orchestration system for auditable multi-agent work. One authorized authority owns a revisioned `CanonicalDocument`; workers operate from immutable, versioned `ForkPinCoreV1` source views and submit sealed, typed, evidence-bound deltas within a pin-bound `DeltaAuthorityScopeV1`. Typed absent-genesis, workspace-only, run-only, and full composite observation/result cursors make first authority, first run, and ordinary operations constructible. Current command authorization remains separate from pinned context reconstruction. Only a conjunctive pinned-plus-current-policy `accepted` decision advances canonical state, and `TaskCompletionPolicyV1` prevents acceptance-dependent downstream work from releasing before durable `DeltaAcceptedV1`.

The target uses Node.js 22, strict TypeScript, ESM, pnpm, SQLite WAL, and append-only streams. It includes an authenticated daemon/CLI with exhaustive main-agent orchestration commands, deterministic context reconstruction, credentialed native `WorkerReturnV1` proposal/decision loops for Pi/OMP/Claude Code/Codex, signed checkpoint envelopes, and journaled install, uninstall, upgrade, rollback, repair, and read-only doctor workflows.

Implementation status is intentionally maintained only in [docs/progress.md](docs/progress.md), so this overview remains accurate throughout delivery.

## Planning documents

- [Architecture and invariants](docs/architecture.md)
- [Dependency-ordered delivery plan and planning review log](docs/plan.md)
- [Authoritative progress and remediation ledger](docs/progress.md)
- [Repository conventions](AGENTS.md)

## Planned installation interface

The security contract does not execute an npm package and then ask it to verify itself. Release pages provide a self-contained, script-free bootstrap executable plus a signed manifest verified by both the pinned project root and the required Sigstore identity. After that detached platform verification, setup is exactly one Horseness invocation: POSIX `./horseness-bootstrap install --manifest <verified-manifest-path-or-url> --scope user --workspace <absolute-path-or-workspace-id> --host all --accept-executable-risk <releaseManifestDigest>` or Windows `.\horseness-bootstrap.exe install --manifest <verified-manifest-path-or-url> --scope user --workspace <absolute-path-or-workspace-id> --host all --accept-executable-risk <releaseManifestDigest>`. Creating a workspace additionally requires `--create-workspace`; selection is never implicit. The same syntax accepts offline local media.

That invocation installs and starts the daemon, establishes first authority when needed, provisions opaque adapter credential references, installs all selected native contributions, journals the exact normalized workspace binding, records executable-risk consent, and runs non-executing static doctor; no later Horseness command or manual configuration is permitted. Reinstall, upgrade, and rollback retain that workspace binding; rebinding is a separate authorized operation. `--host all` reports every host; unsupported/managed hosts are errors, absent hosts are no-ops, per-host transactions are default, and `--atomic-hosts` requests compensation of all hosts.

Local plugins, hooks, agents, and skills run with host-user privileges. Integrity authenticates bytes but does not sandbox semantics; arbitrary same-user process compromise is outside the v1 protection boundary. Default doctor never loads contributions. Uninstall writes a local capability kill switch first, disables discovery even while authority revocation is pending, then removes unchanged bytes or quarantines drift; those guarantees assume the daemon/installer trust base and OS access-control boundary remain intact.

Bootstrap integration and release identity use exactly `refs/heads/main`. Production claim/checkpoint authorization validates canonical live files, complete index chains, integrated Git ancestry, Ed25519 trust scope/revocation, symlink-free paths, canonical UTC-second timestamps, and explicit trusted time; synthetic receipt/resume tests are isolated in a dedicated fixture bundle.
