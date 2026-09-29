# Release process

## Public package scope

The first public release is a fourteen-package npm train at `1.0.0`: eight `packages/*` packages, `@horseness/daemon`, `@horseness/cli`, and the four adapter packages. Every public manifest uses the MIT License, public npm access, and exact `workspace:1.0.0` internal source pins; packed manifests contain exact `1.0.0` dependencies.

`@horseness/bootstrap` remains private `0.0.0`. Its checked-in release envelope and trust root are fixture material for repository tests, not a supported public installer. Self-contained bootstrap delivery, offline archives, project-root ceremonies, KMS signing, custom immutable storage, and custom release receipts require a future ADR before publication.

## Candidate assembly

`release:coherence` validates the fourteen public manifests, the private deferred bootstrap manifest, and matching pnpm lockfile importers. `release:build-twice` packs the complete public train into `.release/build-1` and `.release/build-2`, writes one canonical manifest binding the source commit plus every package tarball size, SHA-256 digest, and npm SHA-512 integrity, and rejects any difference between the two inventories.

`release:verify-candidate` verifies both manifests and every tarball, installs all internal packages from the packed tarballs into a clean temporary project, imports every public package through `tsx`, and executes the installed `horseness` binary through its stable no-command validation path. No registry mutation occurs during C22.

## GitHub workflow phases

`.github/workflows/release.yml` is manual and main-only. Its `phase` input selects one operation; `bootstrap` defaults to `false` and applies only to initial package creation in `publish-next`.
Every dispatch names its phase, version, and candidate run. Later phases validate the upstream run's conclusion, event, branch, workflow, and exact run name before consuming it.

1. `publish-next` rebuilds and verifies the candidate, uploads `build-1` as a seven-day GitHub Actions artifact, then publishes every package under the `next` dist-tag with npm provenance. Normal publication uses OIDC without an npm secret.
2. `verify-public` accepts only a successful main-branch `publish-next` run for the exact version, downloads that run's candidate artifact, and compares every public npm integrity before clean exact-version install, signature audit, package import, and CLI smoke on Linux, macOS, and Windows.
3. `promote-latest` requires that exact candidate run and a successful `verify-public` run bound to it, compares npm integrity and `next` tags, moves all fourteen packages to `latest`, and creates the `v1.0.0` GitHub release at the candidate manifest's source commit. An existing tag must already resolve to that commit.

C23, C24, and C25 execute those phases without source edits. Their trackers record GitHub workflow URLs and observed npm metadata; they do not create custom signed journals or receipts.

## npm authentication and provenance

ADR 0010 makes [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) the default. The workflow uses a GitHub-hosted runner, job-local `id-token: write`, the protected `release` environment, Node `22.18.0`, and npm `11.6.2` (npm requires Node 22.14.0+ and npm 11.5.1+). Release jobs do not use dependency caching. The normal publication step receives no npm token and rejects a supplied `NODE_AUTH_TOKEN` or `NPM_TOKEN` instead of silently falling back. It requires both GitHub OIDC request variables; `npm whoami` is not an OIDC readiness check because exchange occurs during `npm publish`.

All fourteen public manifests bind `git+https://github.com/EveGoodEvening/horseness.git` and their own `repository.directory`. Coherence checks that identity before packing. Provenance requires both the public GitHub repository and public npm packages; the workflow keeps `--provenance` explicit for the bootstrap exception as well as OIDC publication.

### Configure each existing npm package

In npmjs.com, open each package's **Settings → Trusted publishing → Add trusted publisher → GitHub Actions**. Use these exact, case-sensitive values:

| Field | Value |
|---|---|
| Organization or user | `EveGoodEvening` |
| Repository | `horseness` |
| Workflow filename | `release.yml` (not `.github/workflows/release.yml`) |
| Environment name | `release` |
| Allowed actions | Enable direct `npm publish`; stage-only permission is insufficient |

