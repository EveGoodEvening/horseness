import { digestId, domainDigest, DomainError, type JsonValue } from "./canonical.js";
import type { EventEnvelopeV1 } from "./events.js";

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

export interface CanonicalDocument { runId: string; revision: number; document: JsonValue; stateHash: string; hashAlgorithmVersion: "sha256-v1"; canonicalizerVersion: "jcs-v1"; acceptedProposalId: string | null; lastCanonicalEventSequence: number }
export type CanonicalEvent = { eventType: "RunCreatedV1"; sequence: number; runId: string; initialDocument: JsonValue } | { eventType: "DeltaAcceptedV1"; sequence: number; proposalId: string; resultingDocument: JsonValue; priorStateHash: string; resultingStateHash: string };
export function reduceCanonicalDocument(state: CanonicalDocument | null, event: CanonicalEvent): CanonicalDocument {
  if (event.eventType === "RunCreatedV1") {
    if (state !== null || event.sequence !== 1) throw new DomainError("INVALID_GENESIS");
    return { runId: event.runId, revision: 0, document: event.initialDocument, stateHash: domainDigest("horseness.canonical-document.v1", event.initialDocument), hashAlgorithmVersion: "sha256-v1", canonicalizerVersion: "jcs-v1", acceptedProposalId: null, lastCanonicalEventSequence: event.sequence };
  }
  if (state === null || event.priorStateHash !== state.stateHash || event.resultingStateHash !== domainDigest("horseness.canonical-document.v1", event.resultingDocument)) throw new DomainError("STALE_BASE");
  return { ...state, revision: state.revision + 1, document: event.resultingDocument, stateHash: event.resultingStateHash, acceptedProposalId: event.proposalId, lastCanonicalEventSequence: event.sequence };
}
export interface RunOperationalState { eventCount: number; proposals: Record<string, string>; receipts: Record<string, string>; taskStates: Record<string, string>; contextEpoch: number }
export function reduceOperationalState(state: RunOperationalState, event: Pick<EventEnvelopeV1, "eventType" | "payload">): RunOperationalState {
  const next: RunOperationalState = { eventCount: state.eventCount + 1, proposals: { ...state.proposals }, receipts: { ...state.receipts }, taskStates: { ...state.taskStates }, contextEpoch: state.contextEpoch };
  const payload = event.payload as Record<string, JsonValue>;
  if (event.eventType === "ProposalSubmittedV1" && typeof payload.proposalId === "string") next.proposals[payload.proposalId] = "submitted";
  if (event.eventType === "AttemptReceiptRecordedV1" && typeof payload.receiptId === "string") next.receipts[payload.receiptId] = String(payload.outcome);
  if (event.eventType === "TaskResolvedV1" && typeof payload.taskId === "string") next.taskStates[payload.taskId] = String(payload.resolution);
  if (["DeltaAcceptedV1", "ProposalSubmittedV1", "AttemptReceiptRecordedV1", "TaskResolvedV1", "ForkCreatedV1", "ContextManifestPublishedV1", "PolicyReferenceChangedV1"].includes(event.eventType)) next.contextEpoch += 1;
  return next;
}
export function deterministicReplay(events: readonly EventEnvelopeV1[]): { canonical: CanonicalDocument; operational: RunOperationalState } {
  let canonical: CanonicalDocument | null = null;
  let operational: RunOperationalState = { eventCount: 0, proposals: {}, receipts: {}, taskStates: {}, contextEpoch: 0 };
  for (const envelope of events) {
    if (envelope.eventType === "RunCreatedV1") canonical = reduceCanonicalDocument(canonical, { eventType: "RunCreatedV1", sequence: envelope.sequence, runId: String((envelope.payload as Record<string, JsonValue>).runId), initialDocument: (envelope.payload as Record<string, JsonValue>).initialDocument as JsonValue });
    if (envelope.eventType === "DeltaAcceptedV1") {
      const payload = envelope.payload as Record<string, JsonValue>;
      canonical = reduceCanonicalDocument(canonical, { eventType: "DeltaAcceptedV1", sequence: envelope.sequence, proposalId: String(payload.proposalId), resultingDocument: payload.resultingDocument as JsonValue, priorStateHash: String(payload.priorStateHash), resultingStateHash: String(payload.resultingStateHash) });
    }
    operational = reduceOperationalState(operational, envelope);
  }
  if (canonical === null) throw new DomainError("INVALID_GENESIS");
  return { canonical, operational };
}
