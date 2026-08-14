# Installer contract

## C19 journal and trust boundary

The installer authenticates a frozen `horseness.signed-release-manifest.v1` before it changes installer state. Verification binds the Ed25519 project root, its sequence-bounded release-key delegation, the release-manifest digest and signature, every artifact byte length and SHA-256 digest, the dependency-graph digest, and the required Sigstore issuer, repository, workflow, and protected environment. Revoked, undelegated, expired, replayed, substituted, or tampered releases fail closed. Release artifacts declaring lifecycle scripts are refused.

`InstallConsentV1` is the only C19 consent record. It binds the verified release-manifest digest, sorted artifact digests, exact requested host set, executable capability set, install scope, local OS platform/architecture/account identity, timestamp, and consent mode. Interactive use requires the exact answer `yes`; unattended use requires the exact release-manifest digest. Missing or stale consent is rejected before mutation.

C19 deliberately does not write host configuration or run host lifecycle operations. C20 consumes these verified records when it implements install, repair, doctor, and uninstall operations.

## Journal durability

Installer state uses an owner-private directory and append-only generation files. Every exact-schema record carries its generation, sequence, previous hash, payload, and domain-separated record hash. Readers authenticate raw persisted bytes and the complete chain before upcasting the supported N-1 record. Unknown newer schemas fail before append or migration.

A migration writes and fsyncs state and journal transitions for begin, backup, stage, activation, compensation, repair-required, and uninstall-after-upgrade intent. Staging and backups remain confined below the owner-private installer authority root.

## Compatibility train

`0.0.0-compat.1` is a non-public signed fixture release. Its deterministic packed artifact contains the prior database, journal, daemon, CLI, and installer-facing migration metadata needed to initiate the first migration. `compat-train:build` reconstructs the bytes from frozen sources; `compat-train:verify` compares those bytes, verifies source/artifact/manifest/dependency digests and the project-root delegation, and reports fixture signing provenance. Both commands are offline.
