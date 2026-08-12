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

Every host pin names a real native binary distribution and official validator by exact supported version, immutable identity, and SHA-256 distribution digest. Validation fails closed when either minimum is missing, tampered, incompatible, managed-blocked, or replaced by a CLI-only route.

## Hermetic provider

The local provider reads frozen request and response fixtures and binds its fixed identity, UTC clock, resource budget, canonical evidence ordering, and response bytes into a domain-separated evidence digest. Hermetic mode disables external network and credentials. It must prove native contribution discovery/load, context injection, one provider attempt, receipt binding, restart/reconcile or an explicit supported declaration, resume where supported, fork switch, and uninstall according to the capability matrix.

## Stable results

A result has exactly these fields: `schemaVersion`, `host`, `mode`, `status`, `reasonCode`, `nativeMinimumSatisfied`, `officialValidatorSatisfied`, `capabilities`, and `evidenceDigest`. Status is `pass`, `fail`, or `skip`. Hermetic acceptance cannot skip. A pass always requires both minimum flags.

## Credentialed-live policy

Credentials are opaque references; validators never read, print, hash, or persist secret values. In local/development mode, an absent allowlisted reference may skip with `LIVE_CREDENTIAL_ABSENT` only when the manifest does not require publication evidence. If the reference is configured, invalid credentials, provenance mismatch, redaction failure, budget breach, timeout, or host/model failure is fatal. Publication-required live validation fails with `LIVE_REQUIRED_CREDENTIAL_ABSENT` rather than skipping.

## Commands

- `pnpm run host:validate:pi`
- `pnpm run host:validate:omp`
- `pnpm run host:validate:claude`
- `pnpm run host:validate:codex`
- `pnpm run host:harness:test`
- `pnpm run hosts:matrix:verify`

The self-test covers passing evidence, missing/tampered/incompatible native distributions, official-validator absence, CLI-only refusal, exact one-line output, and live skip/fail rules.
