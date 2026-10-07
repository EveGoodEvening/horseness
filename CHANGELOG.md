# Changelog

This project follows semantic versioning. Release notes describe the public package train.

## 1.0.0 — Unreleased

- Expanded the default test gate to all orchestrator and storage test directories plus root tooling checks; added unit coverage for branching task graphs, complete dependency joins, planner-size limits, and failed/cancelled dependency release.
- Added ordinary PR Linux e2e for system/installer blackboxes and real digest-verified Pi workflows, including failed prerequisites, cancellation, and restart persistence. Independent nested test runners now clear inherited Node test-worker state instead of silently skipping their tests; installation blackboxes deploy the real daemon without changing signed fixtures.
- Renamed CI and installer-smoke checks by responsibility instead of delivery chunk IDs, with descriptive historical-evidence steps; executable gates and receipt/artifact contracts are unchanged.
- Fixed CI and install-smoke startup by installing the manifest-pinned pnpm before Node setup initializes its pnpm cache.
- Restored the full CI gate chain: authenticated historical bootstrap checks use their sealed candidate, bootstrap tests launch the real daemon, and stale admission fixtures use current storage. TypeScript lint now covers its configured source/test targets without relaxing the existing rules.
- Fixed bootstrap through aliased temporary/workspace paths and Windows path containment; Windows bootstrap capabilities now use verified current-user-only protected DACLs instead of POSIX permission bits.
- Opened artifact-directory flush handles with write access on Windows while retaining fsync, crash hooks, verification and fail-closed error handling.
- Added explicit native `task dispatch/show`, planner `task breakdown/adopt`, dependency-aware `task execute`, opt-in automatic planning, cancellation, and explicit existing-workspace execution authorization. `task add` remains draft-only.
- Added immutable native execution profiles, durable launch intent and planner-result identity, authenticated output/evidence receipts, pre-handoff cancellation, and fail-closed unknown-outcome recovery without duplicate launches.
- Bound execution to current grant lineage, adapter scope, policy and authority observations; restricted receipt artifact references to the producing attempt and gated Codex turns on an empty complete MCP inventory.
- Added project-local `init`, `run create/list/use`, `task add/list`, and `status` workflows with readable help, generated IDs, authoritative cursor reads, and persisted exact mutation requests for explicit recovery.
- Added durable draft-task events and run/task listing without advancing canonical revision; stale writes and authorization failures remain fail-closed.
- Fixed CLI and daemon launchers to resolve their TypeScript loader from the installed package rather than the caller's working directory.
- Prepared fourteen public npm packages under the MIT License with exact `1.0.0` internal dependency pins.
- Added reproducible package packing, tarball install/import/bin smoke, npm integrity reconciliation, npm provenance publication under `next`, cross-platform exact-public verification, and guarded `latest` promotion.
- Made npm publication OIDC-first with per-package repository identity, explicit one-time bootstrap credentials, separate promotion credentials, and fail-closed tag reconciliation without unauthorized OIDC dist-tag changes.
- Deferred the fixture-mode `@horseness/bootstrap`, offline media, custom project trust ceremony, KMS signing, immutable storage, and custom release receipts.
- Kept the CLI and daemon executables runnable in isolated installs by publishing their TypeScript loader as a production dependency.
- Moved domain vector verification to the repository-only root command; `horseness-vectors-verify` is no longer a public package binary.
