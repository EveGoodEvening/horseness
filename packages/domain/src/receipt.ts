import { deepClone, digestId, domainDigest, DomainError, type JsonValue } from "./canonical.js";
import { verifyEventChain, type EventEnvelopeV1, type HashedEventEnvelopeV1 } from "./events.js";

export interface ReceiptEvidenceV1 { digest: string; mediaType: string; size: number }
export interface AttemptReceiptCoreV1 { schemaVersion: "1"; workspaceId: string; runId: string; taskId: string; attemptId: string; generation: number; attemptContextBindingDigest: string; contextManifestCoreDigest: string; forkPinDigest: string; providerId: string; providerOperationId: string; providerIdempotencyKeyDigest: string; producerPrincipalId: string; producerGrantDigest: string; adapterId: string; adapterVersion: string; hostId: string; hostVersion: string; outcome: "succeeded" | "failed" | "cancelled"; startedAt: string; finishedAt: string; outputDigest: string | null; evidence: ReceiptEvidenceV1[]; provenance: JsonValue; nonce: string }
export interface AttemptReceiptEnvelopeV1 extends AttemptReceiptCoreV1 { receiptId: string; receiptDigest: string }
export function sealAttemptReceipt(core: AttemptReceiptCoreV1): AttemptReceiptEnvelopeV1 {
  const normalized: AttemptReceiptCoreV1 = { ...core, evidence: [...core.evidence].sort((a, b) => a.digest.localeCompare(b.digest)) };
  if (new Set(normalized.evidence.map((item) => item.digest)).size !== normalized.evidence.length || normalized.finishedAt < normalized.startedAt) throw new DomainError("INVALID_ENVELOPE");
  const receiptDigest = domainDigest("horseness.attempt-receipt.v1", normalized);
  return { ...normalized, receiptId: digestId("rcp_", receiptDigest), receiptDigest };
}
export function verifyAttemptReceipt(receipt: AttemptReceiptEnvelopeV1): void {
  const { receiptId: _receiptId, receiptDigest: _receiptDigest, ...core } = receipt;
  const expected = sealAttemptReceipt(core);
  if (expected.receiptDigest !== receipt.receiptDigest || expected.receiptId !== receipt.receiptId) throw new DomainError("RECEIPT_MISMATCH");
}

export interface CanonicalDocument { workspaceId: string; runId: string; revision: number; document: JsonValue; stateHash: string; hashAlgorithmVersion: "sha256-v1"; canonicalizerVersion: "jcs-v1"; acceptedProposalId: string | null; lastCanonicalEventSequence: number }
export type CanonicalEvent =
  | { eventType: "RunCreatedV1"; sequence: number; workspaceId?: string; runId: string; initialDocument: JsonValue }
  | { eventType: "DeltaAcceptedV1"; sequence: number; workspaceId?: string; runId?: string; proposalId: string; resultingDocument: JsonValue; priorStateHash: string; resultingStateHash: string };
export function reduceCanonicalDocument(state: CanonicalDocument | null, event: CanonicalEvent): CanonicalDocument {
  switch (event.eventType) {
    case "RunCreatedV1": {
      if (state !== null || event.sequence !== 1) throw new DomainError("INVALID_GENESIS");
      const workspaceId = event.workspaceId ?? "";
      const document = deepClone(event.initialDocument);
      return { workspaceId, runId: event.runId, revision: 0, document, stateHash: domainDigest("horseness.canonical-document.v1", document), hashAlgorithmVersion: "sha256-v1", canonicalizerVersion: "jcs-v1", acceptedProposalId: null, lastCanonicalEventSequence: 1 };
    }
    case "DeltaAcceptedV1": {
      if (state === null || event.sequence <= state.lastCanonicalEventSequence) throw new DomainError("EVENT_SEQUENCE_INVALID");
      if ((event.workspaceId !== undefined && event.workspaceId !== state.workspaceId) || (event.runId !== undefined && event.runId !== state.runId)) throw new DomainError("AGGREGATE_IDENTITY_MISMATCH");
      if (event.priorStateHash !== state.stateHash || event.resultingStateHash !== domainDigest("horseness.canonical-document.v1", event.resultingDocument)) throw new DomainError("STALE_BASE");
      const document = deepClone(event.resultingDocument);
      return { ...state, revision: state.revision + 1, document, stateHash: event.resultingStateHash, acceptedProposalId: event.proposalId, lastCanonicalEventSequence: event.sequence };
    }
  }
}

