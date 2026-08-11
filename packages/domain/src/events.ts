import { canonicalJson, domainDigest, DomainError, type JsonValue } from "./canonical.js";

export type Hash = string;
export interface AbsentWorkspaceGenesisCursorV1 { schemaVersion: "1"; kind: "absent-workspace-genesis"; workspaceId: string; expectedWorkspaceHead: "absent" }
export interface WorkspaceOnlyCursorV1 { schemaVersion: "1"; kind: "workspace-only"; workspaceId: string; workspaceSequence: number; workspaceEnvelopeHash: Hash; workspaceContextEpoch: number }
export interface AbsentRunGenesisCursorV1 extends Omit<WorkspaceOnlyCursorV1, "kind"> { kind: "absent-run-genesis"; runId: string; expectedRunHead: "absent" }
export interface RunOnlyCursorV1 { schemaVersion: "1"; kind: "run-only"; workspaceId: string; runId: string; runSequence: number; runEnvelopeHash: Hash; runContextEpoch: number }
export interface CompositeCursorV1 extends Omit<WorkspaceOnlyCursorV1, "kind"> { kind: "composite"; runId: string; runSequence: number; runEnvelopeHash: Hash; runContextEpoch: number }
export type ObservationCursorV1 = AbsentWorkspaceGenesisCursorV1 | WorkspaceOnlyCursorV1 | AbsentRunGenesisCursorV1 | RunOnlyCursorV1 | CompositeCursorV1;
export type ResultCursorV1 = WorkspaceOnlyCursorV1 | RunOnlyCursorV1 | CompositeCursorV1;
export type ContextVersionV1 =
  | { schemaVersion: "1"; kind: "workspace-only"; workspaceContextEpoch: number; observationCursor: WorkspaceOnlyCursorV1 }
  | { schemaVersion: "1"; kind: "run-only"; runContextEpoch: number; observationCursor: RunOnlyCursorV1 }
  | { schemaVersion: "1"; kind: "composite"; workspaceContextEpoch: number; runContextEpoch: number; observationCursor: CompositeCursorV1 };

