# Compatibility Contract

## Version axes

Persisted and public contracts version event envelopes, canonical JSON, hashes, policies including `NoPolicyV1`, proposal/delta schemas, `ObservationCursorV1` and `ResultCursorV1` variants, `ForkPinCoreV1`, `DependencyJoinSnapshotCoreV1`, `DeltaAuthorityScopeV1`, `TaskCompletionPolicyV1`, command-authorization matrices, `WorkerReturnV1`, `CheckpointReceiptCoreV1`/signature/envelope/trust stores, context source-view and authorization-overlay fields, context cores and bindings, RPC mappings, SQLite schema, installer journal, native contribution manifests, release manifests, checkpoint/claim/index records, finding/index records, and publication-journal records independently.

## Reader and writer rules

Writers emit only the current supported version. Readers support the documented N-1/N train, reject unknown newer versions without mutation, and upcast only after raw integrity verification. Downgrade is allowed only with a verified reversible migration; otherwise it is major-gated and requires backup/export confirmation.

## Host matrix

Pi, OMP, Claude Code, and Codex native contributions are mandatory. C11 freezes supported host versions and capabilities. Unsupported or managed-blocked hosts are errors; absent hosts are reported no-ops. CLI-only mode does not satisfy native compatibility.

The machine-readable authority is `config/hosts/capability-matrix.v1.json`. Each row binds canonical upstream package identity, exact version, HTTPS registry URL, registry-published SHA-512 integrity, independently computed archive SHA-256, cache key, executable/member SHA-256, and official-validation provenance. A repository fixture, locally authored wrapper, or coordinated manifest-plus-matrix substitution cannot satisfy native provenance. When upstream ships no independent validator artifact, the row honestly records a same-distribution command/interface and its member digest rather than relabelling it as a separate artifact. `HostValidationResultV1` is the stable nine-field result contract.

Hermetic feasibility uses the repository deterministic provider with frozen request/response bytes, clock, budget, identity, disabled network, and disabled credentials. Real upstream binaries/plugins execute through `HostSandboxLifecycleV1`; successful phase observations, not declarations, derive matrix capability booleans. Path escape, symlink substitution, archive/member tamper, and undeclared output fail closed. Credentialed-live checks are separate: local execution may report `LIVE_CREDENTIAL_ABSENT` only when the allowlisted opaque reference is absent and publication is not required. Once configured, every credential, provenance, redaction, budget, timeout, or host failure is fatal; publication-required evidence never skips.

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

## Adapter-kit v1 implementation train

`@horseness/adapter-kit` consumes the protocol-owned adapter SPI rather than defining a competing wire contract. It retains the complete immutable attempt binding across launch, cancel, reconcile, reattach, native resume, and receipt collection; repeated callbacks are idempotent and any workspace, run, task, attempt, generation, ForkPin, manifest, binding, capability, or provider-key substitution fails closed.

Credentials cross the adapter boundary only as versioned opaque references scoped to a workspace, adapter, and purpose. Secure subprocesses use argv arrays without a shell, realpath-confined executable and working-directory roots, an explicit environment allowlist with secret-shaped keys stripped, time limits, byte limits, and deterministic redaction. Install contributions are declarative relative paths and content identities only: adapters expose no install hooks and never write host targets. Doctor results are versioned, exact, read-only records; repair remains a separate installer operation.

The executable adapter conformance suite covers capability detection, lifecycle recovery, immutable binding retention, callback deduplication, credential/reference exclusion, scope rejection, executable/cwd and symlink confinement, bounded/redacted output, declarative install and doctor validation, and a `WorkerReturnV1` artifact/receipt/proposal/decision-resume loop through an SDK-compatible client fake. The repository root `adapter:conformance` command is the focused gate for this contract.

## Daemon v1 implementation train

`@horseness/daemon` serves the local authority through versioned stdio, Unix-domain socket, and Windows named-pipe endpoints. Stdio is process-inherited; filesystem endpoints require an owner-only parent and endpoint. TCP is not a v1 transport and remains disabled by default. Transport implementations authenticate peers and frame newline-delimited JSON-RPC 2.0 messages, while daemon services alone own bootstrap, grants, dispatch, and authority mutations.

The first-authority ceremony uses a single-use bootstrap capability stored as an owner-only `0o600` file beneath an owner-only `0o700` directory. Its v1 payload binds the workspace identity and local OS account. Consumption verifies that binding, atomically appends workspace genesis and the initial grant through the authority compare-and-swap boundary, and removes the capability; concurrent, substituted-user, or already-consumed attempts fail closed.

The v1 grant lookup contract returns authenticated principal, role, grant digest, workspace/run/task scope, allowed methods, expiry, and revocation state from authoritative SQLite projections. Restarts and restored workspaces must rebind the local authority credential and endpoint identity before serving requests.

C13 CI receipts use `horseness.os-receipt.v1`. Each Linux, macOS, and Windows receipt binds the exact candidate commit SHA and records successful focused typecheck and daemon multiprocess gates. Receipt aggregation rejects absent platforms, duplicate or unexpected fields, candidate substitution, reordered or missing gates, and any status other than `passed`; local fixture inputs are accepted only when an explicit candidate SHA environment override matches them.

## Policy v1 implementation train

`@horseness/policy` writes immutable `PolicyDocumentV1` values addressed by the domain-separated `horseness.policy.v1` digest and strict `PolicyReferenceStateV1` lifecycle values. `NoPolicyV1` and `NO_POLICY_DIGEST` are the only neutral representation; policy references and pinned/current policy slots are never nullable. Readers reject unknown versions, kinds, effects, extra fields, malformed lineage, duplicate or noncanonical rule/evidence identifiers, substituted document digests, noncanonical JSON Pointers, and noncanonical UTF-8 ordering.

Admission is a pure v1 function over a canonical UTC-second authority time and explicit composite observation cursors. It independently evaluates the concrete pinned and current slots and deterministically conjoins every result, constraint, and explanation. Path scopes use domain JSON Pointer token containment, including root. Approval compatibility binds the proposal author, a distinct authenticated approver, both policy digests, proposal/base tuple, action, grant digest, exact issue snapshot, exact evaluation snapshot, cursor ordering, and nonempty `[issuedAt, expiresAt)` validity; no v1 reader carries an approval across identity, policy, grant, proposal, base, issue-snapshot, or evaluation-snapshot substitution.
