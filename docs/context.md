# Deterministic context reconstruction

C09 reconstructs an attempt's context from authenticated, durable authority state. The result is a byte-deterministic rendered artifact, a `ContextManifestCoreV1`, and the immutable `AttemptContextBindingV1` digest used by dispatch and receipts. Context reconstruction does not choose or refresh a fork, authorize a principal, mutate canonical state, or infer missing authority.

## Inputs and trust boundary

A reconstruction is scoped to one `workspaceId`, `runId`, `attemptId`, and generation. It consumes:

- an authenticated C08 `SealedForkPinV1` and its recorded authority identities;
- the exact source composite observation cursor and source context version held by that pin;
- the pinned canonical revision, state hash, canonicalizer/hash versions, dependency-join snapshot digest, delta-authority-scope digest, and pinned-policy digest;
- durable context-visible sources, each represented by immutable bytes and an authenticated digest;
- a separate current authorization observation cursor/context version and `AuthorizationOverlayV1` containing policy, grant, quota, and `allowed|denied` result; C09 verifies cursor/version equivalence and records these values, while the caller remains responsible for obtaining them from the authorization authority;
- attempt generation, provider idempotency key, and the permitted receipt producer principal/grant; C09 fixes the expected receipt schema version to `"1"`;
- `rendererVersion`, non-negative source priorities, a byte budget, and optional tokenizer metadata.

The trusted boundary ends at authenticated SQLite replay/snapshots and digest-verified artifact bytes. Caller-supplied hashes, cursors, epochs, authorization booleans, mutable projections, or plain objects do not establish authority. Missing, corrupt, substituted, cross-workspace, cross-run, or cursor-inconsistent authority fails closed. Token counts are metadata only; the byte budget is authoritative.

Source visibility and current authorization are deliberately separate. The source view is frozen by the ForkPin. Current policy, grant, revocation, and quota state is evaluated at the authorization observation cursor. Advancing current authority never silently changes what the pin can see.

## ForkPin visibility

The manifest's source view is exactly the authenticated ForkPin view:

- `forkPinDigest`, workspace, run, canonical revision/hash and algorithm versions must match the pin;
- `sourceObservationCursor` and `sourceContextVersion` must equal the pin's values;
- the context version must be `kind: "composite"`, and its embedded cursor and both epoch values must match that cursor;
- authenticated replay additionally requires `workspaceContextEpoch === workspaceSequence - 1` and `runContextEpoch === runSequence - 1`; a mismatch is treated as cursor substitution;
- dependency outcomes are visible only through the pin's immutable `dependencyJoinSnapshotDigest`;
- canonical paths are limited by the pin's `deltaAuthorityScopeDigest`;
- the pinned policy is the pin's exact `pinnedPolicyDigest`;
- receipts, evidence, decisions, summaries, and other run inputs are included only when their durable event/reference is visible at or before the pin's source observation cursor.

For every source, visibility is exactly `activationEpoch <= pin.sourceContextVersion.runContextEpoch`, with either no deactivation or `pin.sourceContextVersion.runContextEpoch < deactivationEpoch`, and `visibleAtRunSequence <= pin.sourceObservationCursor.runSequence`. A deactivation boundary is exclusive: the source is invisible at that epoch and later.

Later events are not visible merely because reconstruction occurs later. In particular, a receipt recorded after the pin is excluded. To expose newer canonical state, dependency outcomes, receipts, evidence, or policy, an authorized C08 refresh creates a new ForkPin version with authenticated parent lineage. Pins are immutable; refresh never edits the original. Reusing a pin requires exact equality with its recorded source and authorization snapshot identities and otherwise fails as stale.

## Deterministic selection and canonical bytes

Every selected source has a `SourceDescriptorV1` containing `kind`, content `digest`, `byteStart`, `byteEnd`, and `priority`. Reconstruction uses one total ordering: ascending numeric priority, then unsigned UTF-8 byte order of `kind`, `sourceId`, and digest. It never uses locale, filesystem enumeration order, object insertion accident, wall-clock time, random values, or tokenizer estimates to break ties.

