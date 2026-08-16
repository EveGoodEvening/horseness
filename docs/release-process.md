# Release process

## Public package scope

The first public release is a fourteen-package npm train at `1.0.0`: eight `packages/*` packages, `@horseness/daemon`, `@horseness/cli`, and the four adapter packages. Every public manifest uses the MIT License, public npm access, and exact `workspace:1.0.0` internal source pins; packed manifests contain exact `1.0.0` dependencies.

`@horseness/bootstrap` remains private `0.0.0`. Its checked-in release envelope and trust root are fixture material for repository tests, not a supported public installer. Self-contained bootstrap delivery, offline archives, project-root ceremonies, KMS signing, custom immutable storage, and custom release receipts require a future ADR before publication.

## Candidate assembly

`release:coherence` validates the fourteen public manifests, the private deferred bootstrap manifest, and matching pnpm lockfile importers. `release:build-twice` packs the complete public train into `.release/build-1` and `.release/build-2`, writes one canonical manifest binding the source commit plus every package tarball size, SHA-256 digest, and npm SHA-512 integrity, and rejects any difference between the two inventories.

`release:verify-candidate` verifies both manifests and every tarball, installs all internal packages from the packed tarballs into a clean temporary project, imports every public package through `tsx`, and executes the installed `horseness` binary through its stable no-command validation path. No registry mutation occurs during C22.

## GitHub workflow phases

`.github/workflows/release.yml` is manual and main-only. Its `phase` input selects one operation:
Every dispatch names its phase, version, and candidate run. Later phases validate the upstream run's conclusion, event, branch, workflow, and exact run name before consuming it.

1. `publish-next` rebuilds and verifies the candidate, uploads `build-1` as a seven-day GitHub Actions artifact, then publishes every package under the `next` dist-tag with npm provenance.
2. `verify-public` accepts only a successful main-branch `publish-next` run for the exact version, downloads that run's candidate artifact, and compares every public npm integrity before clean exact-version install, signature audit, package import, and CLI smoke on Linux, macOS, and Windows.
3. `promote-latest` requires that exact candidate run and a successful `verify-public` run bound to it, compares npm integrity and `next` tags, moves all fourteen packages to `latest`, and creates the `v1.0.0` GitHub release at the candidate manifest's source commit. An existing tag must already resolve to that commit.

C23, C24, and C25 execute those phases without source edits. Their trackers record GitHub workflow URLs and observed npm metadata; they do not create custom signed journals or receipts.

## npm authentication and provenance

Brand-new npm packages cannot be configured for trusted publishing before they exist. The initial release therefore uses one short-lived, package-scoped granular npm token stored only in the protected GitHub `release` environment. The workflow never checks that value into the repository or prints it.

After package creation, later `publish-next` runs should use npm trusted publishing for `release.yml`. npm trusted publishing requires npm 11.5.1 or newer and Node 22.14.0 or newer; the workflow pins npm 11.6.2 and always requests npm provenance. Trusted publishing does not authorize dist-tag changes, so each C25 promotion uses maintainer 2FA or a separately provisioned short-lived package-scoped promotion token. No persistent npm release token is retained.

## Retry and partial publication

npm versions are immutable and a fourteen-package publish is not one registry transaction. `publish-next` therefore checks each exact version before mutation. A missing version is published. An existing version is accepted only when its registry integrity exactly matches the candidate tarball; otherwise the run fails. A matching partial publication is reconciled by repairing the `next` tag and continuing.

Promotion uses the same exact-integrity rule and refuses any package whose `next` tag does not name the candidate version. This registry lookup is ordinary npm reconciliation, not a second release receipt system.

## Current external prerequisites

C22 has no external prerequisite. C23 requires npm scope/package write authority and the protected `release` environment. C24 requires GitHub-hosted Linux, macOS, and Windows runners. C25 requires npm dist-tag authority and GitHub release write authority. No package is considered released until C25 completes.
