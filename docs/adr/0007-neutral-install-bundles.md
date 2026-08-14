# ADR 0007: Neutral signed install bundles

## Status
Accepted.

## Context
C20 must install the four native host contributions, but `packages/installer` is provider-neutral core and cannot depend on adapter packages. The completed adapters expose contribution metadata and bytes, while the signed release train is the authority that can bind those bytes to supported host/platform tuples. C20 also requires exact cross-platform target ownership, a genuinely non-mutating doctor, and a top-level bootstrap that can compose installer and daemon public APIs.

## Decision
The release manifest carries a signed, closed, sorted neutral contribution catalog. `NeutralInstallBundleV1` contains the verified release-manifest identity and, for each adapter/host, its supported platform/architecture tuples, pinned host version, support classification, package and source-artifact digests, and exact contribution records: confined relative path, kind, mode, size, content digest, archive/member digest, and bytes. The bootstrap/top executable edge authenticates the trust root, manifest, artifacts, members, and catalog, then supplies this bundle and a public daemon client to installer operations. Installer core independently hashes and validates every record and never imports or executes an adapter package.

User-scope state/data roots are `${XDG_STATE_HOME:-$HOME/.local/state}/horseness/install` and `${XDG_DATA_HOME:-$HOME/.local/share}/horseness/install` on POSIX, and `%LOCALAPPDATA%\Horseness\Install\state` and `%LOCALAPPDATA%\Horseness\Install\data` on Windows. Workspace scope uses `<realpath-workspace>/.horseness/install/{state,data}`. Managed bytes are confined below `data/bundles/<releaseManifestDigest>/<hostId>`; journals, kill switches, ownership markers, and refcounts are confined below `state`.

A catalog entry names a closed host discovery-root identifier and a relative target. The executable edge resolves Pi to `${PI_CODING_AGENT_HOME:-$HOME/.pi/agent}` or `%USERPROFILE%\.pi\agent`, OMP to `${OMP_HOME:-$HOME/.omp}` or `%USERPROFILE%\.omp`, Claude to `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` or `%USERPROFILE%\.claude`, and Codex to `${CODEX_HOME:-$HOME/.codex}` or `%USERPROFILE%\.codex`. Overrides must be absolute, owner-controlled, and realpath-confined. Relative, symlinked, cross-owner, ambiguous, or escaping roots fail before mutation.

Each managed target has an owner-private marker binding scope/workspace, OS identity, release/package/source/contribution digests, resolved target, mode, shared refcount identity, and journal operation. Unmarked existing targets are `managed-blocked`; matching marker and bytes are idempotent; disagreement is drift and is never overwritten. POSIX roots/records use `0700`/`0600` and the minimum required executable mode. Windows uses a non-inheriting DACL limited to the invoking SID and administrators. Quarantine is non-executable.

Host detection is exactly `present-supported`, `absent`, `unsupported`, `managed-blocked`, or `failed`. Unsupported platform/architecture or absent signed native-host support performs no mutation. It is an error when explicitly requested, yields partial exit `3` in default multi-host mode after preserving successful hosts, and causes compensation/failure under `--atomic-hosts`. Linux-only Claude or Codex records are therefore unsupported on macOS/Windows rather than absent or successful.

C20 doctor uses pure inspectors over supplied paths and bytes plus public daemon status. Inspectors may read, parse, stat, and hash existing bytes, but may not create, chmod, acquire a mutating lock, recover, migrate, write a journal, spawn a process, access network/database/keychain, load a host, or import contribution code. Missing, corrupt, drifted, revoked, pending, or unknown-newer state is reported through the versioned result without mutation. Repair remains separate and mutating.

The shared OS-receipt verifier is chunk-versioned. C13 remains the immutable `horseness.os-receipt.v1` profile with `C13-<os>.json` and ordered gates `c13:typecheck`, `c13:multiprocess`. C20 adds, rather than replaces, `horseness.os-receipt.v2` with `C20-<os>.json` and ordered gates `c20:typecheck`, `c20:test`, `c20:bootstrap-build`, `c20:install-blackbox-online`, `c20:install-blackbox-offline`, `c20:doctor-hostile-no-side-effects`, `c20:uninstall-failure-matrix`, `c20:cli-lifecycle-blackbox`, and `c20:boundaries-check`. Chunk/version, candidate SHA, OS, filename, gate set, order, and passed status are exact; unknown or cross-version combinations fail closed. This preserves C13 validation semantics while allowing C20 to carry its distinct candidate-bound evidence.

## Consequences
C20 gains a realizable provider-neutral installer boundary and a single authenticated source for exact contribution bytes and support semantics. Release assembly may read adapter declarations when producing the signed catalog, but production installer runtime cannot. Bootstrap remains an executable composition edge over public installer and daemon APIs. Install, upgrade, downgrade, rollback, retry, repair, doctor, and uninstall share deterministic ownership and unsupported-host behavior across POSIX and Windows.

C20 completion requires candidate-bound Linux, macOS, and Windows receipts. If an external macOS or Windows runner is unavailable, C20 remains blocked; the C13-only waiver is not precedent and no skip, synthetic receipt, or reduced platform claim is accepted.

C20 source ownership defers to the authoritative round-three C20 ownership row and is file-exact for all six existing flat CLI files—`apps/cli/src/parser.ts`, `apps/cli/src/runtime.ts`, `apps/cli/src/result.ts`, `apps/cli/src/index.ts`, `apps/cli/src/entry.ts`, and `apps/cli/src/registry.ts`—the new flat router/help/completion files, ten lifecycle command modules, ten matching tests, and the existing named CLI tests. Focused verifier coverage is rooted at exact `tests/boundaries-check.test.mjs` and `tests/ci-require-os-receipts.test.mjs`; no implicit `scripts/test/**`, unnamed “corresponding tests”, or directory-shaped ownership follows from this ADR.

## Rejected Alternatives
- Importing adapter packages from installer core.
- Letting adapters write host discovery targets.
- Trusting adapter-declared digests without independently hashing signed bundle bytes.
- Treating unsupported hosts as absent or successful.
- Calling mutating journal/migration `open()` paths from doctor.
- Storing managed bytes without scope/workspace ownership markers and drift checks.
- Completing C20 without candidate-bound receipts from all three required operating systems.
