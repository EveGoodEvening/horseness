# Installer contract

## Public release scope

The npm-first `1.0.0` train publishes `@horseness/installer` as a library but does not publish `@horseness/bootstrap`, a self-contained installer executable, or offline installation media. The signed-bundle bootstrap described below remains a repository-tested deferred contract. Fixture release envelopes and fixture trust roots are not production installation inputs.

Users of the first public train install exact npm packages through npm. A future public one-command or offline installer requires a new ADR and production distribution trust implementation.

## Deferred signed-bundle trust boundary

The installer can authenticate a frozen `horseness.signed-release-manifest.v1` before changing installer state. Verification binds the Ed25519 project root, its sequence-bounded release-key delegation, the release-manifest digest and signature, every artifact byte length and SHA-256 digest, the dependency-graph digest, and the required Sigstore issuer, repository, workflow, and protected environment. Revoked, undelegated, expired, replayed, substituted, or tampered releases fail closed. Release artifacts declaring lifecycle scripts are refused.

`InstallConsentV1` binds the verified release-manifest digest, sorted artifact digests, exact requested host set, executable capability set, install scope, local OS platform/architecture/account identity, timestamp, and consent mode. Interactive use requires the exact answer `yes`; unattended use requires the exact release-manifest digest. Missing or stale consent is rejected before mutation.

C19 deliberately does not write host configuration or run host lifecycle operations. C20 consumes these verified records in repository fixture and system validation for install, repair, doctor, and uninstall behavior.

## Journal durability

Installer state uses an owner-private directory and append-only generation files. Every exact-schema record carries its generation, sequence, previous hash, payload, and domain-separated record hash. Readers authenticate raw persisted bytes and the complete chain before upcasting the supported N-1 record. Unknown newer schemas fail before append or migration.

A migration writes and fsyncs state and journal transitions for begin, backup, stage, activation, compensation, repair-required, and uninstall-after-upgrade intent. Staging and backups remain confined below the owner-private installer authority root.

## Compatibility train

`0.0.0-compat.1` is a non-public signed fixture release. Its deterministic packed artifact contains the prior database, journal, daemon, CLI, and installer-facing migration metadata needed to initiate the first migration. `compat-train:build` reconstructs the bytes from frozen sources; `compat-train:verify` compares those bytes, verifies source/artifact/manifest/dependency digests and fixture signing provenance, and runs offline.

## Neutral bundle operations

C20 consumes `horseness.neutral-install-bundle.v1`, a closed sorted catalog for Pi, OMP, Claude, and Codex. Every record binds platform support, pinned native-host version, package and source-artifact digests, a confined target, and exact contribution bytes with size, content, archive, and member digests. Installer runtime never imports an adapter package or executes adapter contribution code.

The deferred one-command bootstrap requires an absolute `--workspace` and explicit `--create-workspace` when creation is intended. Before workspace, host-root, daemon, or installer mutation, it authenticates the signed release manifest and verifies the dependency graph, catalog, every contribution byte, package digest, and neutral catalog binding before constructing `NeutralInstallBundleV1`. The public npm-first release makes no claim that this bootstrap is available.

User state and data use the ADR 0007 POSIX or Windows roots; workspace scope uses `<workspace>/.horseness/install/{state,data}`. Managed bytes live below the data bundle digest and are atomically activated into owner-controlled host discovery roots. Every target has an owner-private marker binding workspace, account, release, package, source, contribution target, operation, and grant. Unmarked targets and drift are never overwritten.

Upgrade, downgrade, rollback, and retry-install use retained per-host generations and authenticated installer journals. Ordinary failure compensates to the prior marker and bytes; process crashes leave a resumable phase for `retry-install`. Uninstall persists a kill switch, disables discovery, revokes the opaque daemon grant, then removes managed bytes and markers. Doctor remains strictly read-only; repair is the separate mutating operation.

Exit status is `0` for complete success, `1` for operational failure, `2` for invalid invocation, `3` for partial per-host success, and `4` for consent or trust refusal. Unsupported explicitly requested hosts fail without mutation; multi-host mode preserves successful hosts unless `--atomic-hosts` requests compensation.
