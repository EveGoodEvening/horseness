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
- External dispatch commits a durable launch intent before provider invocation; a first binding-valid receipt may terminalize from that intent or any later nonterminal state. Task success releases only the frozen `TaskCompletionPolicyV1` predicates. Never relaunch an unknown outcome absent reconciliation or explicit duplicate-risk authorization. C22–C25 effects require append-only integrated signed intent/result side-effect checkpoints and lookup-first recovery.
- Store only opaque secret references. Consent binds exact release/capability/host/scope/identity. Uninstall writes the kill switch and disables discovery before reconciling authority revocation.
- Bootstrap verification occurs before Horseness executes. Default doctor is non-executing. Publication is `stage -> reconcile -> black-box verify -> promote -> announce`; partial states require receipts and exact-digest reconciliation.
- Every base chunk runs its frozen ordered acceptance commands. Failed gates or review findings keep the chunk in progress; fixes are committed within ownership and affected gates rerun before the completion tracker commit.
- Later product defects use the review-fix protocol in the active ledger. Architectural or out-of-scope corrections require an ordinary reviewed planning-correction commit, not a recursive cryptographic remediation graph.

## Planning-only baseline

The planning-only baseline is complete. C00/C01 historical evidence remains read-only. C02 is the next eligible product chunk and MUST begin with `chore(progress): claim C02`; do not include C02 product code in that claim commit.
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
- Repository development receipts are not product runtime receipts. Simplifying C02+ chunk tracking does not weaken evidence-gated canonical deltas, authenticated worker returns, immutable context/fork bindings, installer trust, or release/external-effect evidence.
