# Horseness Architecture

## Product decision

Horseness is a local-first, provider-neutral orchestration substrate for auditable multi-agent work. One authorized authority owns a revisioned canonical document; workers explore immutable, dependency-aware forks and submit typed, evidence-bearing delta proposals. Proposals never mutate canonical state directly. A deterministic admission service records one versioned decision and only an accepted decision advances the canonical document revision.

The first release targets Node.js 22, strict TypeScript, ESM, and a pnpm monorepo. It ships a local daemon, CLI, provider-neutral core, Pi/OMP/Claude Code/Codex adapters, native host bundles, and a transactional installer. SQLite in WAL mode and an append-only event log are authoritative. Large evidence and context artifacts are content-addressed files. Operation is offline and workspace-local by default.

Non-goals for the first release are a hosted control plane, distributed consensus, remote untrusted workers, autonomous semantic judging, a web UI, direct adapter database access, silently emulated host capabilities, and storing secret values.

## Authority and package boundaries

The event log is the single source of truth for run and policy history. Projections, indexes, snapshots, and generated context are derived. Package dependency direction is:

`domain -> protocol mapping schemas`

`domain -> policy and store contracts -> orchestrator -> sdk/adapter-kit -> apps/adapters/installer`

- `packages/domain` exclusively defines host-neutral identifiers, aggregates, commands, event payloads, reducers, canonical serialization, hash algorithms, and admission types.
- `packages/protocol` imports domain contracts and defines versioned wire mappings, JSON-RPC schemas, validators, stable errors, and fixtures. It never independently redefines domain entities.
- `packages/policy` imports domain contracts and implements pure deterministic evaluation.
- `packages/store-sqlite` persists raw versioned domain events, policies, projections, snapshots, artifacts, outbox records, quotas, and migrations.
- `packages/orchestrator` composes storage and policy and owns application services, task/fork/attempt dispatch, admission, and context reconstruction.
- `packages/sdk` is the only core-facing client surface used by adapters.
- `packages/adapter-kit` owns the adapter SPI, declarative install contribution format, secure process boundary, fixtures, and conformance harness.
- `apps/daemon` and `apps/cli` are executable edges. `packages/installer` is the sole writer of host installation state.
- `adapters/{pi,omp,claude,codex}` translate host capabilities and provide native bundles plus declarative install contributions; they do not write installation targets.

Adapters MUST NOT import store/orchestrator internals, write SQLite, decide admission, implement scheduling, or independently modify host configuration.

## State model, streams, and deterministic genesis

Authority is split across one workspace stream and one run stream per run. `WorkspaceOperationalState` contains principals, grants, active workspace policy, workspace quotas, credential-reference metadata, installer-independent workspace settings, and workspace migration/import provenance. `RunOperationalState` contains only run-scoped tasks, edges, attempts, leases, dispatch, forks, proposals, receipts, evidence metadata, decisions, approvals, run quota consumption, artifacts, context epochs/manifests, conflicts, and recovery markers. Each hashed event envelope names `workspaceId`, `streamKind` (`workspace` or `run`), `streamId`, and that stream's monotonically allocated sequence.

Commands touching one stream append atomically to that stream. A workspace-plus-run command uses one SQLite transaction that validates both expected cursors, allocates both sequences, appends both event sets, updates command deduplication and projections, and commits or aborts as a unit. Its result cursor is `CompositeCursor = {workspaceId, workspaceSequence, workspaceEnvelopeHash, runId, runSequence, runEnvelopeHash}`. Admission, fork creation, context materialization, authorization, and quota checks pin this cursor; replay never combines independently current workspace and run views.

### CanonicalDocument

`CanonicalDocument = {runId, revision, document, stateHash, hashAlgorithmVersion, canonicalizerVersion, acceptedProposalId, lastCanonicalEventSequence}`.

`RunCreated` is the deterministic genesis event. Its payload contains the initial document value and selected supported canonicalizer/hash versions. Reduction produces revision `0`, the canonical serialization and hash of that initial document, `acceptedProposalId: null`, and `lastCanonicalEventSequence` equal to the `RunCreated` run-stream sequence. There is no implicit empty document, sentinel hash, or out-of-log constructor. Thereafter only `DeltaAccepted` advances this aggregate; revision increases by exactly one and `stateHash` covers canonical serialized `document` bytes only.

### RunOperationalState and context ordering

Operational changes never change canonical revision or state hash. A canonical read identifies `(revision, stateHash, canonicalizerVersion, hashAlgorithmVersion, lastCanonicalEventSequence)` plus its composite cursor. Context epoch advances exactly when a durable context-visible input changes. Every active-policy-reference transition—activation, replacement, deactivation, or fallback/no-policy—advances it; policy creation alone does so only if that document becomes context-visible. Restart/recovery alone never advances it.

### Immutable forks and attempt bindings

`ForkPin` is an immutable content-addressed record with `forkId`, `pinVersion`, parent run, canonical revision/hash/version tuple, composite cursor, immutable task/dependency outcome snapshot digest, ancestry, pinned policy digest, and context epoch. Refresh never edits a pin: an authorized `ForkRefreshed` creates a new pin version with lineage. `AttemptContextBinding` is immutable per dispatch generation and binds attempt ID/generation, ForkPin digest, ContextManifest digest, composite cursor, provider idempotency key, and expected receipt digest fields.

A retry either explicitly reuses the old ForkPin and creates a new attempt generation with a newly materialized manifest limited to that pin, or first creates an authorized refreshed ForkPin and then a new generation. Reconciliation, reattach, or adoption of an already handed-off provider operation MUST retain the original binding and key; changed context always means a new generation and key. Receipts after the old pin are not read into a retry unless a refresh pins them.

### Event integrity and artifact publication

Every transition is `authenticated command -> authorization -> validation -> immutable raw event(s) -> pure reducers`. Envelopes contain schema version, stream identity/sequence, event ID, principal ID, causation/correlation/idempotency IDs, prior-envelope hash, and raw payload hash. Integrity covers original canonical stored envelope bytes. Raw chains are verified before upcasting; current-version views never rewrite history.

Referenced content-addressed bytes use a publish-before-reference protocol: write a same-filesystem temporary file, hash and verify it, fsync file and parent, atomically rename to its digest path, then in one SQLite transaction verify the published object and append events/references/pins. A crash may leave only an unreferenced complete object, which GC may collect; no authoritative reference may precede publication. Reads reverify digest and size. Missing or corrupt referenced objects fail closed, block admission/dispatch/replay, and emit a recovery finding; they are never reconstructed from untrusted metadata.

The first usable store includes schema metadata, migration ledger, and migration `0001`; every database opens through it. Unsupported newer stores are refused without mutation. Backups precede later migration; reverse migration is supplied when safe, otherwise downgrade is major-gated with explicit backup/export confirmation.

### Event reduction matrix

| Event class | CanonicalDocument | RunOperationalState | WorkspaceOperationalState | Context epoch |
|---|---:|---:|---:|---:|
| `RunCreated` | creates revision zero | initializes run | unchanged | initializes |
| `DeltaAccepted` | advances revision/hash | records decision/proposal | unchanged | advances |
| proposal/receipt/evidence/decision/approval | unchanged | reduces | unchanged | advances when visible input changes |
| task/dependency/attempt/lease/dispatch/fork/join | unchanged | reduces | unchanged | advances when visible input changes |
| policy/grant/quota lifecycle | unchanged | run reference/usage only | reduces authoritatively | advances on visible reference/input change |
| snapshot/recovery markers | unchanged | semantic markers only | semantic markers only | restart alone never advances |