Apply this to `@horseness/domain`, `protocol`, `policy`, `store-sqlite`, `orchestrator`, `sdk`, `adapter-kit`, `installer`, `daemon`, `cli`, `adapter-pi`, `adapter-omp`, `adapter-claude`, and `adapter-codex` (all under the `@horseness` scope). Do not configure or publish the private `@horseness/bootstrap` package.

On GitHub, configure the `release` environment with maintainer approval and deployment limited to `main`. Keep this workflow filename and environment aligned with npm settings. npm does not validate the configuration when it is saved; a real publish is required to prove the trust relationship. Connections cannot be edited in place: remove and recreate an incorrect connection.

After configuration, dispatch normally without supplying an npm secret:

```sh
gh workflow run release.yml --ref main -f phase=publish-next -f version=1.0.0
```

Once OIDC publication works, revoke/delete the old generic `NPM_TOKEN` and bootstrap credential. Follow npm's token-access restrictions for publication while accounting for the separate dist-tag authority described below; OIDC does not replace that authority.

### Initial package creation only

Brand-new packages cannot have a trusted publisher configured before they exist. Do not publish placeholder packages to reserve the names. For initial creation of the real fourteen-package candidate:

1. Provision a short-lived granular token with the minimum `@horseness` scope/package creation authority needed, and store it as `NPM_BOOTSTRAP_TOKEN` in the protected `release` environment.
2. Dispatch `publish-next` with `bootstrap=true`. Only the explicit bootstrap step receives this secret; the script additionally requires `--bootstrap` and refuses an empty credential.
3. Reconcile any partial initial publication against the same candidate integrity, then revoke the token and delete the environment secret. Configure each now-existing package's trusted publisher before the next normal publication.

```sh
gh workflow run release.yml --ref main -f phase=publish-next -f version=1.0.0 -F bootstrap=true
```

This one-time exception is not a fallback when OIDC fails. Keep `bootstrap=false` for subsequent releases. `actions/setup-node` configures token-based registry authentication only for this exception; the normal publication job avoids its generated auth token placeholder.

### Separate promotion authority

Trusted publishing authorizes `npm publish` and `npm stage publish`, not `npm dist-tag add`. C25 therefore still requires a separately provisioned short-lived, package-scoped `NPM_PROMOTION_TOKEN` in the protected `release` environment. It is exposed only to the promotion step, not dependency installation or GitHub release creation. The old generic `NPM_TOKEN` is no longer consumed. Revoke/delete the promotion credential after the phase completes.

Run `verify-public` with the successful publication run's ID, then `promote-latest` with that same candidate ID and the successful verification run's ID. Both phases retain their exact upstream-run checks; OIDC does not weaken the three-OS verification requirement.

## Retry and partial publication

npm versions are immutable and a fourteen-package publish is not one registry transaction. `publish-next` checks each exact version before mutation. A missing version is published with `--tag next`. An existing version is accepted only when its registry integrity exactly matches the candidate tarball and `next` already names that version. A matching partial publication can continue without republishing existing versions.

If `next` is absent or points elsewhere, publication stops with `NPM_NEXT_TAG_MISMATCH`; it never attempts an OIDC-authorized dist-tag repair. Inspect the candidate and registry integrity, then have a maintainer repair the exact package/version with separate npm authority (for example, `npm dist-tag add @horseness/domain@1.0.0 next` with interactive/2FA authentication). Retry the unchanged candidate afterward. Never switch to bootstrap mode merely to bypass a tag or OIDC failure.

Promotion uses the same exact-integrity rule and refuses any package whose `next` tag does not name the candidate version. This registry lookup is ordinary npm reconciliation, not a second release receipt system.

## Current external prerequisites

C22 has no external prerequisite. C23 requires the protected `release` environment and either configured package-level npm trusted publishers or the explicit initial-creation exception. C24 requires GitHub-hosted Linux, macOS, and Windows runners. C25 requires separate npm dist-tag authority and GitHub release write authority. No package is considered released until C25 completes. Repository edits and local smoke do not configure npm settings or prove a real GitHub OIDC exchange.