String sources are NFC-normalized and then UTF-8 encoded. `Uint8Array` sources retain their exact bytes. C09 rendering is the direct concatenation of selected source bytes; `rendererVersion` records the caller-selected rendering contract but C09 adds no separator, header, or newline. Byte offsets are zero-based half-open ranges `[byteStart, byteEnd)` into that concatenation. Descriptors are emitted in rendered order. `selectedBytes` is the exact output byte length, must not exceed `byteBudget`, and every descriptor range must satisfy `0 <= byteStart <= byteEnd <= selectedBytes`.

When the next eligible source would exceed the remaining budget, C09 omits that whole source and records `budget:<sourceId>`. It does not truncate a source. Later, smaller sources remain eligible, so selection is the deterministic ordered whole-source fit produced by this single pass. The final omissions are unsigned UTF-8 sorted. `tokenizerMetadata` is recorded metadata and does not affect selection.

Source and rendered-output digests use `domainDigest("horseness.context-source-bytes.v1", base64(bytes))`. The output digest is stored as `renderedOutputDigest`. The manifest itself is serialized with `canonicalJson` (`jcs-v1`); object-key insertion order and host JSON formatting therefore do not affect its identity.

## Epoch invalidation

Workspace and run context epochs are independent and are bound in composite cursors and `ContextVersionV1`.

- Genesis initializes the corresponding epoch to `0`.
- A durable context-visible workspace transition increments the workspace epoch exactly once.
- A durable context-visible run transition increments the run epoch exactly once.
- An atomic command that changes both views increments each affected epoch once.
- Replay, process restart, snapshot rebuilding, reconciliation, cache loss, and reading the same durable head do not increment either epoch.

Active policy reference activation, replacement, deactivation to canonical `NoPolicyV1`, and fallback to `NoPolicyV1` are context-visible workspace transitions and invalidate prior current-authorization views by advancing the workspace epoch. Merely storing an immutable policy document does not advance an epoch until its reference becomes visible. Canonical acceptance, task/dependency/join changes, receipt/evidence visibility, fork publication, and context-manifest publication advance the run epoch when appended as context-visible run events.

Reconstruction binds the pre-append observation cursor/version. Publishing the manifest may produce a later result cursor/version, but that result is not inserted retroactively into the manifest or binding digest. This preserves acyclic event and object hashes.

## Manifest and binding digests

Digest construction is fixed by the C02 domain contract:

1. Build `ContextManifestCoreV1`. It contains no binding object or binding digest.
2. Compute

   `contextManifestCoreDigest = sha256("horseness.context-manifest-core.v1\0" || canonicalJson(core))`.
3. Build `AttemptContextBindingV1`, inserting that exact `contextManifestCoreDigest` and the attempt/generation, ForkPin, source view, authorization view, provider key, expected receipt version, and allowed producer identity.
4. Compute

   `attemptContextBindingDigest = sha256("horseness.attempt-context-binding.v1\0" || canonicalJson(binding))`.
5. Persist the convenience record `{ core, contextManifestCoreDigest, attemptContextBindingDigest }`.

`bindContext` is the authoritative equivalence boundary. It recomputes the manifest digest, constructs the binding, and requires equality of attempt ID, generation, ForkPin digest, source observation cursor, and source context version. The stored record, a fresh reconstruction, replay after restart, and the C02 context-binding vectors must produce identical canonical core bytes and both digests. The two digests are intentionally different. A mutation to any covered manifest field changes the manifest digest and consequently the binding digest; a binding-only mutation changes the binding digest without changing the manifest digest.

Receipts bind both digests. Digest equality alone is insufficient unless the ForkPin, authority views, producer identity, provider operation/idempotency data, and referenced artifacts also authenticate.

## Artifact publication and crash semantics

The reconstruction engine reads artifact-backed sources only through `ContextArtifactAuthorityV1.readDurableReferenced(digest, workspaceId)`. The authority must expose only workspace-owned, durably published and registered references. Staged, merely renamed-but-unregistered, unreferenced, cross-workspace, missing, or corrupt objects are not context inputs.

Publishing rendered bytes and other newly referenced context objects follows publish-before-reference ordering:

1. create bytes deterministically;
2. write a same-filesystem staging file;
3. hash and verify the bytes;
4. fsync the file and containing directory;
5. atomically rename to the content-addressed digest path;
6. reverify digest and size;
7. in one SQLite transaction append `ContextManifestPublishedV1` and add the artifact reference/pin.