## Proposal and canonical delta contract

`ProposalEnvelopeCoreV1` is sealed at submission and contains the canonical proposal identity fields; workspace/run IDs; author principal/grant digest; attempt and receipt lineage; exact `ForkPinCoreV1` and `DeltaAuthorityScopeV1` digests; base revision/state hash/canonicalizer/hash versions; `proposalSealingObservationCursor` and matching context version; ordered `DeltaOperationV1[]`; sorted unique evidence claims; policy provenance; nonce; and optional predecessor identity/reason. Its sole identity algorithm and visibility semantics are frozen in the final-review section.

`DeltaOperationV1` is a closed tagged union over canonical JSON Pointer paths: `test(path, expectedValueDigest)`, `add(path, value)`, `replace(path, expectedValueDigest, value)`, and `remove(path, expectedValueDigest)`. Paths use RFC 6901 canonical escaping; root replacement is explicit; array indices are canonical unsigned decimal without leading zero and `-` is prohibited; duplicate write targets, ancestor/descendant write overlap, non-finite numbers, duplicate object keys, and values outside canonical JSON are invalid. Operations execute once in listed order against the pinned base. Every write requires its declared precondition; a failed test, missing/existing mismatch, stale base, scope escape, unsupported version, or final byte-identical document is `conflicted` or `rejected` by stable reason and never advances revision. Concurrent acceptance is an expected-revision/hash compare-and-swap.

`DeltaAccepted` persists the entire accepted sealed envelope or its digest plus an immutable content-addressed envelope object, the exact evidence set, evaluation record, prior and resulting document hashes, canonicalizer/hash versions, and operation-result digest sufficient for deterministic replay. Rebase/amendment always creates a new sealed proposal/digest with lineage; terminal history is immutable.

## Authoritative task, dependency, and join model

Tasks transition `draft -> blocked|ready -> running -> succeeded|failed|cancelled`, with `running -> ready` only by a recorded retry generation while retry policy permits. `unknown_outcome` is an attempt/dispatch state and prevents task terminalization or retry until reconciled/resolved. Dependency edges are typed `requires_success`, `requires_terminal`, or `requires_outcome(allowed[])`. Edge creation validates both tasks, rejects self-edges/cycles, and is mutable only while the dependent task is `draft` and before any ForkPin or attempt snapshot includes it.

A task is `ready` iff its contract is valid, every incoming edge has a terminal source outcome satisfying that edge, no incoming source is unknown, cancellation has not propagated, policy/grants/quota permit dispatch, and no live attempt exists. A terminal unsatisfied dependency deterministically marks the dependent `blocked` with a sorted dependency-outcome set; cancellation propagates only where the edge contract declares it. Each dependency outcome binds source task ID, terminal event sequence, receipt/result digest, outcome, attempt generation, and composite cursor.

A join is an immutable event recording the sorted dependency-outcome identities/digest and the resulting readiness/block decision at a composite cursor. Retries create new outcome identities; they never rewrite a prior join. ForkPin captures the exact join/dependency snapshot digest. Reducer/model tests are authoritative for cycle rejection, late mutation, mixed outcomes, cancellation, retries, joins, and replay-identical ready sets.

## Principals, authorization, and admission

Principals are `authority`, `approver`, `operator`, `worker`, and `adapter`, with workspace-scoped grants and attempt-scoped capabilities. Transport authentication binds principal, OS-local identity, workspace, and grant digest to a connection; client actor fields are ignored. Every evaluation records `evaluatedAt` from an injected authority clock, the exact composite cursor, grant/quota snapshot digests, proposal/policy digests, and evaluator version. Expiry is valid only while `evaluatedAt < expiresAt`; equality is expired. Expiry events are idempotent by subject/boundary/cursor.

The admission enum is `accepted`, `rejected`, `conflicted`, `quarantined`, or `approval_required`. Accepted/rejected/conflicted are terminal for one sealed proposal digest. Quarantined and approval-required are pending and never advance canonical state. There is no manual acceptance bypass.

| Current | Command | Required outcome |
|---|---|---|
| submitted | evaluate | one enum value |
| approval_required | approve | record approval, then evaluate from scratch at a new composite cursor |
| approval_required | approval expires/grant revoked | invalidate approval and return proposal to `submitted`; evaluate may again require approval |
| approval_required | explicit reject | terminal `rejected` |
| quarantined | release | `submitted`, then full evaluation |
| conflicted | rebase | new sealed proposal/digest with lineage; old remains terminal |
| any terminal | retry | idempotently return original result |

Approvals bind proposal digest, base tuple, both evaluated policy digests, approver grant digest, allowed action, issue/evaluation cursor, and expiry. A replacement approval is a new approval record, not a mutation. Semantically identical resubmission retains the same proposal digest; if the old proposal is terminal it cannot escape that result—continued work requires a lineage-bearing new envelope whose nonce/reason changes the digest.

Policies are immutable content-addressed documents. Admission always evaluates the fork-pinned policy and current active policy independently and takes their conjunction; neither replaces the other. Constraint failures are unioned, deduplicated, and stably sorted by `(policyDigest, ruleId, subject)`. Result precedence is `rejected > quarantined > approval_required > accepted`; `conflicted` is computed first from base/operation preconditions and dominates policy evaluation. Thus incomparable, loosened, and tightened policies are deterministic. Both digests, individual results, combined result, and explanations are recorded.

## Credential lifecycle and first-run trust

There is no unauthenticated general-purpose first call. Installation creates an owner-only bootstrap capability bound to workspace ID and the invoking local OS account; POSIX uses mode `0600` in a `0700` directory and Windows uses a non-inheriting DACL granting only that SID and administrators. An atomic compare-and-swap consumes it exactly once to append the first authority/grant events. Concurrent or different-user attempts fail closed. CLI recovery requires the same OS identity plus explicit local recovery proof, rotates credentials, and audits the event.

Adapters receive distinct least-privilege workspace/attempt grants through opaque keychain references; uninstall revokes them before deregistration. Restore never restores tokens: the local authority performs explicit restore rebinding after replay. Endpoint discovery uses owner-only state files and authenticated startup; start/stop/rotation/revocation/lost-token recovery are CLI/daemon operations. Secret values and bootstrap/capability tokens never enter logs, doctor output, journals, receipts, exports, or backups.

## Deterministic context and automatic dispatch

Every context input is durable immutable data: objective, task contract, canonical slice, dependency outcomes, ForkPin, receipts visible at that pin, evidence, unresolved decisions, approvals, both policy documents, renderer configuration, exact host/system instruction bytes with origin/version/digest, compaction summaries, and byte budget. Selection uses recorded priority and stable ordering. Byte count is authoritative; tokenizer counts are advisory only.

A `ContextManifest` records attempt generation, ForkPin and binding digests, composite cursor, canonical tuple, epoch, all source digests/ranges, renderer/canonicalizer versions, ordering, omissions, byte accounting, tokenizer metadata, and output digest. New launch/retry/fork switch creates an immutable binding. Reconciliation, reattach, and native resume of the same provider operation reuse the original binding; a host unable to resume with that binding fails closed or advertises an explicit reduced mode.

## Attempts, dispatch, leases, and recovery

