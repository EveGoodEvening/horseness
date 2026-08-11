# Compatibility Contract

## Version axes

Persisted and public contracts version event envelopes, canonical JSON, hashes, policies including `NoPolicyV1`, proposal/delta schemas, `ObservationCursorV1` and `ResultCursorV1` variants, `ForkPinCoreV1`, `DependencyJoinSnapshotCoreV1`, `DeltaAuthorityScopeV1`, `TaskCompletionPolicyV1`, command-authorization matrices, `WorkerReturnV1`, `CheckpointReceiptCoreV1`/signature/envelope/trust stores, context source-view and authorization-overlay fields, context cores and bindings, RPC mappings, SQLite schema, installer journal, native contribution manifests, release manifests, checkpoint/claim/index records, finding/index records, and publication-journal records independently.

## Reader and writer rules

Writers emit only the current supported version. Readers support the documented N-1/N train, reject unknown newer versions without mutation, and upcast only after raw integrity verification. Downgrade is allowed only with a verified reversible migration; otherwise it is major-gated and requires backup/export confirmation.

## Host matrix

Pi, OMP, Claude Code, and Codex native contributions are mandatory. C11 freezes supported host versions and capabilities. Unsupported or managed-blocked hosts are errors; absent hosts are reported no-ops. CLI-only mode does not satisfy native compatibility.

## Release train

All packages, applications, native bundles, bootstrap binaries, offline archives, schemas, migration data, SBOM, provenance, signatures, trust metadata, and rollback instructions share one coherent immutable release version and manifest digest.

## Frozen v1 boundary rules

Unknown cursor kinds, fork-pin/snapshot/scope/completion-policy versions, proposal-sealing observation fields, authorization matrices, worker-return methods, receipt core/signature/envelope/trust versions, or index-record versions fail before mutation. Readers never infer a full composite cursor from a workspace-only or run-only value, never substitute current context for a ForkPin source view, never release an acceptance-dependent edge from a receipt alone, and never accept an unnamed persisted `cursor`. The N-1/N train includes canonical golden vectors for all cursor genesis transitions, ForkPin refresh ancestry, dependency snapshots, delta scopes, signed checkpoint/index hashes and trust rotation/revocation, and four-host proposal/decision round trips.