An event or database reference must never commit before the complete artifact is published. A crash before rename may leave staging bytes, which recovery removes. A crash after rename but before the SQLite commit may leave an unreferenced complete object, which is safe and may later be reused or collected. A crash after the transaction leaves both the immutable object and authoritative reference. Retry is idempotent for identical bytes and command identity. Digest collision/substitution, mismatched size or media metadata, a missing referenced object, or corrupt bytes fails closed; reconstruction, dispatch, admission, and replay must not substitute or regenerate trusted bytes from metadata.

## Failure codes

The service preserves stable domain and authority error identities rather than translating failures into partial context:

| Code | Meaning |
|---|---|
| `INVALID_CONTEXT_MANIFEST` | Invalid generation, revision, byte accounting, budget, or manifest shape. |
| `INVALID_CONTEXT_BINDING` | Invalid generation/provider key or a binding cursor/context-version mismatch. |
| `CONTEXT_VERSION_MISMATCH` | The ForkPin source context version does not contain its exact source cursor. |
| `RECEIPT_MISMATCH` | Manifest and binding disagree on attempt, generation, pin, or source view. |
| `FORK_PIN_AUTHENTICATION_FAILED` | The sealed ForkPin digest or ID does not recompute. |
| `FORK_REUSE_STALE` | The requested active pin no longer exactly matches authenticated recorded authority. |
| `CONTEXT_AUTHORITY_UNAUTHENTICATED` | The snapshot was not issued by `authenticateContextSnapshot`. |
| `CONTEXT_AUTHORITY_CURSOR_SUBSTITUTED` | The pinned workspace/run event and envelope hashes are not present in authenticated replay. |
| `CONTEXT_AUTHORITY_CURSOR_STALE` | Authenticated authority is behind the pin or belongs to another workspace/run. |
| `CONTEXT_CANONICAL_STATE_SUBSTITUTED` | Canonical-state bytes do not hash to the pin's canonical state hash. |
| `CONTEXT_AUTHORIZATION_VERSION_SUBSTITUTED` | Current authorization version does not contain the supplied authorization cursor. |
| `CONTEXT_ARTIFACT_SUBSTITUTED` | Durable artifact bytes differ from the bytes declared by the source. |
| `CONTEXT_SOURCE_DIGEST_MISMATCH` | Source bytes do not reproduce the declared source digest. |
| `CONTEXT_BINDING_DIGEST_MISMATCH` | Independent domain digest construction and `bindContext` do not agree. |
| `INVALID_CONTEXT_REQUEST` | Generation or byte budget is not a non-negative safe integer as required. |
| `INVALID_CONTEXT_SOURCE` | Source identity, priority, activation interval, or byte range is invalid. |
| `UNSUPPORTED_SCHEMA_VERSION` | A persisted/input version is not supported. |

Storage integrity failures for unknown, missing, corrupt, or size-mismatched referenced artifacts also fail closed with the store's artifact-integrity error. Authorization denial, revoked grants, unavailable quota, and missing current policy remain authorization/fork-authority failures; reconstruction does not convert them to an empty manifest.

## Replay, restart, retry, and resume

The authoritative inputs are durable events, authenticated snapshots reproducible from those events, immutable ForkPins, and digest-verified artifacts. After restart, the service reconstructs the same source set at the same source and authorization cursors, applies the same ordering and byte budget, and recomputes byte-identical output, canonical manifest bytes, `contextManifestCoreDigest`, and `attemptContextBindingDigest`. Cached projections or rendered bytes may accelerate this path but cannot change or establish the result.

An exact retry of a failed materialization/publish command is idempotent. A new attempt generation receives a new immutable binding. It may explicitly reuse the old ForkPin, in which case newly recorded source inputs remain invisible, or use a separately authorized refreshed pin. Reconciliation, reattach, adoption, and native resume of an already handed-off provider operation retain the original generation, provider idempotency key, manifest digest, binding digest, and rendered bytes; they do not rematerialize against a newer epoch. If the host cannot resume that exact binding, it fails closed or uses a separately declared reduced capability mode. Changed context always requires a new generation and provider key.