export interface EvaluationClockV1 { schemaVersion: "1"; authorityTime: string; observationCursor: ObservationCursorV1 }
export interface CreateWorkspaceCommandV1 { schemaVersion: "1"; commandType: "CreateWorkspaceV1"; commandId: string; observationCursor: AbsentWorkspaceGenesisCursorV1; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string }
export interface ChangePolicyReferenceCommandV1 { schemaVersion: "1"; commandType: "ChangePolicyReferenceV1"; commandId: string; observationCursor: WorkspaceOnlyCursorV1; principalId: string; activePolicyDigest: string }
export type WorkspaceCommandV1 = CreateWorkspaceCommandV1 | ChangePolicyReferenceCommandV1;
export interface CreateRunCommandV1 { schemaVersion: "1"; commandType: "CreateRunV1"; commandId: string; observationCursor: AbsentRunGenesisCursorV1; principalId: string; initialDocument: JsonValue }
export interface SubmitProposalCommandV1 { schemaVersion: "1"; commandType: "SubmitProposalV1"; commandId: string; observationCursor: CompositeCursorV1; principalId: string; proposalId: string; proposalDigest: string }
export interface RecordAttemptReceiptCommandV1 { schemaVersion: "1"; commandType: "RecordAttemptReceiptV1"; commandId: string; observationCursor: CompositeCursorV1; principalId: string; receiptId: string; receiptDigest: string; outcome: "succeeded" | "failed" | "cancelled" }
export interface AcceptDeltaCommandV1 { schemaVersion: "1"; commandType: "AcceptDeltaV1"; commandId: string; observationCursor: CompositeCursorV1; principalId: string; proposalId: string; proposalDigest: string; priorStateHash: string; resultingStateHash: string; resultingDocument: JsonValue }
export interface ResolveTaskCommandV1 { schemaVersion: "1"; commandType: "ResolveTaskV1"; commandId: string; observationCursor: CompositeCursorV1; principalId: string; taskId: string; resolution: "succeeded" | "failed" | "cancelled"; evaluationClock: EvaluationClockV1 }
export type RunCommandV1 = CreateRunCommandV1 | SubmitProposalCommandV1 | RecordAttemptReceiptCommandV1 | AcceptDeltaCommandV1 | ResolveTaskCommandV1;
export type DomainCommandV1 = WorkspaceCommandV1 | RunCommandV1;
export interface GetWorkspaceQueryV1 { schemaVersion: "1"; queryType: "GetWorkspaceV1"; observationCursor: WorkspaceOnlyCursorV1 }
export interface GetRunQueryV1 { schemaVersion: "1"; queryType: "GetRunV1"; observationCursor: CompositeCursorV1 }
export interface ListRunEventsQueryV1 { schemaVersion: "1"; queryType: "ListRunEventsV1"; afterObservationCursor: RunOnlyCursorV1 | CompositeCursorV1; limit: number }
export type WorkspaceQueryV1 = GetWorkspaceQueryV1;
export type RunQueryV1 = GetRunQueryV1 | ListRunEventsQueryV1;
export type DomainQueryV1 = WorkspaceQueryV1 | RunQueryV1;
export interface WorkspaceCommandResultV1 { schemaVersion: "1"; resultType: "WorkspaceCommandResultV1"; commandId: string; resultCursor: WorkspaceOnlyCursorV1; resultContextVersion: ContextVersionV1 }
export interface RunCommandResultV1 { schemaVersion: "1"; resultType: "RunCommandResultV1"; commandId: string; resultCursor: RunOnlyCursorV1 | CompositeCursorV1; resultContextVersion: ContextVersionV1 }
export interface DualStreamCommandResultV1 { schemaVersion: "1"; resultType: "DualStreamCommandResultV1"; commandId: string; resultCursor: CompositeCursorV1; resultContextVersion: ContextVersionV1 }
export type DomainCommandResultV1 = WorkspaceCommandResultV1 | RunCommandResultV1 | DualStreamCommandResultV1;
export interface WorkspaceQueryResultV1 { schemaVersion: "1"; resultType: "WorkspaceQueryResultV1"; observationCursor: WorkspaceOnlyCursorV1; state: JsonValue }
export interface RunQueryResultV1 { schemaVersion: "1"; resultType: "RunQueryResultV1"; observationCursor: RunOnlyCursorV1 | CompositeCursorV1; state: JsonValue }
export type QueryResultV1 = WorkspaceQueryResultV1 | RunQueryResultV1;
export interface WorkspaceCreatedV1 { eventType: "WorkspaceCreatedV1"; workspaceId: string; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string }
export interface PolicyReferenceChangedV1 { eventType: "PolicyReferenceChangedV1"; workspaceId: string; activePolicyDigest: string }
export interface RunCreatedV1 { eventType: "RunCreatedV1"; workspaceId: string; runId: string; initialDocument: JsonValue; canonicalizerVersion: "jcs-v1"; hashVersion: "sha256-v1" }
export interface ProposalSubmittedV1 { eventType: "ProposalSubmittedV1"; workspaceId: string; runId: string; proposalId: string; proposalDigest: string }
export interface AttemptReceiptRecordedV1 { eventType: "AttemptReceiptRecordedV1"; workspaceId: string; runId: string; receiptId: string; receiptDigest: string; outcome: "succeeded" | "failed" | "cancelled" }
export interface DeltaAcceptedV1 { eventType: "DeltaAcceptedV1"; workspaceId: string; runId: string; proposalId: string; proposalDigest: string; priorStateHash: string; resultingStateHash: string; resultingDocument: JsonValue }
export interface TaskResolvedEventV1 { eventType: "TaskResolvedV1"; workspaceId: string; runId: string; taskId: string; resolution: "succeeded" | "failed" | "cancelled"; evaluationClock: EvaluationClockV1 }
export interface ForkCreatedEventV1 { eventType: "ForkCreatedV1"; workspaceId: string; runId: string; forkPinDigest: string }
export interface ContextManifestPublishedEventV1 { eventType: "ContextManifestPublishedV1"; workspaceId: string; runId: string; contextManifestCoreDigest: string }
export type WorkspaceEventPayloadV1 = WorkspaceCreatedV1 | PolicyReferenceChangedV1;
export type RunEventPayloadV1 = RunCreatedV1 | ProposalSubmittedV1 | AttemptReceiptRecordedV1 | DeltaAcceptedV1 | TaskResolvedEventV1 | ForkCreatedEventV1 | ContextManifestPublishedEventV1;
export type DomainEventPayloadV1 = WorkspaceEventPayloadV1 | RunEventPayloadV1;
export interface StreamAppendV1<T extends DomainEventPayloadV1 = DomainEventPayloadV1> { streamKind: "workspace" | "run"; expectedSequence: number; expectedEnvelopeHash: Hash | null; events: readonly HashedEventEnvelopeV1<T>[] }
export type AtomicAppendContractV1 = { schemaVersion: "1"; appendKind: "single-stream"; observationCursor: ObservationCursorV1; append: StreamAppendV1 } | { schemaVersion: "1"; appendKind: "dual-stream"; observationCursor: CompositeCursorV1; workspaceAppend: StreamAppendV1<WorkspaceEventPayloadV1>; runAppend: StreamAppendV1<RunEventPayloadV1> };
export function assertAtomicAppendContract(contract: AtomicAppendContractV1): void {
  if (contract.schemaVersion !== "1") throw new DomainError("ATOMIC_APPEND_VERSION_UNSUPPORTED");
  const validate = (append: StreamAppendV1): void => { if (!Number.isSafeInteger(append.expectedSequence) || append.expectedSequence < 0 || append.events.some((item, index) => item.envelope.streamKind !== append.streamKind || item.envelope.sequence !== append.expectedSequence + index + 1)) throw new DomainError("ATOMIC_APPEND_INVALID"); };
  switch (contract.appendKind) { case "single-stream": validate(contract.append); return; case "dual-stream": if (contract.workspaceAppend.streamKind !== "workspace" || contract.runAppend.streamKind !== "run") throw new DomainError("ATOMIC_APPEND_INVALID"); validate(contract.workspaceAppend); validate(contract.runAppend); return; default: throw new DomainError("ATOMIC_APPEND_KIND_UNSUPPORTED"); }
}