Dispatch is a versioned guarded reducer; every transition preserves the generation's idempotency key and immutable context binding.

| From | Input/outcome | To / rule |
|---|---|---|
| planned | commit bound launch intent | launch_intent_committed |
| launch_intent_committed | provider call begins | launch_intent_committed; in-memory dispatching only |
| launch_intent_committed | handle returned or arrives late | provider_handle_recorded; adopt once |
| provider_handle_recorded | provider acknowledges | acknowledged |
| launch_intent_committed/provider_handle_recorded/acknowledged | binding-valid terminal receipt | terminal |
| any nonterminal | cancel | cancel_requested; one cancel key |
| cancel_requested | cancel handoff | cancel_handed_off |
| cancel_handed_off | cancelled or provider-terminal race | first durable terminal fact wins |
| launch_intent_committed/provider_handle_recorded after crash | lookup supported | reconciliation_required |
| reconciliation_required | found | adopt handle and original binding; never relaunch |
| reconciliation_required | definitively not found and launch is idempotent | planned for same generation/key |
| reconciliation_required | unsupported, ambiguous, or error | unknown_outcome |
| unknown_outcome | authorized mark-terminal | terminal with resolution provenance |
| unknown_outcome | authorized duplicate launch | new generation/key plus explicit duplicate-risk event; old generation remains linked |

Illegal transitions and conflicting late handles produce findings without reducer mutation. Native reconnect/reattach/resume is a declared SPI capability and receipt; it never rematerializes context for the same provider operation. Outbox claims are leased and replay-safe. Lease persistence records UTC deadline, duration, boot/process identity, and cursor; injected monotonic time is only for in-process checks. Recovery uses explicit skew tolerance and one idempotent expiry event.

## Storage, quotas, retention, and import

SQLite uses WAL, foreign keys, busy timeout, a single writer queue, and workspace locking. Artifact writes use temporary files, digest verification, fsync, and atomic rename.

Versioned quota/retention policy defines workspace/run/object limits, admission backpressure, snapshot/log/export cleanup, and operator status/GC commands. Event metadata and decision/receipt provenance are immutable. Objects referenced by canonical revisions, context manifests, retained receipts/decisions, active forks, backups, or exports are pinned. Collection deletes only unpinned bytes after a durable tombstone and reference-accounting transaction; audit/replay promises explicitly report any policy-authorized payload eviction.

Backup restore and foreign import are separate:

- Restore requires compatible verified backup identity, empty or explicitly replaced target, confirmation, pre-restore backup, and deterministic replay before activation.
- Foreign import extracts into a new isolated quarantined workspace/namespace, validates paths, IDs, actors, schemas, policies, quotas, and hashes, and never merges into or replaces an existing authoritative stream. Promotion requires explicit authorized review and emits provenance links rather than rewriting history.

## Secrets and command execution

Horseness stores only opaque keychain/host credential references. The secure process boundary uses argv arrays, realpath-constrained executable/cwd, allowlisted environment, credential removal by default, and bounded/redacted receipts. A controlled live-host gate may resolve specifically allowlisted opaque CI keychain references for least-privilege test accounts under network/time/cost limits; validator, fake-host, local deterministic-provider, and credentialed-live receipts are distinct.

## Protocol and host integration

JSON-RPC 2.0 runs over stdio or permission-restricted Unix socket/Windows named pipe; TCP is disabled by default. The SPI includes capability detection, launch/cancel/reconcile, reconnect/reattach/native-resume, context injection, receipt collection, native-package metadata, declarative install contributions, and doctor probes.

Each required host must ship a loadable native contribution: Pi extension plus skills, OMP plugin/skills metadata, Claude Code plugin with namespaced command/skill/agent/hook contributions, and Codex plugin/skill/MCP contribution. Minimum exercised capability is discovery, load, context injection, one attempt through a local deterministic provider or controlled live account, receipt binding, restart/reconcile or declared unsupported result, and uninstall. CLI-only mode is additional degradation, never a substitute. C11 blocks and requires an explicit scope replan if an official native mechanism cannot meet this minimum.

Hermetic real-binary/official-validator gates are mandatory and never skip. Credentialed live gates use pinned host/model/account provenance, opaque CI secret references, rotation/revocation, redaction, and budgets; unavailable required live evidence fails closed at publication. Every adapter smoke covers daemon restart, host restart, session/thread resume where supported, fork switch, and receipt-to-manifest matching.

`doctor` is read-only, bounded, and redacted; `repair` is separate and mutating. Its versioned result schema reports checks with `ok|warning|error`, stable codes, evidence digests, and restart-required flag; exit is 0 with no error, 1 with errors, 2 for invocation failure. It checks host/version/capabilities, bundle loading, contribution ownership/drift, journal phases, provenance/signatures, daemon transport/permissions, availability of credential references without reading values, database/migration health, and restart state.

## Installer, bootstrap, and release security

The bootstrap trust root is deliberately smaller than Horseness: published project release keys plus the user's authenticated retrieval channel. Online installation downloads a self-contained, script-free bootstrap executable and signed release manifest before execution; documented out-of-band SHA-256/Sigstore verification checks expected repository/issuer, version, anti-replay release sequence, revocation list, and key-rotation chain. Corepack/pnpm and arbitrary package lifecycle code are not in the execution path. Offline media contains the same bootstrap, manifest, key chain, and revocation snapshot. Compromise recovery revokes keys/releases and requires a newer trusted root statement.

Host installation scope is separate from workspace authority. A versioned scope-local journal is append-only by action and has atomic schema migration: verify and backup old bytes, stage/fsync migrated bytes, CAS rename, retain the previous readable generation until operation completion, then append completion. Readers support documented N-1/N, refuse unknown newer versions without mutation, and gate irreversible downgrade. Journal actions order daemon quiesce, store backup/migration, staged package/config changes, activation, health checks, and compensation so rollback restores the prior readable journal, database, bundles, and config.

`--host all` means all four requested hosts. Detection classifies each as present-supported, absent, unsupported, managed-blocked, or failed. Default is one journal transaction per host: absent is a reported no-op, unsupported/managed is an error, successful hosts remain installed if another host fails, and the overall exit is partial-failure; `--atomic-hosts` stages all and compensates all on any error. JSON results enumerate every host/action. Retry resumes or compensates incomplete phases idempotently.

Uninstall first atomically disables/deregisters every receipt-owned executable contribution from host discovery, regardless of byte drift. Unchanged unshared bytes are removed; modified bytes are moved to a non-executable quarantine with forensic warning; shared content is disabled for that owner and removed only at zero refcount. `--purge` is a separate explicit destructive action. Credentials are revoked before deregistration.

Release artifacts—packages, native bundles, self-contained bootstrap, offline archive, manifests, checksums, SBOM, provenance, compatibility/migration data, changelog, rollback instructions, and key/revocation metadata—are one signed train. Publication is staged under immutable versions, verified before tags move, and followed by exact-public-artifact install, doctor, native load, upgrade/rollback, uninstall, signature/provenance, and cross-platform checks. Two clean builds must compare canonical archives byte-for-byte.


## Normative contract freeze — review round three

This section is normative and supersedes any earlier singular `context epoch`, task `ready|blocked` lifecycle, proposal-ID alternative, underspecified delta, receipt, dispatch-race, genesis, consent, doctor, uninstall, or release wording.

### Event-chain genesis and composite context version

