# Horseness Threat Model

## Assets and trust boundaries

Canonical event chains, policy documents, ForkPins, context artifacts, attempt receipts, credentials, installer journals, release manifests, and publication receipts are protected assets. Trust boundaries are: local user to authenticated daemon; adapter process to SDK; daemon to SQLite and content-addressed storage; bootstrap to installer; CI to immutable artifact storage; and release signer to registries and mutable channels.

## Principals and adversaries

Local sibling users, protocol-confined malicious adapters, malicious evidence producers, hostile imported archives, interrupted installers, compromised mirrors, unauthorized CI jobs, and stale workers are adversaries. Local host administrators, the selected release-signing quorum, daemon/installer trust base, and the host OS access-control boundary remain trusted. Plugins execute with host-user privilege and are not sandboxed; arbitrary compromise of a process running as that same OS user is outside the v1 protection boundary.

## Required controls

Every command is authenticated and authorized at a typed observation cursor under exhaustive `CommandAuthorizationMatrixV1`; omission is denial. Secrets remain opaque references. Artifact bytes are verified before reference. Dispatch commits a durable launch intent before provider invocation and unknown outcomes fail closed. Successful attempt receipts do not release canonical-change dependencies before the bound durable `DeltaAcceptedV1`. Imports are quarantined. Default doctor is non-executing. Uninstall writes a persistent kill switch before discovery removal, but its tamper-resistance guarantee assumes the daemon/installer trust base and OS-user boundary remain intact. Releases require signed checkpoint envelopes, both project-root authorization and Sigstore provenance, immutable staging, exact-byte four-host closed-loop verification, promotion verification, and only then announcement.

## Ordinary release signing

The project root delegates a version-bounded release key held by a hardware-backed KMS. A protected-environment CI job requests one signature per release-manifest digest using short-lived OIDC; KMS policy requires repository, workflow reference, protected environment, release version, and two distinct maintainer approvals. The signature artifact is `dist/signatures/release-manifest.project-root.json`; its audit receipt records manifest digest, delegated key ID, root delegation digest, KMS operation ID, approver identities, and transparency timestamp. CI receives only the signature and receipt, never key material. Rotation publishes a new root-signed delegation before use. Revocation publishes the affected delegation/release digest before replacement. Break-glass root changes require the offline threshold root ceremony.

## Abuse cases and verification

C21 covers forged actors, stale or scope-insufficient cursors, cross-role/cross-workspace authorization, receipt/core/signature/envelope/trust-key substitution, unknown/duplicate/revoked/out-of-window keys, noncanonical timestamps, untrusted time, symlinks, artifact-root escape, credential leakage, malicious paths, policy bypass, launch-intent races, and acceptance-dependent task release races across crashes/restarts. It verifies protocol-confined adapters cannot synthesize admission or cross task/generation and that all four native return loops surface pending/nonaccepted outcomes without dependent dispatch. It tests protocol-confined compromised adapters, not arbitrary same-user code execution. C22 covers authorized and unauthorized project-root signers; C22–C25 cover every signed external-effect intent/result and exact-digest reconciliation.