export interface EventEnvelopeV1<T = JsonValue> {
  schemaVersion: "1";
  streamKind: "workspace" | "run";
  workspaceId: string;
  streamId: string;
  sequence: number;
  eventId: string;
  eventType: string;
  principalId: string;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  priorEnvelopeHash: Hash | null;
  payloadHash: Hash;
  payload: T;
}
export interface HashedEventEnvelopeV1<T = JsonValue> { envelope: EventEnvelopeV1<T>; envelopeHash: Hash }

export function sealEventEnvelope<T>(envelope: Omit<EventEnvelopeV1<T>, "payloadHash">): HashedEventEnvelopeV1<T> {
  const full: EventEnvelopeV1<T> = { ...envelope, payloadHash: domainDigest("horseness.event-payload.v1", envelope.payload) };
  return { envelope: full, envelopeHash: domainDigest("horseness.event-envelope.v1", full as unknown as JsonValue) };
}


export function createWorkspaceGenesis(input: { workspaceId: string; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string; commandId: string }): { event: HashedEventEnvelopeV1<WorkspaceCreatedV1>; resultCursor: WorkspaceOnlyCursorV1 } {
  const payload: WorkspaceCreatedV1 = { eventType: "WorkspaceCreatedV1", workspaceId: input.workspaceId, authorityPrincipalId: input.authorityPrincipalId, initialGrantDigest: input.initialGrantDigest, authorityConsumptionMarker: input.authorityConsumptionMarker, activePolicyDigest: input.activePolicyDigest };
  const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "workspace", workspaceId: input.workspaceId, streamId: input.workspaceId, sequence: 1, eventId: `${input.commandId}:1`, eventType: payload.eventType, principalId: input.authorityPrincipalId, causationId: input.commandId, correlationId: input.commandId, idempotencyKey: input.commandId, priorEnvelopeHash: null, payload });
  return { event, resultCursor: { schemaVersion: "1", kind: "workspace-only", workspaceId: input.workspaceId, workspaceSequence: 1, workspaceEnvelopeHash: event.envelopeHash, workspaceContextEpoch: 0 } };
}