Both streams use canonical JSON version `jcs-v1` and `sha256-v1`. Sequence starts at `1`; first envelopes have `priorEnvelopeHash:null`. `WorkspaceCreated` and `RunCreated` use the expected-absent cursor/CAS and typed result contracts frozen in the final-review section; no full composite value is required before both streams exist.

Context versions are typed by cursor scope: workspace-only versions contain the workspace epoch and workspace cursor, run-only versions contain the run epoch and run cursor, and full composite versions contain both epochs and a composite cursor. Source context versions and current authorization context versions are distinct as frozen below. Epoch increment rules remain transaction-based and replay deterministic.

### Acyclic manifest and binding hashes

Construction order is fixed:

1. `ContextManifestCoreV1` contains manifest version, workspace/run/attempt/generation, ForkPin digest, `ContextVersion`, canonical tuple, ordered source descriptors/digests/ranges, renderer/canonicalizer versions, omissions, byte accounting, tokenizer metadata, and rendered output digest. It contains neither a binding digest nor a binding object.
2. `contextManifestCoreDigest = sha256("horseness.context-manifest-core.v1\0" || canonicalJson(ContextManifestCoreV1))`.
3. `AttemptContextBindingV1` contains binding version, attempt/generation, ForkPin digest, `contextManifestCoreDigest`, `ContextVersion`, provider idempotency key, expected receipt schema/version, and allowed producer principal/grant digest.
4. `attemptContextBindingDigest = sha256("horseness.attempt-context-binding.v1\0" || canonicalJson(AttemptContextBindingV1))`.
5. `ContextManifestRecordV1 = {core, contextManifestCoreDigest, attemptContextBindingDigest}` is a storage convenience. Its back-reference is excluded from the core digest. Receipts bind both digests. Fixed empty/minimal/nonempty golden vectors must assert exact canonical bytes, both digests, mutation sensitivity, reconstruction equality, and replay equality.

### Durable task lifecycle versus derived schedulability

Durable `TaskLifecycle` is only `draft -> active -> succeeded|failed|cancelled`; `active` remains durable across retries and dependency/policy changes. `Schedulability` is a projection, never an event-authored lifecycle value: `ineligible|blocked|ready|running|unknown_outcome|terminal`. It is recomputed at a pinned composite cursor from contract validity, newest dependency-outcome identities, cancellation propagation, grants, both policies, quotas, live attempt, and attempt outcome. An immutable `JoinEvaluated` records inputs and result for audit, but a newer join supersedes it in the projection without rewriting history. Upstream retry success can produce `blocked -> ready`; grant/quota/policy revocation can produce `ready -> blocked`; restoration can return `blocked -> ready`; a live attempt produces `running`; unresolved handoff produces `unknown_outcome`. Dispatch CAS must re-evaluate the predicate at its transaction cursor.

### Proposal identity and exact delta semantics

`proposalDigest = sha256("horseness.proposal.v1\0" || canonicalJson(ProposalEnvelopeCoreV1))`, where the core excludes only `proposalDigest` and `proposalId`. `proposalId = "prp_" + lowercaseBase32NoPadding(proposalDigestBytes)`. No alternate or separately bound ID is valid. Submission recomputes both and rejects `PROPOSAL_ID_MISMATCH`; lookup, deduplication, approvals, terminal results, and predecessor links use the canonical pair. Same core means the same pair and idempotent resubmission; amendment/rebase changes nonce/reason/lineage and therefore both.

Value digests are `sha256("horseness.json-value.v1\0" || canonicalJson(value))`. Operations run in listed order against a working document after the base tuple is verified:

| Operation | Required precondition | Exact application |
|---|---|---|
| `test(path, expectedValueDigest)` | path exists and current value digest equals expected | no mutation |
| `add(path, expectedParentDigest, value)` | non-root parent exists and its pre-operation digest equals expected; object member is absent; array index is `0..length` | create object member or insert before array index; index equal to length appends |
| `replace(path, expectedValueDigest, value)` | path exists and current value digest equals expected | replace exactly that value; root allowed |
| `remove(path, expectedValueDigest)` | non-root path exists and current value digest equals expected | remove member or array element |

`add` at root is invalid; `-` is invalid; array indices are unsigned canonical decimal with no leading zero. Preconditions observe mutations from earlier operations. Write-target duplicates and ancestor/descendant write overlap are rejected before execution.

| Stable reason code | Outcome |
|---|---|
| `STALE_BASE`, `TEST_FAILED`, `ADD_PARENT_CHANGED`, `ADD_TARGET_EXISTS`, `PATH_MISSING`, `VALUE_DIGEST_MISMATCH`, `ARRAY_INDEX_RANGE` | `conflicted` |
| `INVALID_ENVELOPE`, `PROPOSAL_ID_MISMATCH`, `UNSUPPORTED_SCHEMA_VERSION`, `UNSUPPORTED_CANONICALIZER`, `UNSUPPORTED_HASH`, `INVALID_POINTER`, `ROOT_ADD_FORBIDDEN`, `ROOT_REMOVE_FORBIDDEN`, `DUPLICATE_WRITE_TARGET`, `OVERLAPPING_WRITE_TARGET`, `SCOPE_ESCAPE`, `INVALID_JSON_VALUE`, `EVIDENCE_MISMATCH`, `RECEIPT_MISMATCH`, `FINAL_DOCUMENT_UNCHANGED` | `rejected` |

Conflict checks precede policy evaluation. Structural/version/authenticity rejection precedes conflict checks. Golden vectors cover object add, array insert/append, root replace, ordered preconditions, each reason code, and final hashes.

### AttemptReceiptEnvelopeV1

Domain owns `AttemptReceiptEnvelopeV1 = {schemaVersion:"1", receiptId, workspaceId, runId, taskId, attemptId, generation, attemptContextBindingDigest, contextManifestCoreDigest, forkPinDigest, providerId, providerOperationId, providerIdempotencyKeyDigest, producerPrincipalId, producerGrantDigest, adapterId, adapterVersion, hostId, hostVersion, outcome, startedAt, finishedAt, outputDigest|null, evidence:[{digest,mediaType,size}], provenance, nonce, receiptDigest}`. Evidence is sorted unique by digest. `outcome` is `succeeded|failed|cancelled`; timestamps are authority-validated metadata and never order events.

`receiptDigest = sha256("horseness.attempt-receipt.v1\0" || canonicalJson(all fields except receiptId and receiptDigest))`; `receiptId = "rcp_" + lowercaseBase32NoPadding(receiptDigestBytes)`. The adapter authenticates to `orchestrator.submitAttemptReceiptV1`; transport identity must equal `producerPrincipalId`, the attempt-scoped grant must authorize that attempt/generation, and every binding, manifest, pin, operation, idempotency, artifact digest/size, adapter and host field is verified before `AttemptReceiptRecorded` appends. Publish evidence/output objects before submission.

The canonical idempotency key is `(attemptId,generation,receiptDigest)`. Exact duplicate submission returns the original event/result. A different digest after a terminal receipt is `RECEIPT_TERMINAL_CONFLICT`, records a finding, and does not mutate attempt/task outcome. A valid first terminal receipt is accepted from every post-handoff nonterminal dispatch state and is the first durable terminal fact. Pre-handoff receipt is rejected. Late valid receipts while `cancel_requested`, `cancel_handed_off`, `reconciliation_required`, or `unknown_outcome` terminalize the generation and supersede uncertainty; a prior authorized manual terminal resolution wins and the receipt becomes a non-mutating late finding. Task lifecycle becomes `succeeded|failed|cancelled` from the winning receipt outcome; joins and context consume its digest. Proposal lineage may cite only an accepted recorded receipt for its bound attempt.

