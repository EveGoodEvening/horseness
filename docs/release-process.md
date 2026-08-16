# Release process

## C22 pre-signing order

C22 is deliberately fail-closed. The offline root ceremony is performed and independently reviewed before any delegated signing, upload, or publication effect. The authoritative gate is `corepack pnpm run release:verify-root-ceremony -- --schema docs/trust/root-ceremony-v1.schema.json --record docs/trust/root-ceremony-v1.json --evidence docs/trust/evidence --offline --threshold 2-of-2`; its exact paths and policy options are mandatory. The verifier validates the exact `RootCeremonyRecordV1` shape, independently confirms the record is offline with a 2-of-2 root threshold, and checks distinct Ed25519 root and recovery keys, SPKI fingerprints, 2-of-3 recovery custody, witnesses, and content-addressed custody/destruction evidence. The repository contains the schema but does not contain a fabricated ceremony record or evidence.

`release:verify-delegation` then verifies two distinct root signatures over the version/range-bounded KMS delegation, the installer-compatible root signature, two distinct approvals, and the exact protected-main OIDC tuple. The tuple is issuer `https://token.actions.githubusercontent.com`, repository `EveGoodEvening/horseness`, workflow `refs/heads/main:.github/workflows/release.yml`, protected environment `release`, and branch `refs/heads/main`.

## Candidate assembly

All fifteen publishable manifests are released as one `1.0.0` train under the MIT License with public npm access. Source manifests use exact `workspace:1.0.0` internal specifiers so pnpm links the workspace during development; `pnpm pack` rewrites those specifiers to exact `1.0.0` dependencies in published manifests. `release:coherence` rejects any other version, private or non-public package, non-MIT package, or non-exact internal workspace pin.

`release:build-twice` packs the exact fifteen-package graph twice with a frozen epoch, emits a deterministic dependency graph, CycloneDX 1.6 SBOM, SLSA provenance statement, and release inventory, then requires the protected KMS signer to sign both manifest and provenance digests. It rejects any byte difference between unsigned build inventories. Fixture tests may use ephemeral test keys; fixture output is never accepted as production evidence.

The required live matrix runs all four native host smokes. Claude and Codex must produce fresh existing-user-subscription-session receipts bound to the exact candidate HEAD and tree. No provider authentication material is read, copied, hashed, logged, or stored.

## Immutable handoff and recovery

The immutable uploader accepts only `build-1` after reproducibility. It uses an ephemeral storage OIDC token, a declared future retention deadline, and a content-addressed HTTPS object. Every attempt records a signed intent before network mutation, looks up the digest before PUT, uses create-only semantics, then looks up and byte-verifies the object. A retry reconciles the existing object rather than uploading different bytes.

C22 journal records are canonical, domain-separated, hash-chained, append-only, and individually signed by the delegated KMS key. Concurrent append attempts fail closed. The final ignored `.acceptance/C22-artifact-receipt.json` binds the immutable URI, retention, complete artifact inventory, SBOM, provenance, both signatures, storage receipt, delegated key, and journal head. C23 consumes only that verified handoff.

## Workflows and secrets

`.github/workflows/release.yml` is manual, main-only, and uses the protected `release` environment. Repository permissions are read-only except `id-token: write` where OIDC is required. The workflows contain no static provider, KMS, registry, or storage credentials. Environment protection must require two human approvals outside repository YAML.

## Current external blockers

The version, license, and npm access decisions are complete. Release execution still requires the separately governed ceremony, delegation, signing, immutable-storage, and live-session inputs described above; this metadata change does not create or claim that evidence.
