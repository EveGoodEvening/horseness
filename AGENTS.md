# Repository Agent Guide

## Scope and authority

This file applies to the entire repository. `docs/architecture.md` is authoritative for product invariants and state semantics. `docs/plan.md` owns chunk boundaries, dependencies, fully qualified path ownership, cross-cutting integration rules, and exact acceptance commands. `docs/progress.md` is the canonical summary ledger; `docs/progress/CNN.md` is the evidence ledger for chunk `CNN`.

Resolve conflicts in that order. An architectural change requires a dedicated planning correction and ADR before implementation resumes.

## Execution rules

- Base chunks execute serially through `C25`; dependency-ready `PNNN`, `RNNN`, and `VNNN` nodes are explicit serial scheduling exceptions. The single priority is `P -> R -> V -> C`; a ready P preempts new lower-class claims. No source chunks overlap.
- Never edit source before the integrated claim base defined in `docs/plan.md`. C00 uses `bootstrap-v1`, C01 uses the specified tool-free claim exception, and the ordinary versioned claim-attempt graph begins with C01 candidate production. A claim record, claim-index row, and Markdown ledger bind only the pre-claim parent SHA; the live verifier obtains K/B1 from integrated HEAD and proves commit/tree/path/parent/ancestry. Candidate `W`, integration `I`, and attestation `A` are distinct and no commit contains its own SHA. Renewed, blocked, or remediated work requires a new attempt generation and matching W/I tree. Dependency completion requires a valid indexed signed checkpoint envelope; acceptance-dependent task edges additionally require their durable `DeltaAcceptedV1` completion identity.
- Work only in the exact claim-sealed `allowedPaths`, `affectedAdrPaths`, and `acceptanceRecordPaths` defined in the final addendum. No semantic shorthand grants ownership. Shared files use serialized integration.
- Every package-changing chunk owns only its listed manifests and `pnpm-lock.yaml`; pnpm is the sole lockfile serializer.
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
- Every base chunk and V node runs exactly its frozen acceptance-contract-v3 command list. P nodes use the pre-frozen structural planning-correction validator and claim-sealed exact paths; P freezes immutable R/V ownership and machine command records. Receipts reject skipped, missing, reordered, optional, placeholder, or substituted commands.
- Later defects use immutable F/P/R/V IDs and stale-evidence rules; detectors have only the atomic finding-plus-blocked-status grant, validation chunks never edit source, and resumed detectors use a fresh claim attempt.

## Planning-only baseline

Until C00 and C01 complete, do not create implementation code, manifests, lockfiles, workflows, or generated scaffolding except where C01 explicitly owns them. C00 is tool-free and uses only commands available on the clean Node 22 baseline. Planning corrections must remain consistent across all five planning artifacts.
- Integration and release identity use exactly `refs/heads/main`. Before W00 seal, normalize and evidence local/remote default/protection state. The live C01 checker rejects any other branch.
- Production receipt verification uses only canonical live paths, complete index chains, integrated Git ancestry, canonical UTC-second timestamps, explicit trusted time, symlink rejection, and authenticated trust lookup. Synthetic algorithms run only through the explicit isolated fixture-bundle verifier.

## Durable lessons

- The repository began empty; conventions and ownership must be explicit.
- Node.js 22, strict TypeScript, ESM, and pnpm are the coherent runtime/toolchain.
- Provider-neutral core and thin adapters prevent host semantics from becoming canonical truth.
- Event authority, deterministic replay, evidence-gated admission, as-of context, and dependency-aware forks form one closed loop.
- Local plugins and skills execute with host-user privileges. Signatures and checksums authenticate distribution but do not sandbox behavior; arbitrary same-user process compromise is outside the v1 boundary, and guarantees assume the daemon/installer trust base and OS access controls remain intact.
- Serial chunks are deliberate: correctness and deterministic manifests/lockfiles outweigh speculative parallel throughput.

- Claim commits cannot content-bind their own object IDs. Persist only the pre-claim parent in `ClaimAttemptV1`, claim index, and ledger; derive the integrated claim SHA from the verified Git graph.
