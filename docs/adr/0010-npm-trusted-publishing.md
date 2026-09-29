# ADR 0010: OIDC-first npm trusted publishing

## Status

Accepted by explicit user direction on 2026-09-29. Supersedes only ADR 0009's optional trusted-publishing migration; the fourteen-package train and three release phases remain unchanged.

## Context

The release workflow injects the same `NPM_TOKEN` into publication and promotion. Publication reconciliation also calls `npm dist-tag add`, which npm OIDC does not authorize. All fourteen public manifests lack the repository identity required by npm provenance and trusted publishing.

The [npm trusted-publisher contract](https://docs.npmjs.com/trusted-publishers) requires npm 11.5.1+, Node 22.14.0+, a supported hosted runner, and package-level trust configuration. The GitHub identity is case-sensitive: owner `EveGoodEvening`, repository `horseness`, workflow filename `release.yml`, environment `release`. New configurations must explicitly allow direct `npm publish`; stage-only permission does not authorize this workflow. Package creation remains a separate bootstrap prerequisite. OIDC does not authorize dist-tag changes.

## Decision

- Keep `publish-next`, `verify-public`, and `promote-latest` in the manual, main-only `.github/workflows/release.yml` workflow. Preserve exact candidate/run/integrity binding and npm provenance.
- Default `publish-next` to OIDC on a GitHub-hosted runner, with job-local `id-token: write` and the protected `release` environment. Do not supply a publishing token or silently fall back to one. Require both GitHub OIDC request variables before publication.
- Retain initial package creation only through an explicit `bootstrap` boolean input, default `false`. Only that publication step receives the short-lived `NPM_BOOTSTRAP_TOKEN`; the script requires an explicit `--bootstrap` flag. Do not publish placeholder packages. Revoke and remove the credential after initial publication, then configure each package's trusted publisher before normal publication.
- Give every public manifest the same Git repository URL plus its monorepo directory. Coherence must reject absent or mismatched repository identity before packing.
- Retry existing exact versions only when integrity and the `next` tag both match. Refuse mismatched tags without attempting an unauthorized dist-tag mutation; a maintainer can repair the exact tag with separate authority and retry.
- Keep promotion separate: only the tag-mutation step receives a short-lived `NPM_PROMOTION_TOKEN`. OIDC publication does not imply promotion authority. Never reuse the bootstrap credential or retain a general-purpose `NPM_TOKEN`.

## Consequences

Routine package publication needs no npm secret. Initial package creation and later tag promotion remain explicit, separate operations with traditional authority; this is not an entirely credential-free release train. npm-side trusted-publisher settings and protected GitHub environment configuration cannot be provisioned by editing repository files.

GitHub/npm external execution remains C23–C25 evidence. Local acceptance must exercise the actual release entry point and real npm CLI without mutating the public registry; it must not claim that a local credential simulation proves GitHub OIDC exchange or public provenance.
