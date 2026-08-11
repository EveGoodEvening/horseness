# Protocol Contract

## Boundary

`@horseness/protocol` is the versioned JSON-RPC 2.0 and adapter-SPI boundary over `@horseness/domain`. Domain entities, cursors, proposal envelopes, receipts, canonical JSON, and digests are imported and validated by domain code; the protocol does not redefine their semantics.

## Version and framing

Every exported method ends in `.v1`, every params object carries `protocolVersion: "1"`, and every request has exactly `jsonrpc`, `id`, `method`, and `params`. Unknown methods, versions, fields, cursor variants, and role/method combinations fail closed before dispatch. Notifications are not part of v1; an ID is always required.

Command methods require a non-empty idempotency key. Query and subscription methods forbid one. Commands carry an `observationCursor`; successful mutation results carry the distinct post-transaction `resultCursor`. Pagination uses `afterObservationCursor` and emits ordered result cursors. Subscription resumption binds a subscription identity, after-observation cursor, and opaque resume token.

## Authorization

`METHOD_REGISTRY_V1` is the exhaustive `CommandAuthorizationMatrixV1`. Omission means deny. Transport-authenticated identity supplies the role; actor or role fields in request bodies have no authority. Scope checks in later layers must additionally bind workspace, run, task, attempt, proposal, grant, and capability identities.

The registry covers workspace; run; task and DAG dependency; fork; context; dispatch; artifact; receipt; proposal and admission; canonical and event history; join; policy, grant, and quota administration; run closure; and adapter capability/launch/cancel/reconcile/resume/reattach/context/receipt/native-package/install/doctor/worker-return surfaces.

## Stable results and errors

Success is `{jsonrpc:"2.0",id,result:{schemaVersion:"1",method,resultCursor,data,...}}`. Error is `{jsonrpc:"2.0",id,error:{code,message,data:{schemaVersion:"1",reasonCode,retryable,details}}}`. JSON-RPC standard codes are retained for parse/request/method/params/internal failures; stable Horseness codes occupy `-32001` through `-32008`.

## Local transport security

V1 permits inherited stdio, owner-only Unix sockets (`0600` endpoint in an owner-only directory), and non-inheriting owner-DACL Windows named pipes. Metadata always records authenticated principal, role, workspace, grant digest, and OS identity. `localOnly` must be true and `tcpEnabled` must be false. TCP has no v1 encoding.

## Adapter SPI

The SPI exposes capability detection; launch, cancel, reconcile, resume and reattach; context injection; receipt collection; native package metadata; declarative install contributions; doctor probes; and credentialed `WorkerReturnV1`. Every provider operation is bound to workspace/run/task/attempt/generation, ForkPin, context manifest, attempt binding, provider idempotency digest, and attempt capability. An adapter cannot evaluate admission or alter a sealed domain proposal.

## Generated artifacts and conformance

`packages/protocol/generated/json-rpc-v1.schema.json` and `protocol-manifest-v1.json` are canonical JSON generated from the runtime registry. `generated:check` compares exact bytes. `protocol:conformance` executes `docs/vectors/protocol/conformance-v1.json`, including authorization denial, unknown-version denial, composite pagination, and subscription resume.
