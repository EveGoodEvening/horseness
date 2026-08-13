# Pi Native Integration

`@horseness/adapter-pi` is the native Pi bundle for the exact supported upstream host `@mariozechner/pi-coding-agent@0.73.1`. The bundle pins Pi's upstream extension loader at `dist/core/extensions/loader.js` and verifies its SHA-256 before native loading. It does not treat a repository wrapper as upstream provenance.

## Package contents

The package ships a declarative `pi-package.json` and the read-only `extensions/horseness-pi.mjs` contribution. The adapter exports immutable native package metadata, parsed install contributions, a read-only doctor result, and a thin `WorkerAdapterV1` implementation composed through `SecureWorkerAdapterV1`.

Installation is declarative. The adapter never writes Pi host targets, runs installation hooks, invokes a shell, opens a database, accesses store/orchestrator internals, or makes admission and scheduling decisions. An external installer may materialize the declared relative paths only after verifying their package and content digests.

## Authority boundary

Credentials are accepted only as `CredentialReferenceV1` opaque identifiers scoped exactly to the bound workspace, adapter `horseness-pi-v1`, and purpose `pi-provider-auth`. Secret values are not accepted, read, logged, hashed, or persisted.

Every lifecycle callback retains the exact immutable workspace, run, task, attempt, generation, ForkPin, context-manifest, context-binding, provider-key, and attempt-capability fields. Launch, cancel, reconcile, reattach, native resume, and receipt collection fail closed on substitution and are callback-idempotent through adapter-kit.

Pi owns only native lifecycle and collection. The contribution captures an already sealed, binding-valid receipt and proposal emitted by the worker/provider path. It does not synthesize proposals in the harness or exercise coordinator authority. Publication, receipt/proposal submission, canonical decision observation, and subscription resume use `@horseness/sdk`.

## Host smoke

Run `pnpm run host:smoke:pi`. The adapter-owned smoke resolves the installed real Pi 0.73.1 distribution, verifies the pinned loader digest, loads the shipped contribution through Pi's native `loadExtensions` interface, exercises a deterministic provider return, verifies the receipt and sealed proposal, publishes output/evidence through the SDK, submits both envelopes, resumes decision observation across `accepted`, `rejected`, `conflicted`, `quarantined`, and `approval_required`, proves an accepted canonical revision advance, exercises restart/reconcile/resume and ForkPin switch evidence, and removes the installed contribution.

C11 acquisition remains the provenance authority: registry metadata, registry SHA-512 integrity, archive SHA-256, member SHA-256, cache revalidation, and same-distribution interface validation are unchanged and are not bypassed by this bundle.