### Complete post-handoff race table

For each of `handed_off`, `provider_handle_recorded`, `acknowledged`, `cancel_requested`, `cancel_handed_off`, `reconciliation_required`, and `unknown_outcome`: a binding-valid first terminal receipt transitions to `terminal`; a same-operation late handle is adopted once if absent and otherwise idempotent; a conflicting handle records a finding without mutation; a late acknowledgement records acknowledgement metadata unless already terminal, where it is audit-only. Cancel acknowledgement never overrides a prior provider-terminal receipt. Manual resolution is allowed only in `unknown_outcome`; after it, all provider terminal facts are audit-only findings. C02 vectors and C10 crash/restart races cover every state × terminal/handle/ack input.

### Consent, doctor, and fail-safe uninstall

`InstallConsentV1` binds release-manifest digest, exact artifact digests, requested hosts, declared executable capabilities, install scope, local OS identity, timestamp, and consent mode. Interactive activation requires an explicit yes; unattended activation requires `--accept-executable-risk=<releaseManifestDigest>`. Missing/mismatched acknowledgement exits 4 before host mutation. Artifact, capability, host-set, scope, or identity change invalidates consent. The journal records consent and rollback restores the prior consent generation.

Default `doctor` never loads contribution code: it hashes bytes, validates signatures/manifests/registrations/permissions/provenance and reports loadability as `unverified`. `horseness smoke --isolated-host-home` is the only active probe; it uses a disposable home, deny-by-default environment/network/credentials, and discards the process tree. Ordinary doctor must cause no filesystem, process, network, database, journal, keychain, or host-config mutation.

Uninstall states are `kill_switch_written -> discovery_disabled -> authority_revocation_pending|authority_revoked -> bytes_removed_or_quarantined -> complete`. The owner-only local kill-switch/capability tombstone is checked by daemon and adapters and immediately rejects cached credentials even if daemon/store/keychain is unavailable. Discovery is then disabled. Failed authority revocation is durably pending and retried after recovery; it never re-enables contributions. Crashes resume idempotently from the journal.

### Release trust and promotion state machine

The signed release manifest is verified by both a pinned project-root signature and Sigstore identity `(issuer, repository, workflowRef, protectedEnvironment)`; both are mandatory. C00 records initial root fingerprints and rotation/revocation rules. CI uses short-lived OIDC trusted publishing with per-registry package scopes; static registry/signing secrets are forbidden. Break-glass uses an offline threshold-signed root update and publishes revocation before replacement.

Publication is append-only: `prepared -> immutable_staging -> reconciled -> black_box_verified -> promoted -> announced`, with `partial`, `abandoned`, and `revoked` branches. Every destination has a journal entry containing target, immutable version/reference, expected and observed digest, request id, and status. Retry first looks up bytes and accepts only an exact digest; mismatch abandons and revokes that version, then rolls to a new version. Mutable tags/default channels and the signed install manifest move only after exact-public-byte C24 verification. Partial receipts are mandatory. Completion requires every signed-manifest target reconciled and promotion receipts present.

## Normative contract freeze — review round four

This section is normative and supersedes conflicting earlier wording.

### Observation cursor, result cursor, and acyclic construction

Every command carries `observationCursor` (also the optimistic expected cursor) and the matching pre-transaction `observationContextVersion = {workspaceContextEpoch, runContextEpoch, observationCursor}`. Authorization, validation, policy, quota, dependency, fork visibility, and every content digest constructed by that command use only this pre-append observation state. A successful transaction returns `resultCursor` and `resultContextVersion` containing the committed post-transaction sequences, envelope hashes, and epochs. Result cursors are command/event metadata and MUST NOT occur in the preimage of any object referenced by an event in that same transaction.

For `ForkCreated`, context materialization, and attempt binding, construction is: read and validate observation cursor; compute pre-append epoch values; construct and hash ForkPin, `ContextManifestCoreV1`, and `AttemptContextBindingV1` against `observationContextVersion`; publish their bytes; append events that reference those digests; increment each affected epoch once; hash envelopes; return the post-append result cursor/version. A later command may observe that result cursor and create new objects, but the appending command cannot retroactively bind it. C02 owns exact no-op, workspace-only, run-only, and dual-stream golden vectors containing canonical object bytes, preimages, event bytes, observation/result sequences and hashes; C05 replay must reproduce them byte-for-byte.

Pagination and subscriptions likewise distinguish `afterObservationCursor` from each emitted event's `resultCursor`; neither is called merely `cursor` on a persisted or wire contract.

### Canonical no-policy identity

There are no nullable policy slots after reduction. `NoPolicyV1 = {schemaVersion:"1", kind:"no-policy", rules:[]}` and `noPolicyDigest = sha256("horseness.policy.v1\0" || canonicalJson(NoPolicyV1))`. `WorkspaceCreated`, deactivation, and fallback set the active policy reference to this digest. ForkPins always pin either a real immutable policy digest or `noPolicyDigest`. Protocol encoding uses the digest and document, never JSON null.

Evaluation of `NoPolicyV1` is the neutral result `{result:"accepted", constraints:[], explanations:[{policyDigest:noPolicyDigest,ruleId:"NO_POLICY",subject:"*",result:"accepted"}]}`. Conjunction and explanation sorting remain unchanged, so no-policy×no-policy, no-policy×policy, and policy×no-policy are deterministic. Approvals bind both evaluated digests including `noPolicyDigest`. Activation/deactivation advances the workspace epoch exactly once. C02 vectors and C04/C07 tests cover all three products, activation/deactivation, approval invalidation, replay, and wire round trips.

### Attempt terminality and task resolution

`AttemptGenerationState` and `TaskLifecycle` are independent. A binding-valid first terminal receipt changes only its generation to `succeeded|failed|cancelled`; it never directly makes the task terminal. The task remains durable `active` until exactly one `TaskResolvedV1` event is appended. `TaskResolvedV1` records the sorted considered generation outcomes, winning generation or null, retry-policy digest, arbitration reason, observation cursor, and resolution `succeeded|failed|cancelled`.

After a successful generation, the resolver deterministically selects the earliest run-stream terminal-receipt event sequence among all binding-valid successes observed in the same serialization transaction and emits `TaskResolvedV1(succeeded)`; later outcomes are audit-only. After failure or cancellation, the task remains active when a retry is permitted and its deterministic backoff/attempt limit has not been exhausted. A new generation is created only by `RetryScheduledV1`, which records prior generation, retry ordinal, retry-policy digest, not-before authority time, reused/refreshed pin decision, and reason. When no retry is permitted, the resolver emits `failed` after all live/unknown duplicate-risk generations are terminal or explicitly resolved. Cancellation resolves the task only after every handed-off generation is terminal/cancelled or manually resolved and no authorized duplicate generation remains live.

An authorized duplicate-risk launch creates a concurrently live generation but does not supersede the old one. Arbitration priority is: earliest terminal success event sequence wins; otherwise wait until no generation is live or unknown; then an explicit task cancellation wins; otherwise choose `failed` with the sorted generation outcome set. Provider timestamps and generation numbers never decide the winner. Once `TaskResolvedV1` exists, every later receipt or manual generation resolution is recorded as a non-mutating late fact/finding.

