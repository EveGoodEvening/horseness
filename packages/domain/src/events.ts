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

export function verifyEventChain(events: readonly HashedEventEnvelopeV1<unknown>[]): void {
  let prior: string | null = null;
  let sequence = 1;
  for (const item of events) {
    if (item.envelope.sequence !== sequence || item.envelope.priorEnvelopeHash !== prior) throw new Error("EVENT_CHAIN_INVALID");
    if (domainDigest("horseness.event-payload.v1", item.envelope.payload) !== item.envelope.payloadHash || domainDigest("horseness.event-envelope.v1", item.envelope) !== item.envelopeHash) throw new Error("EVENT_HASH_INVALID");
    prior = item.envelopeHash;
    sequence += 1;
  }
}

export function eventCanonicalBytes(event: HashedEventEnvelopeV1): string { return canonicalJson(event as unknown as JsonValue); }
