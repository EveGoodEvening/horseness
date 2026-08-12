import {
  DomainError,
  applyDelta,
  canonicalJson,
  canonicalScope,
  domainDigest,
  sealEventEnvelope,
  verifyAttemptReceipt,
  verifyForkPin,
  verifyProposal,
  type ApprovalBindingV1,
  type AttemptReceiptEnvelopeV1,
  type CompositeCursorV1,
  type DeltaAuthorityScopeV1,
  type DeltaResult,
  type EvaluationClockV1,
  type JsonValue,
  type DomainEventPayloadV1,
  type HashedEventEnvelopeV1,
  type WorkspaceEventPayloadV1,
  type RunEventPayloadV1,
  type ProposalEnvelopeV1,
  type SealedForkPinV1,
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
import { authorizeAdmission, type AdmissionAuthorization, type AuthoritativeAdmissionAuthorization } from "../authorization/admission-authorization.js";
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
  scopeDigest: string;
  forkPinDigest: string;
  receiptDigests: readonly string[];
  evidenceIds: readonly string[];
  policyDigest: string;
  quotaId: string;
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
export interface AdmissionSealingAuthorityV1 { schemaVersion:"1"; observationCursor:CompositeCursorV1; fork:SealedForkPinV1; scope:DeltaAuthorityScopeV1; receipts:AttemptReceiptEnvelopeV1[]; pinnedPolicy:PolicySlotV1; evidence:Array<PresentedEvidenceV1 & {size:number;mediaType:string}> }
export interface AdmissionCurrentAuthorityV1 { schemaVersion:"1"; evaluationObservationCursor:CompositeCursorV1; currentPolicy:PolicySlotV1; authorization:AuthoritativeAdmissionAuthorization; quota:{id:string;digest:string;available:boolean}; authenticatedApproverPrincipalId:string; authorityTime:string }
function snapshotAt(authority:SQLiteAuthority, workspaceId:string, runId:string, sequence:number, name:string):JsonValue {
  const row=authority.db.prepare("SELECT envelope_hash,state_json FROM snapshots WHERE workspace_id=? AND stream_kind='run' AND stream_id=? AND sequence=? AND projection_name=? AND projection_version='1'").get(workspaceId,runId,sequence,name) as {envelope_hash:string;state_json:string}|undefined;
  if(row===undefined)fail("AUTHORITY_STATE_MISSING");
  const event=authority.replay(workspaceId,"run",runId).find(item=>item.envelope.sequence===sequence);if(event===undefined||event.envelopeHash!==row.envelope_hash)fail("AUTHORITY_STATE_SUBSTITUTED");
  return JSON.parse(row.state_json) as JsonValue;
}
function authorityRecord(value:unknown,code:string):Record<string,unknown>{if(value===null||typeof value!=="object"||Array.isArray(value))fail(code);return value as Record<string,unknown>;}
function loadAuthorities(authority:SQLiteAuthority, request:AdmissionRequestV1, observed:CompositeCursorV1):{historical:AdmissionSealingAuthorityV1;current:AdmissionCurrentAuthorityV1} {
  const core=request.proposal.core; const sealing=core.proposalSealingObservationCursor;
  const historicalValue=authorityRecord(snapshotAt(authority,core.workspaceId,core.runId,sealing.runSequence,"admission-sealing"),"AUTHORITY_STATE_SUBSTITUTED");
  const currentValue=authorityRecord(snapshotAt(authority,core.workspaceId,core.runId,observed.runSequence,"admission-current"),"AUTHORITY_STATE_SUBSTITUTED");
  if(historicalValue.schemaVersion!=="1"||historicalValue.observationCursor===undefined||historicalValue.fork===undefined||historicalValue.scope===undefined||!Array.isArray(historicalValue.receipts)||historicalValue.pinnedPolicy===undefined||!Array.isArray(historicalValue.evidence))fail("AUTHORITY_STATE_SUBSTITUTED");
  if(currentValue.schemaVersion!=="1"||currentValue.evaluationObservationCursor===undefined||currentValue.currentPolicy===undefined||currentValue.authorization===undefined||currentValue.quota===undefined||typeof currentValue.authenticatedApproverPrincipalId!=="string"||typeof currentValue.authorityTime!=="string")fail("AUTHORITY_STATE_SUBSTITUTED");
  // Persisted snapshots are validated field-by-field below before their values are trusted.
  const historical=historicalValue as unknown as AdmissionSealingAuthorityV1;
  const current=currentValue as unknown as AdmissionCurrentAuthorityV1;
  if(historical.schemaVersion!=="1"||current.schemaVersion!=="1"||!same(historical.observationCursor,sealing)||!same(current.evaluationObservationCursor,observed))fail("AUTHORITY_STATE_SUBSTITUTED");
  verifyForkPin(historical.fork); if(historical.fork.forkPinDigest!==core.forkPinDigest)fail("FORK_PIN_MISMATCH");
  const recorded=new Set(authority.replay(core.workspaceId,"run",core.runId).filter(item=>item.envelope.sequence<=sealing.runSequence&&item.envelope.eventType==="AttemptReceiptRecordedV1").map(item=>(item.envelope.payload as {receiptDigest:string}).receiptDigest));
  for(const receipt of historical.receipts){verifyAttemptReceipt(receipt);if(!recorded.has(receipt.receiptDigest))fail("RECEIPT_MISMATCH");}
  for(const evidence of historical.evidence){const bytes=authority.artifacts.readReferenced(evidence.digest);if(bytes.length!==evidence.size)fail("EVIDENCE_MISMATCH");const catalog=authority.db.prepare("SELECT media_type FROM artifacts WHERE digest=?").get(evidence.digest) as {media_type:string|null}|undefined;if(catalog?.media_type!==evidence.mediaType)fail("EVIDENCE_MISMATCH");}
  return {historical,current};
}
function validateRequest(request: AdmissionRequestV1, revision: RevisionView, historical:AdmissionSealingAuthorityV1, current:AdmissionCurrentAuthorityV1): { delta: DeltaResult; paths: string[]; snapshots:SnapshotExpectationV1; evaluationClock:EvaluationClockV1 } {
  if (request.schemaVersion !== "1") fail("UNSUPPORTED_SCHEMA_VERSION");
  verifyProposal(request.proposal);
  const core=request.proposal.core;
  const structural=applyDelta(revision.document,core.operations,{...historical.scope,workspaceId:core.workspaceId,runId:core.runId});
  if(structural.outcome==="rejected"&&structural.reason!=="SCOPE_ESCAPE")fail(structural.reason);
  const scope=canonicalScope(historical.scope);if(scope.workspaceId!==core.workspaceId||scope.runId!==core.runId)fail("SCOPE_ESCAPE"); if(domainDigest("horseness.delta-authority-scope.v1",scope as unknown as JsonValue)!==core.deltaAuthorityScopeDigest)fail("SCOPE_ESCAPE");
  if(structural.outcome==="rejected")fail(structural.reason);
  const fork=historical.fork.core;if(fork.canonicalRevision!==core.baseRevision||fork.canonicalStateHash!==core.baseStateHash||fork.pinnedPolicyDigest!==core.pinnedPolicyDigest||fork.deltaAuthorityScopeDigest!==core.deltaAuthorityScopeDigest)fail("FORK_PIN_MISMATCH");
  if(policySlotDigest(historical.pinnedPolicy)!==core.pinnedPolicyDigest)fail("POLICY_SUBSTITUTED");
  const receipts=receiptMap(historical.receipts); if(core.receiptDigests.length!==receipts.size||core.receiptDigests.some(d=>!receipts.has(d)))fail("RECEIPT_MISMATCH");
  for(const receipt of receipts.values())if(receipt.workspaceId!==core.workspaceId||receipt.runId!==core.runId||receipt.attemptId!==core.attemptId||receipt.forkPinDigest!==core.forkPinDigest||receipt.producerGrantDigest!==core.authorGrantDigest)fail("RECEIPT_MISMATCH");
  const claims=new Map(core.evidenceClaims.map(item=>[item.claim,item.digest])); for(const item of historical.evidence)if(claims.get(item.evidenceId)!==item.digest)fail("EVIDENCE_MISMATCH");
  if(claims.size!==historical.evidence.length)fail("EVIDENCE_MISMATCH");
  if(request.scopeDigest!==core.deltaAuthorityScopeDigest||request.forkPinDigest!==core.forkPinDigest||!same([...request.receiptDigests].sort(),[...core.receiptDigests].sort())||request.policyDigest!==core.currentPolicyDigest||request.quotaId!==current.quota.id||!same([...request.evidenceIds].sort(),historical.evidence.map(item=>item.evidenceId).sort()))fail("AUTHORITY_IDENTIFIER_MISMATCH");
  const snapshots:SnapshotExpectationV1={issueObservationCursor:core.proposalSealingObservationCursor,evaluationObservationCursor:current.evaluationObservationCursor,expectedGrantDigest:core.authorGrantDigest,observedGrantDigest:current.authorization.grantDigest,expectedQuotaDigest:current.quota.digest,observedQuotaDigest:current.quota.digest,quotaAvailable:current.quota.available,authenticatedApproverPrincipalId:current.authenticatedApproverPrincipalId};
  const evaluationClock:EvaluationClockV1={schemaVersion:"1",authorityTime:current.authorityTime,observationCursor:current.evaluationObservationCursor};
  const paths=[...new Set(core.operations.map(operation=>operation.path))].sort();
  const delta=core.baseRevision!==revision.revision||core.baseStateHash!==revision.stateHash?{outcome:"conflicted" as const,reason:"STALE_BASE" as const}:structural;
  return {delta,paths,snapshots,evaluationClock};
}
function existingTerminal(authority:SQLiteAuthority, request:AdmissionRequestV1, revision:RevisionView):AdmissionResultV1|null {
  const events=authority.replay(request.proposal.core.workspaceId,"run",request.proposal.core.runId);
  const decisions=events.filter(item=>{const payload=item.envelope.payload;return item.envelope.eventType==="AdmissionDecisionRecordedV1"&&typeof payload==="object"&&payload!==null&&"proposalId" in payload&&payload.proposalId===request.proposal.proposalId;});
  for(const decision of decisions){const payload=decision.envelope.payload;if(typeof payload!=="object"||payload===null||!("proposalDigest" in payload)||payload.proposalDigest!==request.proposal.proposalDigest)fail("PROPOSAL_IDENTITY_CONFLICT");}
  const terminal=[...decisions].reverse().find(item=>{const payload=item.envelope.payload;return typeof payload==="object"&&payload!==null&&"state" in payload&&typeof payload.state==="string"&&["accepted","rejected","conflicted"].includes(payload.state);});
  if(terminal===undefined)return null;
  const payload=terminal.envelope.payload as {state:"accepted"|"rejected"|"conflicted";provenanceDigest:string};
  return {schemaVersion:"1",state:payload.state,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,revision:revision.revision,stateHash:revision.stateHash,provenanceDigest:payload.provenanceDigest,deduplicated:true};
}
export class AdmissionService {
  constructor(private readonly authority: SQLiteAuthority) {}
  evaluateAndApply(request: AdmissionRequestV1): AdmissionResultV1 {
    if(request===null||typeof request!=="object"||request.proposal===null||typeof request.proposal!=="object")fail("INVALID_ENVELOPE");
    verifyProposal(request.proposal);
    const core=request.proposal.core; const revision=loadRevision(this.authority,core.workspaceId,core.runId); const prior=existingTerminal(this.authority,request,revision); if(prior!==null)return prior;
    const observed=currentCursor(this.authority,core.workspaceId,core.runId); const loaded=loadAuthorities(this.authority,request,observed);
    const validated=validateRequest(request,revision,loaded.historical,loaded.current);
    const delta=validated.delta;
    if(delta.outcome!=="conflicted"&&policySlotDigest(loaded.current.currentPolicy)!==core.currentPolicyDigest)fail("POLICY_SUBSTITUTED");
    if(delta.outcome!=="conflicted") { const authorization=authorizeAdmission(request.authorization,loaded.current.authorization,{workspaceId:core.workspaceId,runId:core.runId,principalId:core.authorPrincipalId,observationSequence:observed.runSequence}); if(!authorization.allowed)fail(authorization.reason); }
    const conflict=delta.outcome==="accepted"?null:delta.reason;
    const evaluation=evaluateAdmission({schemaVersion:"1",proposalDigest:request.proposal.proposalDigest,proposalAuthorPrincipalId:core.authorPrincipalId,baseRevision:core.baseRevision,baseStateHash:core.baseStateHash,action:request.action,paths:validated.paths,version:request.version,pinnedPolicy:loaded.historical.pinnedPolicy,currentPolicy:loaded.current.currentPolicy,evidence:loaded.historical.evidence,snapshots:validated.snapshots,evaluationClock:validated.evaluationClock,approval:request.approval,preconditionConflict:conflict});
    const state=evaluation.result; const resultingRevision=state==="accepted"?revision.revision+1:revision.revision; const resultingHash=state==="accepted"&&delta.outcome==="accepted"?delta.stateHash:revision.stateHash;
    const provenance:AdmissionProvenanceV1={schemaVersion:"1",proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,decision:state,evaluation,observationCursor:observed,priorRevision:revision.revision,priorStateHash:revision.stateHash,resultingRevision,resultingStateHash:resultingHash,receiptDigests:[...core.receiptDigests].sort(),forkPinDigest:core.forkPinDigest,scopeDigest:core.deltaAuthorityScopeDigest,predecessorProposalDigest:core.predecessorProposalDigest};
    if(state==="accepted"&&delta.outcome!=="accepted")fail("STALE_BASE");
    const workspaceEvents=this.authority.replay(core.workspaceId,"workspace",core.workspaceId); const workspaceHead=workspaceEvents.at(-1)!; const runEvents=this.authority.replay(core.workspaceId,"run",core.runId); const runHead=runEvents.at(-1)!;
    const provenanceJson=canonicalJson(provenance as unknown as JsonValue);const provenanceDigest=domainDigest("horseness.admission-provenance.v1",provenance as unknown as JsonValue);const artifactDigest=domainDigestRaw(provenanceJson);
    const priorDecision=[...runEvents].reverse().find(item=>{const payload=item.envelope.payload;return item.envelope.eventType==="AdmissionDecisionRecordedV1"&&typeof payload==="object"&&payload!==null&&"proposalId" in payload&&payload.proposalId===request.proposal.proposalId;});
    const transition=request.action==="approve"||request.action==="reject"||request.action==="release"||request.action==="rebase"?request.action:"evaluate";
    const submitted=priorDecision===undefined?event({streamKind:"run",workspaceId:core.workspaceId,streamId:core.runId,sequence:runHead.envelope.sequence+1,prior:runHead.envelopeHash,type:"ProposalSubmittedV1",payload:{eventType:"ProposalSubmittedV1",workspaceId:core.workspaceId,runId:core.runId,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest},commandId:request.commandId,principalId:core.authorPrincipalId}):null;
    const firstTransitionSequence=runHead.envelope.sequence+(submitted===null?1:2);const firstTransitionPrior=submitted?.envelopeHash??runHead.envelopeHash;
    const accepted=state==="accepted"&&delta.outcome==="accepted"?event({streamKind:"run",workspaceId:core.workspaceId,streamId:core.runId,sequence:firstTransitionSequence,prior:firstTransitionPrior,type:"DeltaAcceptedV1",payload:{eventType:"DeltaAcceptedV1",workspaceId:core.workspaceId,runId:core.runId,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,priorStateHash:revision.stateHash,resultingStateHash:delta.stateHash,resultingDocument:delta.document},commandId:request.commandId,principalId:core.authorPrincipalId}):null;
    const decisionSequence=firstTransitionSequence+(accepted===null?0:1);const decisionPrior=accepted?.envelopeHash??firstTransitionPrior;
    const decision=event({streamKind:"run",workspaceId:core.workspaceId,streamId:core.runId,sequence:decisionSequence,prior:decisionPrior,type:"AdmissionDecisionRecordedV1",payload:{eventType:"AdmissionDecisionRecordedV1",workspaceId:core.workspaceId,runId:core.runId,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,transition,state,provenanceDigest,artifactDigest,observationCursor:observed},commandId:request.commandId,principalId:core.authorPrincipalId});
    const workspaceEvent=event({streamKind:"workspace",workspaceId:core.workspaceId,streamId:core.workspaceId,sequence:workspaceHead.envelope.sequence+1,prior:workspaceHead.envelopeHash,type:"WorkspaceAdmissionRecordedV1",payload:{eventType:"WorkspaceAdmissionRecordedV1",workspaceId:core.workspaceId,proposalDigest:request.proposal.proposalDigest,decisionEventId:decision.envelope.eventId,quotaId:request.quotaId,quotaDigest:validated.snapshots.observedQuotaDigest,consumed:state==="accepted"?"yes":"no"},commandId:request.commandId,principalId:core.authorPrincipalId});
    const runAppend=[...(submitted===null?[]:[submitted]),...(accepted===null?[]:[accepted]),decision] as HashedEventEnvelopeV1<RunEventPayloadV1>[];
    const artifact={data:provenanceJson,mediaType:"application/vnd.horseness.admission-provenance+json",references:[{ownerKind:"event",ownerId:decision.envelope.eventId}]};
    try { this.authority.publishAndAppendAtomic({commandId:request.commandId,workspace:{streamKind:"workspace",workspaceId:core.workspaceId,streamId:core.workspaceId,expectedSequence:workspaceHead.envelope.sequence,expectedEnvelopeHash:workspaceHead.envelopeHash,events:[workspaceEvent as HashedEventEnvelopeV1<WorkspaceEventPayloadV1>]},run:{streamKind:"run",workspaceId:core.workspaceId,streamId:core.runId,expectedSequence:runHead.envelope.sequence,expectedEnvelopeHash:runHead.envelopeHash,events:runAppend},artifacts:[artifact],requiredArtifactDigests:[artifactDigest]}); }
    catch(error){if(error instanceof StoreConflictError)fail("STALE_BASE");throw error;}
    return {schemaVersion:"1",state,proposalId:request.proposal.proposalId,proposalDigest:request.proposal.proposalDigest,revision:resultingRevision,stateHash:resultingHash,provenanceDigest,deduplicated:false};
  }
}
function domainDigestRaw(value:string):string { return (awaitlessSha256(value)); }
import { createHash } from "node:crypto";
function awaitlessSha256(value:string):string{return createHash("sha256").update(value).digest("hex");}