Dependency outcomes and joins bind only `TaskResolvedV1` identity, sequence, resolution digest, winning generation if any, and result cursor—not individual attempt terminal receipts. Thus retries do not publish a dependency outcome until the task resolves, and old/new generation races cannot rewrite a join. C02 vectors and C08/C10 model/restart tests enumerate retryable failure, exhausted failure, cancellation, duplicate success/success, success/failure in both event orders, unknown resolution, late receipt, join visibility, and replay-identical arbitration.

### Workspace selection for one-command setup

Installation scope and workspace authority remain separate. The sole setup invocation MUST include `--workspace <absolute-path-or-workspace-id>`. A path is realpath-normalized and deterministically maps to the stored workspace ID; an ID must already exist unless paired with `--create-workspace`. Creation is explicit and compare-and-swap guarded. No implicit current-workspace, most-recent, or single-candidate selection is allowed. The install journal binds normalized path/ID, authority identity, credential-reference generation, and every host contribution. Reinstall is idempotent only for the same binding; a mismatch exits `2` before mutation. Upgrade and rollback retain that binding; `rebind-workspace` is a separate explicit authorized operation. C20/C24 cover zero, one, and multiple workspaces, mismatch, reinstall, upgrade, rollback, and host credential rebinding.

### Uninstall completion and retained kill switch

Uninstall states are `kill_switch_written -> discovery_disabled -> authority_revocation_pending|authority_revoked -> local_bytes_removed_or_quarantined -> local_complete_revocation_pending|complete`. Local cleanup may finish while revocation is unavailable, but terminal `complete` requires a verified authority-revocation receipt. In `local_complete_revocation_pending`, CLI exits `3`, JSON reports local completion plus pending authority risk, doctor reports stable error `UNINSTALL_REVOCATION_PENDING`, and retry continues without re-enabling discovery. The owner-only kill switch is retained through local removal, purge, journal compaction, reinstall attempts, and daemon absence until verified revocation; purge cannot remove it. Auditable abandonment requires a separately authorized workspace policy action that records residual credential risk and produces a terminal `complete_with_revocation_abandoned`, never ordinary `complete`.

### Release signer and external-effect authority

Routine project-root authorization uses a root-signed, version/range-bounded delegated release key in hardware-backed KMS. A protected CI environment obtains a signature through short-lived OIDC only after two distinct maintainer approvals; repository, workflow ref, protected environment, manifest digest, and version are KMS policy inputs. CI never receives private key material. The signed delegation, signature, KMS operation receipt, approver identities, and transparency timestamp are release-train artifacts. Unauthorized signer, wrong delegation range, missing quorum, revoked delegation, or mismatched digest fails closed. Rotation publishes a new root-signed delegation before use; revocation precedes replacement. Offline threshold root keys are used only for delegation/root recovery.

Publication journals are an authenticated append-only authority independent of an executor worktree. Every external request is bracketed by a durable CAS intent record and observed-result record keyed by operation ID, expected digest, destination, immutable reference, and request ID. Recovery performs lookup first, accepts an exact digest only, records mismatch as abandoned/revoked, and never repeats an unknown non-idempotent effect. Promotion verification records every default channel and signed install-manifest pointer before announcement is authorized.

## Normative contract freeze — final review

This section supersedes every conflicting cursor, pin, scope, dispatch, authorization, and local-plugin security statement above.

### Cursor variants, genesis, and command results

`ObservationCursorV1` and `ResultCursorV1` are closed tagged unions with identical stream-bearing variants but different type names and purposes. Their canonical encodings are:

- `AbsentWorkspaceGenesisCursorV1 = {schemaVersion:"1",kind:"absent-workspace-genesis",workspaceId,expectedWorkspaceHead:"absent"}`. It carries no epochs. It is valid only for `CreateWorkspaceV1`; CAS succeeds only when no workspace stream, projection, command-dedup row, or authority-consumption record exists.
- `WorkspaceOnlyCursorV1 = {schemaVersion:"1",kind:"workspace-only",workspaceId,workspaceSequence,workspaceEnvelopeHash,workspaceContextEpoch}`. It authorizes only commands against an existing workspace that neither create nor address a run; no run ID or run epoch is encoded. It is forbidden for `CreateRunV1`.
- `AbsentRunGenesisCursorV1 = {schemaVersion:"1",kind:"absent-run-genesis",workspaceId,workspaceSequence,workspaceEnvelopeHash,workspaceContextEpoch,runId,expectedRunHead:"absent"}`. It is the sole valid observation cursor for `CreateRunV1`; CAS validates the named workspace head and complete absence of the run stream, run projection, run-scoped command-dedup rows, and run authority-consumption records.
- `RunOnlyCursorV1 = {schemaVersion:"1",kind:"run-only",workspaceId,runId,runSequence,runEnvelopeHash,runContextEpoch}`. It is permitted only for run-local storage/replay operations whose authorization grant snapshot is already content-bound and which neither read nor mutate workspace authority; authority, policy, quota, grant, fork, admission, dispatch, and context commands MUST reject it with `CURSOR_SCOPE_INSUFFICIENT`.
- `CompositeCursorV1 = {schemaVersion:"1",kind:"composite",workspaceId,workspaceSequence,workspaceEnvelopeHash,workspaceContextEpoch,runId,runSequence,runEnvelopeHash,runContextEpoch}`. It is required for every workspace-plus-run operation.

`CreateWorkspaceV1` observes `AbsentWorkspaceGenesisCursorV1` and atomically appends exactly one workspace envelope: sequence 1, epoch 0, event `WorkspaceCreatedV1`. That event contains the workspace identity, initial authority principal, initial grant snapshot/digest, first-authority consumption marker, and bootstrap policy reference; no separate authority or grant envelope is appended. It returns `WorkspaceOnlyResultCursorV1` naming that sequence-1 envelope/hash and workspace epoch 0. `CreateRunV1` observes only `AbsentRunGenesisCursorV1`, leaves the workspace stream/head/epoch unchanged, atomically appends exactly one run envelope at run sequence 1, epoch 0, event `RunCreatedV1`, and returns `CompositeResultCursorV1` containing the unchanged observed workspace head/epoch plus that run sequence/hash/epoch. A successful retry with the same command ID returns the identical result; a different command against an existing target fails expected-absent CAS, appends nothing, and returns the actual typed head separately, never as a successful result cursor. Workspace-only operations observe and return workspace-only variants. Run-local operations observe and return run-only variants. Composite operations observe and return composite variants. C02 freezes canonical bytes for both success envelopes/results, the duplicate-command result, the conflicting-create failure, epoch values, and every hash; C03 maps only these variants and event lists.

### Fork pin, dependency snapshot, and separated source view

`DependencyJoinSnapshotCoreV1` is immutable: `{schemaVersion:"1",runId,taskId,taskContractDigest,joinEvaluationId,joinObservationCursor,dependencies:[{edgeId,edgeType,sourceTaskId,taskResolutionEventSequence,taskResolutionDigest,winningGeneration}],schedulability,reasonCodes}`. Dependencies sort by UTF-8 `(sourceTaskId,edgeId)`; `reasonCodes` sort bytewise. Its digest is `sha256("horseness.dependency-join-snapshot-core.v1\0" || canonicalJson(core))` and its ID is `djs_` plus lowercase base32 without padding of the digest bytes.

