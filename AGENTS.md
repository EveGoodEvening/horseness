# Repository Agent Guide

## Scope and authority

This file applies to the entire repository. `docs/architecture.md` is authoritative for product invariants and state semantics. `docs/plan.md` owns chunk boundaries, dependencies, fully qualified path ownership, cross-cutting integration rules, and exact acceptance commands. `docs/progress.md` is the canonical summary ledger; `docs/progress/CNN.md` is the evidence ledger for chunk `CNN`.

Resolve conflicts in that order. An architectural change requires a dedicated planning correction and ADR before implementation resumes.

## Execution rules

- Base chunks execute serially through `C25`; no source chunks overlap.
- C00/C01 bootstrap claims, remediation records, signed receipts, and indexes are immutable historical evidence. Never rewrite them; focused CI verification continues to authenticate their version, signatures, digests, indexes, paths, and Git ancestry.
- From C02 onward, use the conventional sequence in `docs/plan.md`: two-file tracker claim commit, owned-path implementation commits, exact acceptance gates, review-fix commits with affected gates rerun, then a two-file tracker completion commit. Do not create development claim JSON, per-chunk signed receipts, checkpoint-index rows, or P/R/V closure graphs.
- Work only in the exact owned paths for the active chunk. Package-changing chunks own only their listed manifests and `pnpm-lock.yaml`; pnpm is the sole lockfile serializer.
- Domain owns typed absent-workspace, workspace-only, absent-run, run-only, and composite observation/result cursors; `ForkPinCoreV1`, dependency/join snapshots and delta scopes; separate authorization and source-view context versions; acyclic manifest/binding hashes; proposal-sealing observations; canonical policy/delta outcomes; task resolution; launch-intent dispatch races; authorization denials; and authenticated receipts. Protocol maps them; policy consumes them.
- `WorkspaceCreated` and `RunCreated` are explicit sequence-one genesis events with expected-absent CAS. Only `DeltaAccepted` advances canonical revision/hash. Never synthesize a composite cursor when either stream is absent.
- `proposalId` is derived only from `proposalDigest`; operation preconditions and stable reason-code outcomes are normative. Never authorize or look up an alternate identity.
- ForkPins, dependency snapshots, delta scopes, manifests, and bindings are immutable. Context sources use the pin's source view; current command authorization is a separate overlay. Receipts authenticate the producer and bind pin, manifest core, binding, provider operation, output, and evidence.
- Task lifecycle is durable; schedulability is a derived as-of projection. Dispatch must re-evaluate it at the transaction cursor.
- Pinned and current policies are evaluated conjunctively with fixed precedence. Evaluation time/cursor/grant/quota snapshots are persisted. Approval never bypasses revalidation.
- Artifact bytes are published, fsynced, renamed, and verified before an event references them. Missing/corrupt referenced bytes fail closed.
- Adapters never import storage/orchestrator internals, decide admission/scheduling, write SQLite, or mutate installation targets. Every required host ships and validates its native contribution and credentialed `WorkerReturnV1` path: publish output/evidence, submit receipt/proposal, resume decision observation, and surface every decision.
- External dispatch commits a durable launch intent before provider invocation; a first binding-valid receipt may terminalize from that intent or any later nonterminal state. Task success releases only the frozen `TaskCompletionPolicyV1` predicates. Never relaunch an unknown outcome absent reconciliation or explicit duplicate-risk authorization.
- Store only opaque secret references. Consent binds exact release/capability/host/scope/identity. Uninstall writes the kill switch and disables discovery before reconciling authority revocation.
- ADR 0009 defines the first public release as a fourteen-package npm train: pack reproducibly, publish under `next`, verify exact public packages on Linux/macOS/Windows, then move `latest`. `@horseness/bootstrap`, offline media, custom root/KMS signing, immutable storage, signed release journals, and custom release receipts are deferred.
- Every base chunk runs its frozen ordered acceptance commands. Failed gates or review findings keep the chunk in progress; fixes are committed within ownership and affected gates rerun before the completion tracker commit.
- Later product defects use the review-fix protocol in the active ledger. Architectural or out-of-scope corrections require an ordinary reviewed planning-correction commit, not a recursive cryptographic remediation graph.

## Planning-only baseline

The planning-only baseline and C00–C21 product chunks are complete. C00/C01 historical evidence remains read-only. C22 is the sole active chunk under the npm-first ADR 0009 correction; C23–C25 remain serial operational release phases.
- Integration and release identity use exactly `refs/heads/main`.
- Focused production receipt verification for C00/C01 uses canonical live paths, complete index chains, integrated Git ancestry, canonical UTC-second timestamps, symlink rejection, and authenticated trust lookup. Synthetic algorithms run only through the isolated fixture-bundle verifier.
## Durable lessons

- The repository began empty; conventions and ownership must be explicit.
- Node.js 22, strict TypeScript, ESM, and pnpm are the coherent runtime/toolchain.
- Provider-neutral core and thin adapters prevent host semantics from becoming canonical truth.
- Event authority, deterministic replay, evidence-gated admission, as-of context, and dependency-aware forks form one closed loop.
- Local plugins and skills execute with host-user privileges. Signatures and checksums authenticate distribution but do not sandbox behavior; arbitrary same-user process compromise is outside the v1 boundary, and guarantees assume the daemon/installer trust base and OS access controls remain intact.
- Serial chunks are deliberate: correctness and deterministic manifests/lockfiles outweigh speculative parallel throughput.

- Claim commits cannot content-bind their own object IDs. Persist only the pre-claim parent in `ClaimAttemptV1`, claim index, and ledger; derive the integrated claim SHA from the verified Git graph.
- Repository development receipts are not product runtime receipts. Simplifying C02+ chunk tracking does not weaken evidence-gated canonical deltas, authenticated worker returns, immutable context/fork bindings, installer state safety, or historical C00/C01 evidence.
- npm trusted publishing cannot bootstrap a new package: the package must already exist. The initial release therefore uses a short-lived package-scoped granular token in the protected release environment, removes it afterward, and configures trusted publishing for subsequent releases. Trusted publishing requires npm 11.5.1+ and Node 22.14.0+.
- `NO_PROXY: "*"` defeats dead-proxy network isolation: wildcard bypass is universally interpreted as "bypass proxy for all hosts," allowing direct connections. Never pair `NO_PROXY: "*"` with a dead proxy for defense-in-depth. Use `HTTPS_PROXY`/`HTTP_PROXY` pointing to a dead port (e.g., `http://127.0.0.1:9`) without `NO_PROXY` to block outbound traffic.
- `bun install --offline` with a dead proxy fails because bun routes local cache resolution through the proxy. Apply proxy blocking to host-execution subprocess calls only, not to the dependency-install step. The `--offline` flag itself prevents network access for installs.
- When proving native feasibility, execute code from the digest-verified acquired artifact, not from repo `node_modules`. Copy `acquired.cachePath/package` to an isolated work dir and install dependencies there. Resolving `packageRoot` from `realpath(node_modules/...)` decouples execution from digest verification.
