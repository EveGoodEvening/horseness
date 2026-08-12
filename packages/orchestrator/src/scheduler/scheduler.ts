import { canonicalJson, domainDigest, DomainError, type CompositeCursorV1, type JsonValue } from "@horseness/domain";
import { isJoinEvaluationV1, isVerifiedAuthorityEventV1, type JoinEvaluationV1, type VerifiedAuthorityEventV1 } from "../tasks/task-projection.js";

export type SchedulerDecisionCodeV1 = "READY"|"NOT_READY"|"CANCELLED"|"ALREADY_AUTHORIZED"|"DELTA_NOT_ACCEPTED"|"AUTHORITY_HEAD_MISMATCH"|"AUTHORITY_IDENTITY_MISMATCH";
export interface SchedulerCandidateV1 { readonly taskId:string; readonly priority:number; readonly createdSequence:number; readonly join:JoinEvaluationV1; readonly deltaAccepted:VerifiedAuthorityEventV1|null; readonly proposalDigest?:string; readonly requiredPredicateIdentity?:string; }
export interface SchedulerDecisionV1 { readonly schemaVersion:"1"; readonly taskId:string; readonly observationCursor:CompositeCursorV1; readonly decisionCode:SchedulerDecisionCodeV1; readonly decisionDigest:string; readonly authorizationKey:string|null; }
const decisions=new WeakSet<object>();
const compare=(a:SchedulerCandidateV1,b:SchedulerCandidateV1):number=>b.priority-a.priority||a.createdSequence-b.createdSequence||Buffer.compare(Buffer.from(a.taskId),Buffer.from(b.taskId));
const same=(a:unknown,b:unknown)=>canonicalJson(a as JsonValue)===canonicalJson(b as JsonValue);
function seal(core:Omit<SchedulerDecisionV1,"decisionDigest">):SchedulerDecisionV1{const value=Object.freeze({...core,decisionDigest:domainDigest("horseness.scheduler-decision.v1",core as unknown as JsonValue)});decisions.add(value);return value;}
export function isTrustedSchedulerDecision(value:SchedulerDecisionV1):boolean{return decisions.has(value)&&value.decisionDigest===domainDigest("horseness.scheduler-decision.v1",(({decisionDigest:_,...core})=>core)(value) as unknown as JsonValue);}
export function selectReadyTasks(candidates:readonly SchedulerCandidateV1[],alreadyAuthorized:ReadonlySet<string>=new Set()):readonly SchedulerDecisionV1[]{
 const ids=new Set<string>(),out:SchedulerDecisionV1[]=[];
 for(const candidate of [...candidates].sort(compare)){
  if(ids.has(candidate.taskId))throw new DomainError("DUPLICATE_TASK_CANDIDATE");ids.add(candidate.taskId);
  if(!isJoinEvaluationV1(candidate.join))throw new DomainError("JOIN_EVALUATION_UNAUTHENTICATED");
  const cursor=candidate.join.snapshot.core.joinObservationCursor;let code:SchedulerDecisionCodeV1="READY",key:string|null=null;
  const accepted=candidate.deltaAccepted,payload=accepted?.envelope.payload;
  const candidateIdentity=candidate.join.taskId===candidate.taskId&&candidate.join.snapshot.core.taskId===candidate.taskId;
  const directIdentity=payload?.eventType==="DeltaAcceptedV1"&&payload.taskId===candidate.taskId&&candidate.proposalDigest!==undefined&&payload.proposalDigest===candidate.proposalDigest;
  const dependencyIdentity=payload?.eventType==="DeltaAcceptedV1"&&candidate.requiredPredicateIdentity!==undefined&&candidate.join.dependencyReleasePredicates.some(binding=>binding.sourceTaskId===payload.taskId&&binding.predicateIdentity===candidate.requiredPredicateIdentity);
  if(candidate.join.cancellationPropagated)code="CANCELLED";else if(candidate.join.schedulability!=="ready")code="NOT_READY";else if(!accepted||payload?.eventType!=="DeltaAcceptedV1")code="DELTA_NOT_ACCEPTED";else if(!isVerifiedAuthorityEventV1(accepted))throw new DomainError("PREDICATE_EVENT_UNVERIFIED");else if(!same(accepted.resultCursor,cursor))code="AUTHORITY_HEAD_MISMATCH";else if(!candidateIdentity||(!directIdentity&&!dependencyIdentity))code="AUTHORITY_IDENTITY_MISMATCH";else {key=domainDigest("horseness.scheduler-authorization.v1",{taskId:candidate.taskId,cursor,acceptedEventDigest:accepted.envelopeHash,acceptedTaskId:payload.taskId,proposalDigest:payload.proposalDigest,requiredPredicateIdentity:candidate.requiredPredicateIdentity??null,joinDigest:candidate.join.snapshot.digest} as unknown as JsonValue);if(alreadyAuthorized.has(key))code="ALREADY_AUTHORIZED";}
  out.push(seal({schemaVersion:"1",taskId:candidate.taskId,observationCursor:cursor,decisionCode:code,authorizationKey:code==="READY"?key:null}));
 }
 return Object.freeze(out);
}