export interface WorkspaceState { workspaceId: string; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string; contextEpoch: number; lastEventSequence: number }
export type WorkspaceOperationalEvent =
  | { eventType: "WorkspaceCreatedV1"; sequence: number; workspaceId: string; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string }
  | { eventType: "PolicyReferenceChangedV1"; sequence: number; workspaceId: string; activePolicyDigest: string };
export function reduceWorkspaceState(state: WorkspaceState | null, event: WorkspaceOperationalEvent): WorkspaceState {
  switch (event.eventType) {
    case "WorkspaceCreatedV1":
      if (state !== null || event.sequence !== 1) throw new DomainError("INVALID_GENESIS");
      return { workspaceId: event.workspaceId, authorityPrincipalId: event.authorityPrincipalId, initialGrantDigest: event.initialGrantDigest, authorityConsumptionMarker: event.authorityConsumptionMarker, activePolicyDigest: event.activePolicyDigest, contextEpoch: 0, lastEventSequence: 1 };
    case "PolicyReferenceChangedV1":
      if (state === null) throw new DomainError("INVALID_GENESIS");
      if (event.workspaceId !== state.workspaceId) throw new DomainError("AGGREGATE_IDENTITY_MISMATCH");
      if (event.sequence <= state.lastEventSequence) throw new DomainError("EVENT_SEQUENCE_INVALID");
      return { ...state, activePolicyDigest: event.activePolicyDigest, contextEpoch: state.contextEpoch + 1, lastEventSequence: event.sequence };
  }
}

export interface RunOperationalState { workspaceId: string; runId: string; eventCount: number; proposals: Readonly<Record<string, string>>; receipts: Readonly<Record<string, string>>; taskStates: Readonly<Record<string, string>>; contextEpoch: number; lastEventSequence: number }
export type RunOperationalEvent =
  | { eventType: "RunCreatedV1"; sequence: number; workspaceId: string; runId: string }
  | { eventType: "ProposalSubmittedV1"; sequence: number; workspaceId: string; runId: string; proposalId: string }
  | { eventType: "DeltaAcceptedV1"; sequence: number; workspaceId: string; runId: string; proposalId: string }
  | { eventType: "AttemptReceiptRecordedV1"; sequence: number; workspaceId: string; runId: string; receiptId: string; outcome: string }
  | { eventType: "TaskResolvedV1"; sequence: number; workspaceId: string; runId: string; taskId: string; resolution: string }
  | { eventType: "ForkCreatedV1" | "ContextManifestPublishedV1"; sequence: number; workspaceId: string; runId: string };