`DeltaAuthorityScopeV1` is immutable: `{schemaVersion:"1",workspaceId,runId,taskId,roots:[CanonicalJsonPointer]}`. Roots are sorted unique; `/a` contains `/a` and descendants beginning `/a/` but never `/ab`; root `""` contains the whole document; array authority names the array pointer and therefore authorizes indices below it, while authority to `/a/0` authorizes only that element subtree. The scope digest is `sha256("horseness.delta-authority-scope.v1\0" || canonicalJson(scope))`. It is issued in the immutable task contract or an authority-signed task grant snapshot; the narrower intersection wins. No mutable policy may widen it.

`ForkPinCoreV1 = {schemaVersion:"1",forkId,pinVersion,workspaceId,runId,parentForkPinDigest,refreshesForkPinDigest,canonicalRevision,canonicalStateHash,canonicalizerVersion,hashVersion,sourceObservationCursor,sourceContextVersion,dependencyJoinSnapshotDigest,deltaAuthorityScopeDigest,pinnedPolicyDigest,ancestry:[forkPinDigest],createdByPrincipalId,createdByGrantDigest}`. `ancestry` is oldest-first, contains each strict ancestor once, and its final value equals `parentForkPinDigest` when non-null. A refresh sets `refreshesForkPinDigest` to the prior pin and `parentForkPinDigest` to that prior pin; a new dependent fork sets only its actual parent. The core digest is `sha256("horseness.fork-pin-core.v1\0" || canonicalJson(core))`; `forkPinId = "fpk_" + lowercaseBase32NoPadding(digestBytes)`. `forkId` is stable lineage identity; `(forkId,pinVersion)` is unique and pinVersion increases by one only on refresh.

Every command still carries a current `authorizationObservationCursor` and `authorizationContextVersion` for CAS, current grants, current policy, quota, and revocation. Context source selection instead uses `sourceObservationCursor` and `sourceContextVersion` from the exact ForkPin. `ContextManifestCoreV1` and `AttemptContextBindingV1` record both names; sources, receipts, evidence, canonical state, dependency snapshot, and renderer inputs are selected exclusively as-of `sourceObservationCursor`. A separately named `authorizationOverlayV1` may record current policy/grant/quota decisions and digests but contributes no source bytes and cannot widen the pin or delta scope. Reusing a pin after receipts or workspace/run epoch advances yields the same source-view bytes and source version but a different authorization observation/overlay; refresh constructs a new pin and may include those facts.

`ForkCreatedV1` constructs and stores `DependencyJoinSnapshotCoreV1`, `DeltaAuthorityScopeV1`, and `ForkPinCoreV1`. `MaterializeContextV1` constructs only `ContextManifestCoreV1` from an existing pin. `BindAttemptContextV1` constructs only `AttemptContextBindingV1` from an existing pin and manifest. C02 vectors freeze minimal/full snapshot and pin canonical bytes/digests/IDs, ancestry and refresh lineage, post-pin receipt reuse versus refresh, workspace/run epoch changes, and mutation sensitivity; C09 repeats reconstruction equality.

### Proposal sealing and delta authority precedence

`ProposalEnvelopeCoreV1` names `proposalSealingObservationCursor` and matching `proposalSealingContextVersion`. They are the authority observation at which the producer seals evidence, receipt lineage, grant digest, and ordered operations. They are distinct from the ForkPin's `sourceObservationCursor` and the admission evaluator's later `evaluationObservationCursor`/`evaluationResultCursor`. Evidence and receipts not visible at proposal sealing are ineligible even if visible at evaluation; any referenced object changed, revoked, or unavailable at evaluation produces the existing stable stale/authenticity outcome rather than silently rebinding.

The proposal includes `deltaAuthorityScopeDigest`, which MUST equal the ForkPin-bound scope digest. Validation precedence is: schema/version/canonical JSON and proposal ID; pointer syntax and operation overlap; scope digest/pin binding and per-operation containment (`SCOPE_ESCAPE`); evidence/receipt/grant authenticity at proposal sealing; base/conflict preconditions; current authorization and conjunctive policy; final no-op rejection. Structural rejection never invokes policy, and policy cannot convert `SCOPE_ESCAPE` to acceptance. C02 freezes positive root/prefix/array vectors and escape/mutation vectors; C03 round-trips the exact named cursor; C07 covers scope escape and sealing/evaluation staleness.

### Dispatch receipt race closure

Before provider invocation, the authority appends `LaunchIntentCommittedV1` and transitions the generation from `planned` directly to durable `launch_intent_committed`; the record binds generation, provider, binding digests, idempotency-key digest, and intended operation class. `dispatching` is only an in-memory activity label and is never a durable recovery state. A binding-valid first terminal receipt is accepted from `launch_intent_committed` and every later nonterminal state; if it carries a matching provider handle, the handle is adopted atomically with terminalization. A crash after provider acceptance but before handle/state append therefore reconciles from the intent, and the already-arrived receipt wins. Lookup-unsupported with no receipt becomes `unknown_outcome`; it does not discard a later valid receipt. C02 transition vectors and C10 restart matrices include call accepted, receipt arrived, crash before handed-off/handle append.

### Authorization matrix V1

`CommandAuthorizationMatrixV1` is a versioned immutable policy input. `authority` alone may create/rebind workspace, issue/delegate/revoke grants, change policy/quota, approve/reject/release proposals, resolve unknown outcomes, authorize duplicate-risk launch, promote imports, rotate recovery metadata, or control daemon lifecycle. `approver` may approve only proposals and scopes explicitly delegated, never self-authored proposals or authority/grant changes. `operator` may install/upgrade/rollback/repair/uninstall and request ordinary dispatch within a workspace-scoped grant, but duplicate-risk, rebind, import promotion, and manual resolution require authority plus recorded user presence. `worker` may read its task/pin, submit bound evidence/receipts/proposals, and request cancellation for its own generation only. `adapter` may fetch one bound manifest and submit one bound receipt for its attempt-scoped grant only. Every capability binds workspace, optional run/task/attempt/generation, command set, issuer, delegatee, issued/expiry observations, nonce, and revocation sequence; delegation may only narrow scope/duration/commands and revocation is effective at the evaluator observation. Stable denials are `ROLE_FORBIDDEN`, `CAPABILITY_SCOPE_MISMATCH`, `CROSS_WORKSPACE_DENIED`, `GRANT_STALE`, `GRANT_SUBSTITUTED`, `USER_PRESENCE_REQUIRED`, and `RECOVERY_QUORUM_REQUIRED`. C02/C03 vectors and C07/C13/C14/C21 negative suites enumerate every non-authority role against each privileged command, cross-workspace access, and stale/substituted grants.

### Realizable local-plugin boundary

Arbitrary compromise of any process running as the same OS user is explicitly outside the protection boundary. Horseness guarantees integrity and fail-closed behavior against sibling users, stale or malicious-but-protocol-confined adapters, interrupted operations, and byte tampering; it does not claim that owner-only files, the journal, bootstrap capability, retained kill switch, or an adapter-side check survive a fully compromised same-user process. Recovery-root private material is never exposed to that identity. Uninstall guarantees remain crash-safe and authoritative while the daemon/installer trust base is intact. Strong isolation under a separate OS identity or sandbox is an optional future deployment profile, not a v1 claim. Security acceptance tests model the stated boundary and MUST NOT claim resistance to arbitrary same-user code execution.

