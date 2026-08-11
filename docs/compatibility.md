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

## Domain v1 implementation train

`@horseness/domain` now writes the frozen v1 forms for canonical JSON (`jcs-v1`), SHA-256 domain-separated identities (`sha256-v1`), workspace/run envelopes, every observation/result cursor variant, canonical and operational reducers, proposals/deltas, policy and approval decisions, task completion and dependency release, fork pins, dependency snapshots, delta authority scopes, context manifests/bindings, attempt dispatch and resolution, authorization decisions, attempt receipts, signed checkpoint receipt envelopes, and deterministic replay.

Readers reject unknown schema, cursor, canonicalizer, hash, operation, policy, dispatch, receipt, and authorization variants before mutation. The public compatibility train is the eleven-family vector set under `docs/vectors/{events,cursors,proposal,delta,fork-pin,dependency-join,delta-authority,context-binding,receipt,task-dispatch,authorization}`. Each vector freezes canonical JSON bytes and its domain-separated digest; downstream protocol, policy, storage, orchestration, SDK, and adapter packages consume these identities rather than redefining them.

The domain package exposes `horseness-vectors-verify`, its package-local `vectors:verify` script, and the repository root forwards the frozen vector gate.
 
## Protocol v1 implementation train
 
`@horseness/protocol` now freezes the exhaustive JSON-RPC 2.0 method registry and omitted-deny authorization matrix for the full coordinator and adapter SPI surface. Runtime readers require exact request fields, protocol version `1`, method-specific observation cursor scope, command idempotency keys, and role authorization before dispatch. Unknown methods, versions, cursor kinds, extra fields, or unauthorized role/method combinations fail closed.
 
Pagination names `afterObservationCursor` separately from emitted result cursors. Subscription resumption binds subscription ID, after-observation cursor, and opaque resume token. Stable success/error envelopes, local-only transport metadata, domain-owned receipt/proposal mappings, capability detection, provider lifecycle SPI, and `WorkerReturnV1` are public v1 contracts. Generated canonical schemas/manifests and executable vectors are checked byte-for-byte; no v1 reader infers missing cursor scope, transport identity, idempotency, or authority.