export function reduceOperationalState(state: RunOperationalState | null, event: RunOperationalEvent): RunOperationalState {
  if (event.eventType === "RunCreatedV1") {
    if (state !== null || event.sequence !== 1) throw new DomainError("INVALID_GENESIS");
    return { workspaceId: event.workspaceId, runId: event.runId, eventCount: 1, proposals: {}, receipts: {}, taskStates: {}, contextEpoch: 0, lastEventSequence: 1 };
  }
  if (state === null) throw new DomainError("INVALID_GENESIS");
  if (event.workspaceId !== state.workspaceId || event.runId !== state.runId) throw new DomainError("AGGREGATE_IDENTITY_MISMATCH");
  if (event.sequence <= state.lastEventSequence) throw new DomainError("EVENT_SEQUENCE_INVALID");
  const next: RunOperationalState = { ...state, eventCount: state.eventCount + 1, proposals: { ...state.proposals }, receipts: { ...state.receipts }, taskStates: { ...state.taskStates }, contextEpoch: state.contextEpoch + 1, lastEventSequence: event.sequence };
  switch (event.eventType) {
    case "ProposalSubmittedV1": return { ...next, proposals: { ...next.proposals, [event.proposalId]: "submitted" } };
    case "DeltaAcceptedV1": return { ...next, proposals: { ...next.proposals, [event.proposalId]: "accepted" } };
    case "AttemptReceiptRecordedV1": return { ...next, receipts: { ...next.receipts, [event.receiptId]: event.outcome } };
    case "TaskResolvedV1": return { ...next, taskStates: { ...next.taskStates, [event.taskId]: event.resolution } };
    case "ForkCreatedV1": case "ContextManifestPublishedV1": return next;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new DomainError("MALFORMED_EVENT");
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== "string" || value.length === 0) throw new DomainError("MALFORMED_EVENT"); return value; }
function json(value: unknown): JsonValue { domainDigest("horseness.replay-json-validation.v1", value as JsonValue); return value as JsonValue; }

export function deterministicReplay(events: readonly HashedEventEnvelopeV1<unknown>[]): { canonical: CanonicalDocument; operational: RunOperationalState } {
  verifyEventChain(events);
  const first = events[0];
  if (first === undefined || first.envelope.streamKind !== "run") throw new DomainError("INVALID_GENESIS");
  let canonical: CanonicalDocument | null = null;
  let operational: RunOperationalState | null = null;
  for (const item of events) {
    const envelope: EventEnvelopeV1<unknown> = item.envelope;
    const payload = record(envelope.payload);
    const common = { sequence: envelope.sequence, workspaceId: envelope.workspaceId, runId: envelope.streamId };
    switch (envelope.eventType) {
      case "RunCreatedV1": {
        if (text(payload.workspaceId) !== envelope.workspaceId || text(payload.runId) !== envelope.streamId || payload.canonicalizerVersion !== "jcs-v1" || payload.hashVersion !== "sha256-v1") throw new DomainError("MALFORMED_EVENT");
        const initialDocument = json(payload.initialDocument);
        canonical = reduceCanonicalDocument(canonical, { eventType: "RunCreatedV1", ...common, initialDocument });
        operational = reduceOperationalState(operational, { eventType: "RunCreatedV1", ...common });
        break;
      }
      case "ProposalSubmittedV1": operational = reduceOperationalState(operational, { eventType: "ProposalSubmittedV1", ...common, proposalId: text(payload.proposalId) }); break;
      case "DeltaAcceptedV1": {
        const proposalId = text(payload.proposalId);
        canonical = reduceCanonicalDocument(canonical, { eventType: "DeltaAcceptedV1", ...common, proposalId, priorStateHash: text(payload.priorStateHash), resultingStateHash: text(payload.resultingStateHash), resultingDocument: json(payload.resultingDocument) });
        operational = reduceOperationalState(operational, { eventType: "DeltaAcceptedV1", ...common, proposalId });
        break;
      }
      case "AttemptReceiptRecordedV1": operational = reduceOperationalState(operational, { eventType: "AttemptReceiptRecordedV1", ...common, receiptId: text(payload.receiptId), outcome: text(payload.outcome) }); break;
      case "TaskResolvedV1": operational = reduceOperationalState(operational, { eventType: "TaskResolvedV1", ...common, taskId: text(payload.taskId), resolution: text(payload.resolution) }); break;
      case "ForkCreatedV1": operational = reduceOperationalState(operational, { eventType: "ForkCreatedV1", ...common }); break;
      case "ContextManifestPublishedV1": operational = reduceOperationalState(operational, { eventType: "ContextManifestPublishedV1", ...common }); break;
      default: throw new DomainError("UNSUPPORTED_EVENT_TYPE");
    }
  }
  if (canonical === null || operational === null) throw new DomainError("INVALID_GENESIS");
  return { canonical, operational };
}
