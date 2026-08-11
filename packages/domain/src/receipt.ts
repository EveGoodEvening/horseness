import { assertJsonValue, deepClone, digestId, domainDigest, DomainError, type JsonValue } from "./canonical.js";
import { verifyEventChain, type EventEnvelopeV1, type HashedEventEnvelopeV1 } from "./events.js";

export interface ReceiptEvidenceV1 { digest: string; mediaType: string; size: number }
export interface AttemptReceiptCoreV1 { schemaVersion: "1"; workspaceId: string; runId: string; taskId: string; attemptId: string; generation: number; attemptContextBindingDigest: string; contextManifestCoreDigest: string; forkPinDigest: string; providerId: string; providerOperationId: string; providerIdempotencyKeyDigest: string; producerPrincipalId: string; producerGrantDigest: string; adapterId: string; adapterVersion: string; hostId: string; hostVersion: string; outcome: "succeeded" | "failed" | "cancelled"; startedAt: string; finishedAt: string; outputDigest: string | null; evidence: readonly ReceiptEvidenceV1[]; provenance: JsonValue; nonce: string }
export interface AttemptReceiptEnvelopeV1 extends AttemptReceiptCoreV1 { receiptId: string; receiptDigest: string }
const RECEIPT_KEYS = ["schemaVersion", "workspaceId", "runId", "taskId", "attemptId", "generation", "attemptContextBindingDigest", "contextManifestCoreDigest", "forkPinDigest", "providerId", "providerOperationId", "providerIdempotencyKeyDigest", "producerPrincipalId", "producerGrantDigest", "adapterId", "adapterVersion", "hostId", "hostVersion", "outcome", "startedAt", "finishedAt", "outputDigest", "evidence", "provenance", "nonce"] as const;
function exactReceiptRecord(value: unknown, keys: readonly string[]): Record<string, unknown> { if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new DomainError("INVALID_ENVELOPE"); const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new DomainError("INVALID_ENVELOPE"); return value as Record<string, unknown>; }
function receiptText(value: unknown): asserts value is string { if (typeof value !== "string" || value.length === 0) throw new DomainError("INVALID_ENVELOPE"); }
function canonicalTimestamp(value: unknown): asserts value is string { receiptText(value); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new DomainError("INVALID_ENVELOPE"); const time = Date.parse(value); if (!Number.isFinite(time)) throw new DomainError("INVALID_ENVELOPE"); const iso = new Date(time).toISOString(); if (value !== iso && value !== iso.replace(".000Z", "Z")) throw new DomainError("INVALID_ENVELOPE"); }
function validateAttemptReceiptCore(value: unknown): asserts value is AttemptReceiptCoreV1 {
  const core = exactReceiptRecord(value, RECEIPT_KEYS);
  if (core.schemaVersion !== "1") throw new DomainError("UNSUPPORTED_SCHEMA_VERSION");
  for (const key of ["workspaceId", "runId", "taskId", "attemptId", "attemptContextBindingDigest", "contextManifestCoreDigest", "forkPinDigest", "providerId", "providerOperationId", "providerIdempotencyKeyDigest", "producerPrincipalId", "producerGrantDigest", "adapterId", "adapterVersion", "hostId", "hostVersion", "nonce"] as const) receiptText(core[key]);
  if (!Number.isSafeInteger(core.generation) || (core.generation as number) < 1) throw new DomainError("INVALID_ENVELOPE");
  if (core.outcome !== "succeeded" && core.outcome !== "failed" && core.outcome !== "cancelled") throw new DomainError("INVALID_ENVELOPE");
  canonicalTimestamp(core.startedAt); canonicalTimestamp(core.finishedAt); if (core.finishedAt < core.startedAt) throw new DomainError("INVALID_ENVELOPE");
  if (core.outcome === "succeeded") receiptText(core.outputDigest); else if (core.outputDigest !== null) throw new DomainError("INVALID_ENVELOPE");
  if (!Array.isArray(core.evidence)) throw new DomainError("INVALID_ENVELOPE"); const seen = new Set<string>();
  for (const evidenceValue of core.evidence) { const evidence = exactReceiptRecord(evidenceValue, ["digest", "mediaType", "size"]); receiptText(evidence.digest); receiptText(evidence.mediaType); if (!Number.isSafeInteger(evidence.size) || (evidence.size as number) < 0 || seen.has(evidence.digest)) throw new DomainError("INVALID_ENVELOPE"); seen.add(evidence.digest); }
  assertJsonValue(core.provenance); if (typeof core.provenance !== "object" || core.provenance === null || Array.isArray(core.provenance)) throw new DomainError("INVALID_ENVELOPE");
}
export function sealAttemptReceipt(core: AttemptReceiptCoreV1): AttemptReceiptEnvelopeV1 {
  validateAttemptReceiptCore(core);
  const normalized: AttemptReceiptCoreV1 = { ...core, evidence: [...core.evidence].sort((a, b) => a.digest.localeCompare(b.digest)) };
  const receiptDigest = domainDigest("horseness.attempt-receipt.v1", normalized);
  return { ...normalized, receiptId: digestId("rcp_", receiptDigest), receiptDigest };
}
export function verifyAttemptReceipt(receipt: AttemptReceiptEnvelopeV1): void {
  const envelope = exactReceiptRecord(receipt, [...RECEIPT_KEYS, "receiptId", "receiptDigest"]); receiptText(envelope.receiptId); receiptText(envelope.receiptDigest);
  const { receiptId: _receiptId, receiptDigest: _receiptDigest, ...core } = receipt;
  validateAttemptReceiptCore(core);
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
    default: throw new DomainError("UNSUPPORTED_EVENT_TYPE");
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
      if (event.sequence !== state.lastEventSequence + 1) throw new DomainError("EVENT_SEQUENCE_INVALID");
      return { ...state, activePolicyDigest: event.activePolicyDigest, contextEpoch: state.contextEpoch + 1, lastEventSequence: event.sequence };
    default: throw new DomainError("UNSUPPORTED_EVENT_TYPE");
  }
}