## Normative contract freeze — definitive closure

This section supersedes every conflicting receipt, task-completion, adapter-return, coordinator-surface, and bootstrap-branch statement above.

### Signed checkpoint receipt contract

`CheckpointReceiptCoreV1` is the immutable unsigned receipt body. It contains the receipt variant, subject and attempt, claim/dependency lineage, W/B1/I/tree provenance, acceptance contract and ordered command results, canonical sealing/attestation/expiry proof, supersession, evidence/CI identity, and optional side-effect head. It contains no signer, signature, core digest, or envelope digest.

`coreDigest = sha256("horseness.checkpoint-receipt-core.v1\0" || canonicalJson(core))`. `CheckpointSignatureV1 = {signatureVersion:"1",algorithm:"Ed25519",keyId,principalId,signedDigest:coreDigest,signatureBase64}`. The signed bytes are exactly UTF-8 `"horseness.checkpoint-receipt-signature.v1\0" + lowercaseCoreDigestHex`; the signature is raw 64-byte Ed25519 encoded as canonical base64. `CheckpointReceiptEnvelopeV1 = {recordType:"CheckpointReceiptEnvelopeV1",schemaVersion:"1",core,coreDigest,signature,envelopeDigest}`, where `envelopeDigest = sha256("horseness.checkpoint-receipt-envelope.v1\0" || canonicalJson(envelopeWithoutEnvelopeDigest))`. Index `receiptDigest` fields always mean `envelopeDigest`. This construction is non-cyclic.

Trust lookup is exact by `keyId` in an authenticated `CheckpointTrustStoreV1`. Verification requires Ed25519, SPKI fingerprint equality, principal equality, subject/variant scope, `notBefore <= core.attestedAt < notAfter`, and no `revokedAt <= core.attestedAt`; unknown, duplicate, expired, not-yet-valid, revoked, wrong-principal, wrong-scope, substituted-core, substituted-signature, and malformed-key cases fail closed. Authority time is injected; persisted timestamps are canonical UTC seconds only (`YYYY-MM-DDTHH:mm:ssZ`) and never supply the trusted current time. Fixture keys are explicitly fixture-only and can never authorize production or release records.

### TaskCompletionPolicyV1 and dependency release

Every task contract freezes one `TaskCompletionPolicyV1`: `receipt-only`, `canonical-change`, `artifact-published`, `approval-recorded`, or an ordered conjunction of those named predicates. `receipt-only` may resolve success from the selected binding-valid attempt receipt. `canonical-change` binds the exact `proposalDigest` and requires a durable `DeltaAcceptedV1` event and resulting canonical tuple. `artifact-published` binds exact object digests and their durable publication events. `approval-recorded` binds the approval identity, scope, and unexpired evaluation cursor. A task may record successful attempt generations while its completion predicates remain pending; `TaskResolvedV1(succeeded)` is emitted only when all policy predicates are durable in one serialization transaction.

Dependency edges additionally freeze `releasePredicate`: `task-resolution` or one named completion predicate identity. Acceptance-dependent edges consume only the `DeltaAcceptedV1`-bound completion identity, never an attempt receipt, proposal submission, evaluation start, approval request, or provisional decision. `rejected`, `conflicted`, `quarantined`, `approval_required`, not-yet-evaluated, revoked approval, and missing/corrupt evidence keep such edges unsatisfied. Admission and resolver races serialize on the run cursor; restart replays the same predicate projection; duplicate host callbacks and subscription redelivery are idempotent. No dependent join, ForkPin, context binding, launch intent, or provider dispatch may occur before the predicate is durable. C02/C08/C10/C21 model every ordering and restart, and each C24 host loop proves accepted release plus all five non-release outcomes.

### WorkerReturnV1 and native decision loop

The SDK/SPI freezes a credentialed `WorkerReturnV1` path: publish output and evidence objects; submit the binding-valid attempt receipt; seal `ProposalEnvelopeCoreV1` against the receipt, evidence, ForkPin, scope, and proposal-sealing cursor; submit it; subscribe/poll by canonical proposal identity; and surface `accepted|rejected|conflicted|quarantined|approval_required` plus stable reasons to the originating host session. Adapters remain transport translators: they cannot evaluate admission, alter deltas after sealing, synthesize authority decisions, or write storage. Retries after conflict/rejection create a new lineage-bearing proposal; pending decisions resume by identity without duplicate submission.

Pi, OMP, Claude Code, and Codex conformance each must originate output, evidence, receipt, and proposal through the actual native contribution, observe an accepted canonical revision, reconstruct downstream context, and surface every non-accepted decision. Harness-side proposal synthesis cannot satisfy a native smoke or C24 closed loop.

### Exhaustive coordinator command surface

`CommandAuthorizationMatrixV1` is exhaustive: omission means denied. `authority`/main-agent surfaces cover workspace create/read, run create/read/list/status, task create/update-before-freeze/cancel/resolve, dependency add/list, fork create/refresh/read, context materialize/bind/read, dispatch/cancel/reconcile, artifact publish/read, receipt inspect, proposal inspect/evaluate/approve/reject/release/rebase lineage, admission decision/history subscription, canonical/history reads, joins, policy/grant/quota administration, and run close. `worker` may read only its scoped task/pin/context, publish scoped artifacts/evidence, submit its bound receipt/proposal, and observe its decision. `adapter` may detect capabilities, fetch one bound manifest, invoke/resume/cancel/reconcile the provider, execute `WorkerReturnV1` with its attempt capability, and observe that proposal decision. `operator` retains lifecycle/ordinary-dispatch powers; daemon-internal reducers/outbox/replay use non-exportable internal capabilities.

Protocol and SDK freeze one versioned JSON-RPC method for every command/query above, typed cursor and idempotency inputs, stable results/errors, pagination/subscription resume tokens, and matching CLI or native coordinator commands. C14 includes a fresh-daemon black-box flow driven only through the shipped CLI: create workspace/run/DAG, fork, materialize, dispatch, inspect evidence/proposal, accept or reject, observe canonical/history/join/status, and continue. No direct database, test harness, or internal orchestrator call may complete that scenario.

### Bootstrap integration branch

The integration branch is exactly `main`. Before W00 sealing, the authorized bootstrap establishes local `HEAD` at `refs/heads/main`, configures/verifies the remote default branch and required protection when a remote exists, and records branch/ref evidence. The C00 gate validates the frozen branch contract; the live C01 checker rejects any branch other than `main`. C22 workflow trigger, OIDC workflow reference, KMS policy, Sigstore identity, release receipts, and protected environment all use this same ref.
## Claim commit identity closure

`ClaimAttemptV1`, `ClaimIndexRecordV1`, and the chunk ledger persist `preClaimBaseSha`, never the SHA of the commit containing those bytes. For K01 this value is A00. After integration, the live verifier obtains K01/B1 exclusively from integrated `HEAD`, requires it to be a commit with exactly one parent equal to `preClaimBaseSha`, verifies the claim and claim-index paths and canonical bytes in that exact tree, and proves checkpoint ancestry from W00 through A00 to K01. Ordinary receipts may then bind the externally observed K01/B1 as `claimIntegrationSha` and `workerBaseSha`; those receipts are later commits and are not self-referential. Renewals use the same construction from their immediate pre-claim HEAD.
