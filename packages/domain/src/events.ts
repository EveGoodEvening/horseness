import { canonicalJson, domainDigest, type JsonValue } from "./canonical.js";

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

export interface WorkspaceCreatedV1 { eventType: "WorkspaceCreatedV1"; workspaceId: string; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string; }
export interface RunCreatedV1 { eventType: "RunCreatedV1"; workspaceId: string; runId: string; initialDocument: JsonValue; canonicalizerVersion: "jcs-v1"; hashVersion: "sha256-v1"; }

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

function eventError(code: string): never { throw new Error(code); }

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
