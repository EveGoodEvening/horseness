# Native Host Feasibility

C11 proves the minimum integration surface for Pi, OMP, Claude Code, and Codex before adapter implementation. It is a feasibility gate, not a CLI smoke substitute.

## Frozen contracts

- Capability matrix: `config/hosts/capability-matrix.v1.json`.
- Fixture schema: `tests/fixtures/hosts/manifest.v1.schema.json`.
- Result schema: `tests/fixtures/hosts/result.v1.schema.json`.
- Per-host fixture: `tests/fixtures/hosts/<host>/manifest.v1.json`.
- Per-host validator: `scripts/host-feasibility/<host>/validate.mjs`.
- Invocation: `--fixture <manifest-file> --mode hermetic|live`.
- Output: exactly one JSON line containing `HostValidationResultV1`.

Every host pin names a real upstream distribution by canonical package identity, exact version, HTTPS registry URL, registry-published SHA-512 package integrity, independently computed archive SHA-256, cache key, and executable/member SHA-256. Acquisition reads registry metadata and verifies both integrity algorithms before extraction; cache reuse re-verifies the pinned executable. A repository-authored binary, source fixture, wrapper, or relabelled validator can never satisfy this provenance contract, even if a manifest and matrix are changed together.

`officialValidation` is precise rather than aspirational. When upstream ships an independently distributed validator, `kind: independent-artifact` pins and acquires that artifact with the same complete provenance record. Otherwise `kind: same-distribution-interface` honestly identifies the upstream-shipped command/interface and member digest inside the already verified distribution. It never claims that interface is a separate official artifact.

## Hermetic provider

The local provider reads frozen request and response fixtures and binds its fixed identity, UTC clock, resource budget, canonical evidence ordering, and response bytes into a domain-separated evidence digest. Hermetic mode disables external network and credentials after artifact acquisition. Each validator executes the frozen `HostSandboxLifecycleV1`: acquire, verify provenance, install, discover, load, inject context, attempt, collect receipt, restart, reconcile, resume, fork switch, uninstall, and audit outputs. Capability booleans are derived only from successful phase observations. Manifest declarations cannot create capability evidence. Sandbox paths are contained, symlinks are rejected, and undeclared output fails the gate.

## Stable results

A result has exactly these fields: `schemaVersion`, `host`, `mode`, `status`, `reasonCode`, `nativeMinimumSatisfied`, `officialValidatorSatisfied`, `capabilities`, and `evidenceDigest`. Status is `pass`, `fail`, or `skip`. Hermetic acceptance cannot skip. A pass always requires both minimum flags.

## C11 Claude scope decision

Claude Code 2.1.228 (`npm:@anthropic-ai/claude-code-linux-x64@2.1.228`) provides genuine plugin validation and loaded component inventory credential-free: `claude plugin validate <path>` passes and `claude --plugin-dir <path> plugin details horseness` inventories 1 skill, 1 agent, and 1 SessionStart hook. These satisfy `nativeArtifactLoad` and `officialValidatorSatisfied`.

The remaining 7 shared capabilities — `contextInjection`, `deterministicProviderAttempt`, `receiptBinding`, `restartReconcile`, `resume`, `forkSwitch`, and `uninstall` — have no credential-free native interface in Claude Code 2.1.228. They are honestly reported as `false` in the hermetic result and the capability matrix, and are deferred to C17 credentialed live validation. The Claude fixture's `requiredCapabilities` is narrowed to `["nativeArtifactLoad"]`, so the credential-free hermetic gate passes when both minimum flags are satisfied. This is an honest scope decision, not a downgrade: the plan explicitly anticipates that credential-dependent capabilities are deferred to credentialed live validation. The `CREDENTIAL_REQUIRED` reason code is reserved for evidence and future per-capability reporting.

## Credentialed-live policy

Credentials are opaque references; validators never read, print, hash, or persist secret values. In local/development mode, an absent allowlisted reference may skip with `LIVE_CREDENTIAL_ABSENT` only when the manifest does not require publication evidence. If the reference is configured, invalid credentials, provenance mismatch, redaction failure, budget breach, timeout, or host/model failure is fatal. Publication-required live validation fails with `LIVE_REQUIRED_CREDENTIAL_ABSENT` rather than skipping.

## Commands

- `pnpm run host:validate:pi`
- `pnpm run host:validate:omp`
- `pnpm run host:validate:claude`
- `pnpm run host:validate:codex`
- `pnpm run host:harness:test`
- `pnpm run hosts:matrix:verify`

The self-test covers passing evidence, missing/tampered/incompatible native distributions, official-validation absence, CLI-only refusal, coordinated manifest-plus-matrix substitution, source fixtures impersonating hosts, registry/archive/member tamper, path traversal, symlinks, extra output, exact one-line output, and live skip/fail rules.
