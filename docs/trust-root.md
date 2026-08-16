# Release Trust Root

## npm-first decision

ADR 0009 defers the custom Horseness release trust root from the first public release. Version `1.0.0` relies on npm registry integrity, npm-generated provenance, the GitHub source repository, and the protected GitHub `release` environment. No production root ceremony record, release-key delegation, KMS signer, custom immutable-storage receipt, release journal, or offline revocation bundle is created.

The previous `RootCeremonyRecordV1` schema and C22 verifier were removed from the active release path. Their absence is deliberate and no longer blocks C22.

## Deferred bootstrap boundary

`@horseness/bootstrap` is private `0.0.0` and excluded from the public npm train. Its fixture release, fixture trust root, and fixture signing key exist only for deterministic installer and recovery tests. They cannot authorize a public release and MUST NOT be referenced by `.github/workflows/release.yml` or active release scripts.

A future public self-contained or offline bootstrap needs a new ADR before implementation. That ADR must define the actual threat model, root custody, rotation and revocation, distribution channels, compromise recovery, and the relationship to npm/GitHub provenance. No dormant fixture or former C22 design is automatically promoted into production.

## npm publication trust

Initial package creation uses a short-lived package-scoped granular npm token held only in the protected release environment because npm trusted publisher configuration requires an existing package. Subsequent package publication should use npm trusted publishing for `release.yml`. Trusted publishing does not authorize dist-tag mutation, so C25 uses maintainer 2FA or a separately provisioned short-lived package-scoped promotion token. No persistent npm release token is retained.

Every candidate tarball is packed twice and bound by a local manifest containing size, SHA-256, and npm SHA-512 integrity. Publication and promotion reconcile only against exact npm integrity. C24 installs the exact public versions on Linux, macOS, and Windows before C25 moves `latest`.

## Separate historical and runtime trust

C00/C01 checkpoint execution trust remains immutable historical evidence under `docs/checkpoints/trust.json`; ADR 0009 does not rewrite it. Product worker receipts, canonical event integrity, installer journals, neutral bundle validation, consent, path confinement, and uninstall safety also remain unchanged. Repository fixture checkpoint keys and installer fixture keys remain test-only.
