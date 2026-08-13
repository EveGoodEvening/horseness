# Pi Native Integration

`@horseness/adapter-pi` is the native Pi bundle for the exact supported upstream host `@mariozechner/pi-coding-agent@0.73.1`. The bundle pins Pi's upstream extension loader at `dist/core/extensions/loader.js` and verifies its SHA-256 before native loading. It does not treat a repository wrapper as upstream provenance.

## Package contents

The package ships a declarative `pi-package.json` and the read-only `extensions/horseness-pi.mjs` contribution. The adapter exports immutable native package metadata, parsed install contributions, a read-only doctor result, and a thin `WorkerAdapterV1` implementation composed through `SecureWorkerAdapterV1`. `packageDigest` is the SHA-256 of the documented `horseness-pi-shipped-artifact-v1` aggregate over the ordered shipped contribution paths and their independently computed SHA-256 digests; it is not a self-referential npm tarball digest.

Installation and removal are declarative. The adapter never writes Pi host targets, runs installation hooks, invokes a shell, opens a database, accesses store/orchestrator internals, or makes admission and scheduling decisions. An external installer may materialize or remove the declared relative paths only after verifying the aggregate package digest and each content digest.

## Authority boundary

Credentials are accepted only as `CredentialReferenceV1` opaque identifiers scoped exactly to the bound workspace, adapter `horseness-pi-v1`, and purpose `pi-provider-auth`. Secret values are not accepted, read, logged, hashed, or persisted.

Every lifecycle callback retains the exact immutable workspace, run, task, attempt, generation, ForkPin, context-manifest, context-binding, provider-key, and attempt-capability fields. Launch, cancel, reconcile, reattach, native resume, and receipt collection fail closed on substitution and are callback-idempotent through adapter-kit.

Pi owns native lifecycle and collection. The loaded contribution validates the immutable binding and bounded output/evidence metadata, seals the bound receipt and non-empty proposal through host-provided public domain callbacks, constructs the exact protocol `WorkerReturnV1`, and delegates the native-origin return through adapter-kit `deliverWorkerReturn`. A retained authority serializes each attempt key, compare-and-sets persisted phases after each publication, receipt submission, proposal submission, decision resume token, and terminal decision, and skips phases already completed by concurrent or restarted callbacks. The authority-issued resume token is persisted before the terminal decision is stored, so an interruption after the decision response resumes the subscription with that token instead of republishing or resubmitting. The delivery callback is backed by SDK/coordinator authority in production; the host smoke uses the existing public admission service and authority store to prove authority-produced decisions and canonical state without accessing their internals.

## Host smoke

Run `pnpm run host:smoke:pi`. The adapter-owned smoke resolves the installed real Pi 0.73.1 distribution, verifies the pinned loader and shipped contribution digests, loads the contribution through Pi's native `loadExtensions` interface, and invokes the native tool that originates the exact `WorkerReturnV1`. It publishes output/evidence, records the receipt, submits a valid non-empty scoped delta to the existing admission authority, resumes the authority decision, and verifies the accepted canonical document from `loadRevision`. Separate authority fixtures produce rejected, conflicted, quarantined, and approval-required outcomes. The smoke injects an interruption after every retained publish, receipt, proposal, resume-token, and terminal-decision boundary, recreates the native runtime, and proves exactly-once external side effects, token-based subscription resume, concurrent duplicate convergence, and rejection of a substituted output/evidence tuple. It also drives adapter launch, reconcile, reattach, native resume, and receipt collection, emits an active native fork switch through Pi events, removes the installed contribution, verifies discovery no longer succeeds, and verifies the already-loaded contribution revokes its attempt credential on uninstall.

C11 acquisition remains the provenance authority: registry metadata, registry SHA-512 integrity, archive SHA-256, member SHA-256, cache revalidation, and same-distribution interface validation are unchanged and are not bypassed by this bundle.
