# ADR 0009: npm-first release and deferred custom trust

## Status
Accepted.

## Context

C00–C21 delivered the core, adapters, installer state machine, and system validation. C22 then implemented a release design based on an offline 2-of-2 project root, delegated KMS signing, a custom immutable object store, signed side-effect journals, and custom release/live receipts. The locally reachable C22 implementation completed, but the release remained blocked because none of that production trust infrastructure had been provisioned.

On 2026-08-16 the user explicitly directed the project to adopt a simplified npm release and delete or defer the custom trust ceremony, KMS, immutable-storage receipt, and release-receipt system. A direct root publish is not acceptable: the repository root is a private development workspace, and its npm dry run includes repository, test, fixture, and workspace output rather than the intended package set.

The current `@horseness/bootstrap` package is fixture-trust-only. Publishing it as a production entry point would misrepresent test material as a supported public bootstrap. npm trusted publishing also cannot bootstrap a brand-new package because the package must already exist before a trusted publisher can be configured.

## Decision

The first public release is npm-first.

- Publish exactly fourteen packages: the eight `packages/*` packages, `@horseness/daemon`, `@horseness/cli`, and the four adapter packages. All use one exact release version, public access, MIT licensing, and exact internal version pins.
- Defer `@horseness/bootstrap`, the self-contained signed release envelope, offline archive, project-root ceremony, delegated KMS signer, custom immutable storage, signed release journals, custom artifact receipts, and release-specific Claude/Codex live receipts. `@horseness/bootstrap` returns to private `0.0.0` development metadata and remains available only for repository fixture/system validation.
- Preserve installer runtime invariants, neutral bundle validation, path confinement, consent, journal durability, doctor non-mutation, uninstall safety, C00/C01 historical receipts, and product worker receipts. This ADR changes release distribution trust, not runtime authority or historical evidence.
- Trust the npm registry package integrity, npm-generated provenance, the GitHub source repository, and a protected GitHub `release` environment for the npm release. The repository does not create a second project-specific signing root for v1.
- Use the release state sequence `candidate_packed -> next_published -> public_verified -> latest_promoted -> github_released`. GitHub Actions job results and npm registry metadata are ordinary operational evidence; no checked-in custom signed receipt or side-effect journal is created.
- C22 implements one workflow and the local scripts for all later npm phases, but performs no registry mutation. C23 runs the protected `publish-next` phase. C24 runs exact-version package installation/import/bin smoke on Linux, macOS, and Windows. C25 promotes the verified version to `latest` and creates the GitHub release.
- The first publication uses a short-lived, package-scoped npm granular token held only in the protected GitHub environment because trusted publisher configuration requires each package to exist. The token is removed after the initial release. Subsequent releases should configure npm trusted publishing for `release.yml`; npm trusted publishing requires npm 11.5.1 or newer and Node 22.14.0 or newer.
- Publication is retryable through npm registry lookup: an existing exact version is accepted only when its registry integrity matches the locally packed tarball. This is registry reconciliation, not a custom receipt system.

## Consequences

The first release no longer claims a project-root-authenticated bootstrap, offline installation media, release-key rotation/revocation, compromise recovery independent of npm/GitHub, custom immutable retention, or exact-public live provider-session evidence. Those capabilities require a future ADR and dedicated chunks before they can become public guarantees.

The fourteen npm packages can be released without the unavailable ceremony/KMS/storage infrastructure. The release still separates candidate packing, `next` publication, exact-public cross-platform verification, and `latest` promotion so a broken tarball does not become the default install.

The bootstrap and installer fixture tests remain valuable deterministic tests, but fixture keys, fixture manifests, and fixture trust roots are not publishable production evidence.

## Rejected alternatives

- Keeping C22 blocked until bespoke trust infrastructure is provisioned.
- Publishing the repository root or the fixture-mode bootstrap package.
- Moving `latest` before installing and exercising the exact public packages.
- Fabricating ceremony, KMS, immutable-storage, live-session, or receipt evidence.
- Publishing all packages directly under `latest` with no candidate tag or public-artifact verification.