export interface RunOperationalState { workspaceId: string; runId: string; eventCount: number; proposals: Readonly<Record<string, { status: "submitted" | "accepted"; proposalDigest: string }>>; receipts: Readonly<Record<string, { receiptDigest: string; outcome: "succeeded" | "failed" | "cancelled" }>>; taskStates: Readonly<Record<string, "succeeded" | "failed" | "cancelled">>; contextEpoch: number; lastEventSequence: number }
export type RunOperationalEvent =
  | { eventType: "RunCreatedV1"; sequence: number; workspaceId: string; runId: string }
  | { eventType: "ProposalSubmittedV1"; sequence: number; workspaceId: string; runId: string; proposalId: string; proposalDigest: string }
  | { eventType: "DeltaAcceptedV1"; sequence: number; workspaceId: string; runId: string; proposalId: string; proposalDigest: string }
  | { eventType: "AttemptReceiptRecordedV1"; sequence: number; workspaceId: string; runId: string; receiptId: string; receiptDigest: string; outcome: "succeeded" | "failed" | "cancelled" }
  | { eventType: "TaskResolvedV1"; sequence: number; workspaceId: string; runId: string; taskId: string; resolution: "succeeded" | "failed" | "cancelled" }
  | { eventType: "ForkCreatedV1" | "ContextManifestPublishedV1"; sequence: number; workspaceId: string; runId: string };
