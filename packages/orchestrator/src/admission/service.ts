import {
  DomainError,
  applyDelta,
  canonicalJson,
  canonicalScope,
  domainDigest,
  sealEventEnvelope,
  verifyAttemptReceipt,
  verifyProposal,
  type ApprovalBindingV1,
  type AttemptReceiptEnvelopeV1,
  type CompositeCursorV1,
  type DeltaAuthorityScopeV1,
  type EvaluationClockV1,
  type JsonValue,
  type DomainEventPayloadV1,
  type HashedEventEnvelopeV1,
  type WorkspaceEventPayloadV1,
  type RunEventPayloadV1,
  type ProposalEnvelopeV1,
} from "@horseness/domain";
import {
  evaluateAdmission,
  policySlotDigest,
  type AdmissionEvaluationV1,
  type PolicySlotV1,
  type PresentedEvidenceV1,
  type SnapshotExpectationV1,
} from "@horseness/policy";
import { SQLiteAuthority, StoreConflictError } from "@horseness/store-sqlite";
import { authorizeAdmission, type AdmissionAuthorization } from "../authorization/admission-authorization.js";
import { loadRevision, type RevisionView } from "../revisions/revision-service.js";

export type AdmissionTerminalState = "accepted" | "rejected" | "conflicted" | "quarantined" | "approval_required";
export interface AdmissionProvenanceV1 {
  schemaVersion: "1";
  proposalId: string;
  proposalDigest: string;
  decision: AdmissionTerminalState;
  evaluation: AdmissionEvaluationV1;
  observationCursor: CompositeCursorV1;
  priorRevision: number;
  priorStateHash: string;
  resultingRevision: number;
  resultingStateHash: string;
  receiptDigests: string[];
  forkPinDigest: string;
  scopeDigest: string;
  predecessorProposalDigest: string | null;
}
export interface AdmissionRequestV1 {
  schemaVersion: "1";
  commandId: string;
  proposal: ProposalEnvelopeV1;
  scope: DeltaAuthorityScopeV1;
  fork: { digest: string; workspaceId: string; runId: string; canonicalRevision: number; canonicalStateHash: string; pinnedPolicyDigest: string };
  receipts: readonly AttemptReceiptEnvelopeV1[];
  pinnedPolicy: PolicySlotV1;
  currentPolicy: PolicySlotV1;
  evidence: PresentedEvidenceV1[];
  snapshots: SnapshotExpectationV1;
  evaluationClock: EvaluationClockV1;
  approval: ApprovalBindingV1 | null;
  authorization: AdmissionAuthorization;
  action: string;
  version: string;
}
export interface AdmissionResultV1 { schemaVersion: "1"; state: AdmissionTerminalState; proposalId: string; proposalDigest: string; revision: number; stateHash: string; provenanceDigest: string | null; deduplicated: boolean }