export function createRunGenesis(input: { observationCursor: AbsentRunGenesisCursorV1; initialDocument: JsonValue; principalId: string; commandId: string }): { event: HashedEventEnvelopeV1<RunCreatedV1>; resultCursor: CompositeCursorV1 } {
  const cursor = input.observationCursor;
  const payload: RunCreatedV1 = { eventType: "RunCreatedV1", workspaceId: cursor.workspaceId, runId: cursor.runId, initialDocument: input.initialDocument, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1" };
  const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "run", workspaceId: cursor.workspaceId, streamId: cursor.runId, sequence: 1, eventId: `${input.commandId}:1`, eventType: payload.eventType, principalId: input.principalId, causationId: input.commandId, correlationId: input.commandId, idempotencyKey: input.commandId, priorEnvelopeHash: null, payload });
  return { event, resultCursor: { schemaVersion: "1", kind: "composite", workspaceId: cursor.workspaceId, workspaceSequence: cursor.workspaceSequence, workspaceEnvelopeHash: cursor.workspaceEnvelopeHash, workspaceContextEpoch: cursor.workspaceContextEpoch, runId: cursor.runId, runSequence: 1, runEnvelopeHash: event.envelopeHash, runContextEpoch: 0 } };
}

function eventError(code: string): never { throw new DomainError(code); }

function assertNonEmpty(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) eventError(code);
}

export function verifyEventChain(events: readonly HashedEventEnvelopeV1<unknown>[]): void {
  if (events.length === 0) eventError("EVENT_CHAIN_EMPTY");
  const first = events[0];
  if (first === undefined) eventError("EVENT_CHAIN_EMPTY");
  const streamKind = first.envelope.streamKind;
  const workspaceId = first.envelope.workspaceId;
  const streamId = first.envelope.streamId;
  if (streamKind !== "workspace" && streamKind !== "run") eventError("EVENT_VERSION_UNSUPPORTED");
  if (first.envelope.schemaVersion !== "1") eventError("EVENT_VERSION_UNSUPPORTED");
  if (streamKind === "workspace" && streamId !== workspaceId) eventError("EVENT_IDENTITY_INVALID");
  let prior: string | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const item = events[index];
    if (item === undefined) eventError("EVENT_CHAIN_INVALID");
    const envelope = item.envelope;
    if (envelope.schemaVersion !== "1") eventError("EVENT_VERSION_UNSUPPORTED");
    if (envelope.streamKind !== streamKind || envelope.workspaceId !== workspaceId || envelope.streamId !== streamId) eventError("EVENT_IDENTITY_INVALID");
    if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence !== index + 1 || envelope.priorEnvelopeHash !== prior) eventError("EVENT_CHAIN_INVALID");
    assertNonEmpty(envelope.eventId, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.eventType, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.principalId, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.causationId, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.correlationId, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.idempotencyKey, "EVENT_ENVELOPE_INVALID");
    if (domainDigest("horseness.event-payload.v1", envelope.payload) !== envelope.payloadHash) eventError("EVENT_PAYLOAD_HASH_INVALID");
    if (domainDigest("horseness.event-envelope.v1", envelope as unknown as JsonValue) !== item.envelopeHash) eventError("EVENT_ENVELOPE_HASH_INVALID");
    const payload = envelope.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload) || !("eventType" in payload) || payload.eventType !== envelope.eventType) eventError("EVENT_PAYLOAD_INVALID");
    prior = item.envelopeHash;
  }
  const genesisType = streamKind === "workspace" ? "WorkspaceCreatedV1" : "RunCreatedV1";
  if (first.envelope.eventType !== genesisType || first.envelope.priorEnvelopeHash !== null || first.envelope.sequence !== 1) eventError("INVALID_GENESIS");
}

export function eventCanonicalBytes(event: HashedEventEnvelopeV1): string { return canonicalJson(event as unknown as JsonValue); }