export function reduceOperationalState(state: RunOperationalState | null, event: RunOperationalEvent): RunOperationalState {
  if (event.eventType === "RunCreatedV1") {
    if (state !== null || event.sequence !== 1) throw new DomainError("INVALID_GENESIS");
    return { workspaceId: event.workspaceId, runId: event.runId, eventCount: 1, proposals: {}, receipts: {}, taskStates: {}, contextEpoch: 0, lastEventSequence: 1 };
  }
  if (state === null) throw new DomainError("INVALID_GENESIS");
  if (event.workspaceId !== state.workspaceId || event.runId !== state.runId) throw new DomainError("AGGREGATE_IDENTITY_MISMATCH");
  if (event.sequence !== state.lastEventSequence + 1) throw new DomainError("EVENT_SEQUENCE_INVALID");
  const next: RunOperationalState = { ...state, eventCount: state.eventCount + 1, proposals: { ...state.proposals }, receipts: { ...state.receipts }, taskStates: { ...state.taskStates }, contextEpoch: state.contextEpoch + 1, lastEventSequence: event.sequence };
  switch (event.eventType) {
    case "ProposalSubmittedV1": {
      const existing = next.proposals[event.proposalId];
      if (existing !== undefined && existing.proposalDigest !== event.proposalDigest) throw new DomainError("PROPOSAL_IDENTITY_CONFLICT");
      if (existing !== undefined) throw new DomainError("DUPLICATE_PROPOSAL_TRANSITION");
      return { ...next, proposals: { ...next.proposals, [event.proposalId]: { status: "submitted", proposalDigest: event.proposalDigest } } };
    }
    case "DeltaAcceptedV1": {
      const existing = next.proposals[event.proposalId];
      if (existing !== undefined && existing.proposalDigest !== event.proposalDigest) throw new DomainError("PROPOSAL_IDENTITY_CONFLICT");
      if (existing === undefined || existing.status !== "submitted") throw new DomainError("PROPOSAL_NOT_SUBMITTED");
      return { ...next, proposals: { ...next.proposals, [event.proposalId]: { ...existing, status: "accepted" } } };
    }
    case "AttemptReceiptRecordedV1": {
      const existing = next.receipts[event.receiptId];
      if (existing !== undefined && (existing.receiptDigest !== event.receiptDigest || existing.outcome !== event.outcome)) throw new DomainError("RECEIPT_IDENTITY_CONFLICT");
      if (existing !== undefined) throw new DomainError("DUPLICATE_RECEIPT_TRANSITION");
      return { ...next, receipts: { ...next.receipts, [event.receiptId]: { receiptDigest: event.receiptDigest, outcome: event.outcome } } };
    }
    case "TaskResolvedV1": {
      const existing = next.taskStates[event.taskId];
      if (existing !== undefined && existing !== event.resolution) throw new DomainError("TASK_IDENTITY_CONFLICT");
      if (existing !== undefined) throw new DomainError("DUPLICATE_TASK_TRANSITION");
      return { ...next, taskStates: { ...next.taskStates, [event.taskId]: event.resolution } };
    }
    case "ForkCreatedV1": case "ContextManifestPublishedV1": return next;
    default: throw new DomainError("UNSUPPORTED_EVENT_TYPE");
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
      case "ProposalSubmittedV1": operational = reduceOperationalState(operational, { eventType: "ProposalSubmittedV1", ...common, proposalId: text(payload.proposalId), proposalDigest: text(payload.proposalDigest) }); break;
      case "DeltaAcceptedV1": {
        const proposalId = text(payload.proposalId); const proposalDigest = text(payload.proposalDigest);
        canonical = reduceCanonicalDocument(canonical, { eventType: "DeltaAcceptedV1", ...common, proposalId, priorStateHash: text(payload.priorStateHash), resultingStateHash: text(payload.resultingStateHash), resultingDocument: json(payload.resultingDocument) });
        operational = reduceOperationalState(operational, { eventType: "DeltaAcceptedV1", ...common, proposalId, proposalDigest });
        break;
      }
      case "AttemptReceiptRecordedV1": {
        const outcome = text(payload.outcome); if (outcome !== "succeeded" && outcome !== "failed" && outcome !== "cancelled") throw new DomainError("MALFORMED_EVENT");
        operational = reduceOperationalState(operational, { eventType: "AttemptReceiptRecordedV1", ...common, receiptId: text(payload.receiptId), receiptDigest: text(payload.receiptDigest), outcome }); break;
      }
      case "TaskResolvedV1": {
        const resolution = text(payload.resolution); if (resolution !== "succeeded" && resolution !== "failed" && resolution !== "cancelled") throw new DomainError("MALFORMED_EVENT");
        operational = reduceOperationalState(operational, { eventType: "TaskResolvedV1", ...common, taskId: text(payload.taskId), resolution }); break;
      }
      case "ForkCreatedV1": operational = reduceOperationalState(operational, { eventType: "ForkCreatedV1", ...common }); break;
      case "ContextManifestPublishedV1": operational = reduceOperationalState(operational, { eventType: "ContextManifestPublishedV1", ...common }); break;
      default: throw new DomainError("UNSUPPORTED_EVENT_TYPE");
    }
  }
  if (canonical === null || operational === null) throw new DomainError("INVALID_GENESIS");
  return { canonical, operational };
}