function fail(code: string): never { throw new DomainError(code); }
function same(left: unknown, right: unknown): boolean { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); }
function currentCursor(authority: SQLiteAuthority, workspaceId: string, runId: string): CompositeCursorV1 {
  const workspace = authority.replay(workspaceId, "workspace", workspaceId).at(-1);
  const run = authority.replay(workspaceId, "run", runId).at(-1);
  if (workspace === undefined || run === undefined) fail("INVALID_GENESIS");
  return { schemaVersion:"1", kind:"composite", workspaceId, workspaceSequence:workspace.envelope.sequence, workspaceEnvelopeHash:workspace.envelopeHash, workspaceContextEpoch:Math.max(0,workspace.envelope.sequence-1), runId, runSequence:run.envelope.sequence, runEnvelopeHash:run.envelopeHash, runContextEpoch:Math.max(0,run.envelope.sequence-1) };
}
function event<T extends DomainEventPayloadV1>(input:{streamKind:"workspace"|"run";workspaceId:string;streamId:string;sequence:number;prior:string;type:T["eventType"];payload:T;commandId:string;principalId:string}):HashedEventEnvelopeV1<T> {
  const identity=domainDigest("horseness.orchestrator-event-id.v1",{commandId:input.commandId,streamKind:input.streamKind,sequence:input.sequence} as JsonValue);
  return sealEventEnvelope({ schemaVersion:"1", streamKind:input.streamKind, workspaceId:input.workspaceId, streamId:input.streamId, sequence:input.sequence, priorEnvelopeHash:input.prior, eventId:identity, eventType:input.type, payload:input.payload, principalId:input.principalId, causationId:input.commandId, correlationId:input.commandId, idempotencyKey:identity });
}
function receiptMap(receipts: readonly AttemptReceiptEnvelopeV1[]): Map<string, AttemptReceiptEnvelopeV1> {
  const result = new Map<string, AttemptReceiptEnvelopeV1>();
  for (const receipt of receipts) { verifyAttemptReceipt(receipt); if (result.has(receipt.receiptDigest)) fail("RECEIPT_MISMATCH"); result.set(receipt.receiptDigest, receipt); }
  return result;
}
function validateRequest(request: AdmissionRequestV1, revision: RevisionView): { conflict: string | null; paths: string[] } {
  if (request.schemaVersion !== "1") fail("UNSUPPORTED_SCHEMA_VERSION");
  verifyProposal(request.proposal);
  const core=request.proposal.core;
  if(core.workspaceId!==revision.workspaceId||core.runId!==revision.runId||request.scope.workspaceId!==core.workspaceId||request.scope.runId!==core.runId)fail("SCOPE_ESCAPE");
  const scope=canonicalScope(request.scope); if(domainDigest("horseness.delta-authority-scope.v1",scope as unknown as JsonValue)!==core.deltaAuthorityScopeDigest)fail("SCOPE_ESCAPE");
  if(request.fork.digest!==core.forkPinDigest||request.fork.workspaceId!==core.workspaceId||request.fork.runId!==core.runId)fail("FORK_PIN_MISMATCH");
  if(request.fork.canonicalRevision!==core.baseRevision||request.fork.canonicalStateHash!==core.baseStateHash||request.fork.pinnedPolicyDigest!==core.pinnedPolicyDigest)fail("FORK_PIN_MISMATCH");
  if(policySlotDigest(request.pinnedPolicy)!==core.pinnedPolicyDigest||policySlotDigest(request.currentPolicy)!==core.currentPolicyDigest)fail("POLICY_SUBSTITUTED");
  const receipts=receiptMap(request.receipts); if(core.receiptDigests.length!==receipts.size||core.receiptDigests.some(d=>!receipts.has(d)))fail("RECEIPT_MISMATCH");
  for(const receipt of receipts.values())if(receipt.workspaceId!==core.workspaceId||receipt.runId!==core.runId||receipt.attemptId!==core.attemptId||receipt.forkPinDigest!==core.forkPinDigest||receipt.producerGrantDigest!==core.authorGrantDigest)fail("RECEIPT_MISMATCH");
  const claims=new Map(core.evidenceClaims.map(item=>[item.claim,item.digest])); for(const item of request.evidence)if(claims.get(item.evidenceId)!==item.digest)fail("EVIDENCE_MISMATCH");
  if(claims.size!==request.evidence.length)fail("EVIDENCE_MISMATCH");
  const paths=[...new Set(core.operations.map(operation=>operation.path))].sort();
  const conflict=core.baseRevision!==revision.revision||core.baseStateHash!==revision.stateHash?"STALE_BASE":null;
  return {conflict,paths};
}
function existingTerminal(authority:SQLiteAuthority, request:AdmissionRequestV1, revision:RevisionView):AdmissionResultV1|null {
  const events=authority.replay(request.proposal.core.workspaceId,"run",request.proposal.core.runId);
  const accepted=events.find(item=>item.envelope.eventType==="DeltaAcceptedV1"&&(item.envelope.payload as {proposalId?:string}).proposalId===request.proposal.proposalId);
  if(accepted===undefined)return null;
  const payload=accepted.envelope.payload as {proposalDigest:string;resultingStateHash:string}; if(payload.proposalDigest!==request.proposal.proposalDigest)fail("PROPOSAL_IDENTITY_CONFLICT");
  return {schemaVersion:"1",state:"accepted",proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,revision:revision.revision,stateHash:revision.stateHash,provenanceDigest:null,deduplicated:true};
}
export class AdmissionService {
  constructor(private readonly authority: SQLiteAuthority) {}
  evaluateAndApply(request: AdmissionRequestV1): AdmissionResultV1 {
    const core=request.proposal.core; const revision=loadRevision(this.authority,core.workspaceId,core.runId); const prior=existingTerminal(this.authority,request,revision); if(prior!==null)return prior;
    const observed=currentCursor(this.authority,core.workspaceId,core.runId); if(!same(observed,core.proposalSealingObservationCursor)||!same(observed,request.snapshots.evaluationObservationCursor)||!same(observed,request.evaluationClock.observationCursor))fail("STALE_BASE");
    const authorization=authorizeAdmission(request.authorization,{workspaceId:core.workspaceId,runId:core.runId,principalId:core.authorPrincipalId,grantDigest:core.authorGrantDigest,observationSequence:observed.runSequence}); if(!authorization.allowed)fail(authorization.reason);
    const validated=validateRequest(request,revision);
    const delta=validated.conflict===null?applyDelta(revision.document,core.operations,request.scope):{outcome:"conflicted" as const,reason:"STALE_BASE" as const};
    const conflict=delta.outcome==="accepted"?null:delta.reason;
    const evaluation=evaluateAdmission({schemaVersion:"1",proposalDigest:request.proposal.proposalDigest,proposalAuthorPrincipalId:core.authorPrincipalId,baseRevision:core.baseRevision,baseStateHash:core.baseStateHash,action:request.action,paths:validated.paths,version:request.version,pinnedPolicy:request.pinnedPolicy,currentPolicy:request.currentPolicy,evidence:request.evidence,snapshots:request.snapshots,evaluationClock:request.evaluationClock,approval:request.approval,preconditionConflict:conflict});
    const state=evaluation.result; const resultingRevision=state==="accepted"?revision.revision+1:revision.revision; const resultingHash=state==="accepted"&&delta.outcome==="accepted"?delta.stateHash:revision.stateHash;
    const provenance:AdmissionProvenanceV1={schemaVersion:"1",proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,decision:state,evaluation,observationCursor:observed,priorRevision:revision.revision,priorStateHash:revision.stateHash,resultingRevision,resultingStateHash:resultingHash,receiptDigests:[...core.receiptDigests].sort(),forkPinDigest:core.forkPinDigest,scopeDigest:core.deltaAuthorityScopeDigest,predecessorProposalDigest:core.predecessorProposalDigest};
    if(state!=="accepted")return {schemaVersion:"1",state,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,revision:revision.revision,stateHash:revision.stateHash,provenanceDigest:domainDigest("horseness.admission-provenance.v1",provenance as unknown as JsonValue),deduplicated:false};
    if(delta.outcome!=="accepted")fail("STALE_BASE");
    const workspaceEvents=this.authority.replay(core.workspaceId,"workspace",core.workspaceId); const workspaceHead=workspaceEvents.at(-1)!; const runEvents=this.authority.replay(core.workspaceId,"run",core.runId); const runHead=runEvents.at(-1)!;
    const workspaceEvent=event({streamKind:"workspace",workspaceId:core.workspaceId,streamId:core.workspaceId,sequence:workspaceHead.envelope.sequence+1,prior:workspaceHead.envelopeHash,type:"PolicyReferenceChangedV1",payload:{eventType:"PolicyReferenceChangedV1",workspaceId:core.workspaceId,activePolicyDigest:core.currentPolicyDigest},commandId:request.commandId,principalId:core.authorPrincipalId});
    const submitted=event({streamKind:"run",workspaceId:core.workspaceId,streamId:core.runId,sequence:runHead.envelope.sequence+1,prior:runHead.envelopeHash,type:"ProposalSubmittedV1",payload:{eventType:"ProposalSubmittedV1",workspaceId:core.workspaceId,runId:core.runId,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest},commandId:request.commandId,principalId:core.authorPrincipalId});
    const accepted=event({streamKind:"run",workspaceId:core.workspaceId,streamId:core.runId,sequence:runHead.envelope.sequence+2,prior:submitted.envelopeHash,type:"DeltaAcceptedV1",payload:{eventType:"DeltaAcceptedV1",workspaceId:core.workspaceId,runId:core.runId,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,priorStateHash:revision.stateHash,resultingStateHash:delta.stateHash,resultingDocument:delta.document},commandId:request.commandId,principalId:core.authorPrincipalId});
    const artifact={data:canonicalJson(provenance as unknown as JsonValue),mediaType:"application/vnd.horseness.admission-provenance+json",references:[{ownerKind:"event",ownerId:accepted.envelope.eventId}]};
    const provenanceDigest=domainDigest("horseness.admission-provenance.v1",provenance as unknown as JsonValue); const bytesDigest=domainDigest("horseness.artifact-bytes.v1",canonicalJson(provenance as unknown as JsonValue)); void bytesDigest;
    try { this.authority.publishAndAppendAtomic({commandId:request.commandId,workspace:{streamKind:"workspace",workspaceId:core.workspaceId,streamId:core.workspaceId,expectedSequence:workspaceHead.envelope.sequence,expectedEnvelopeHash:workspaceHead.envelopeHash,events:[workspaceEvent as HashedEventEnvelopeV1<WorkspaceEventPayloadV1>]},run:{streamKind:"run",workspaceId:core.workspaceId,streamId:core.runId,expectedSequence:runHead.envelope.sequence,expectedEnvelopeHash:runHead.envelopeHash,events:[submitted as HashedEventEnvelopeV1<RunEventPayloadV1>,accepted as HashedEventEnvelopeV1<RunEventPayloadV1>]},artifacts:[artifact],requiredArtifactDigests:[domainDigestRaw(canonicalJson(provenance as unknown as JsonValue))]}); }
    catch(error){if(error instanceof StoreConflictError)fail("STALE_BASE");throw error;}
    return {schemaVersion:"1",state,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,revision:resultingRevision,stateHash:resultingHash,provenanceDigest,deduplicated:false};
  }
}
function domainDigestRaw(value:string):string { return (awaitlessSha256(value)); }
import { createHash } from "node:crypto";
function awaitlessSha256(value:string):string{return createHash("sha256").update(value).digest("hex");}
