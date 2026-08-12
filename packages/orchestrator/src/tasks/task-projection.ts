import {
  DomainError,
  canonicalJson,
  completionPolicySatisfied,
  completionPredicateIdentity,
  domainDigest,
  sealDependencyJoinSnapshot,
  type CompletionPredicateV1,
  type CompositeCursorV1,
  type DependencyEdgeV1,
  type DependencyJoinSnapshotCoreV1,
  type DependencyOutcomeV1,
  type EventEnvelopeV1,
  type JsonValue,
  type Schedulability,
  type TaskCompletionPolicyV1,
  type TaskLifecycle,
  type TaskResolution,
} from "@horseness/domain";

export interface TaskContractV1 { taskId: string; contractDigest: string; completionPolicy: TaskCompletionPolicyV1 }
export interface DurableTaskStateV1 {
  contract: TaskContractV1;
  lifecycle: TaskLifecycle;
  resolution: TaskResolution | null;
  winningGeneration: number | null;
  resolutionEventSequence: number | null;
  resolutionDigest: string | null;
  durablePredicateIds: ReadonlySet<string>;
}
export interface TaskProjectionV1 { tasks: ReadonlyMap<string, DurableTaskStateV1>; edges: ReadonlyMap<string, DependencyEdgeV1> }

export type DurablePredicatePayloadV1 =
  | { eventType:"DeltaAcceptedV1"; workspaceId:string; runId:string; taskId:string; proposalDigest:string; resultingRevision:number; resultingStateHash:string }
  | { eventType:"ArtifactPublishedV1"; workspaceId:string; runId:string; taskId:string; objectDigests:string[]; publicationEventDigests:string[] }
  | { eventType:"ApprovalRecordedV1"; workspaceId:string; runId:string; taskId:string; approvalId:string; scopeDigest:string; evaluationCursor:CompositeCursorV1; expiresAt:string }
  | { eventType:"BindingValidSelectedReceiptV1"; workspaceId:string; runId:string; taskId:string; receiptDigest:string; generation:number; attemptContextBindingDigest:string; bindingValid:true; selected:true; outcome:"succeeded" };
export interface AuthenticatedDurableEventV1 { envelope:EventEnvelopeV1<DurablePredicatePayloadV1>; envelopeHash:string; resultCursor:CompositeCursorV1 }

export type AuthorityTruthV1 = "allowed" | "denied" | "unknown";
export interface TaskAuthorityProjectionV1 {
  schemaVersion:"1";
  observationCursor:CompositeCursorV1;
  contract:{valid:boolean;snapshotDigest:string};
  policy:{state:AuthorityTruthV1;snapshotDigest:string};
  grant:{state:AuthorityTruthV1;snapshotDigest:string};
  revocation:{state:"clear"|"revoked"|"unknown";snapshotDigest:string};
  quota:{state:"available"|"exhausted"|"unknown";snapshotDigest:string};
  attempt:{state:"none"|"live"|"unknown_outcome";snapshotDigest:string};
}
export interface JoinEvaluationV1 { taskId:string; schedulability:Schedulability; cancellationPropagated:boolean; reasonCodes:string[]; authoritySnapshotIdentities:string[]; snapshot:{core:DependencyJoinSnapshotCoreV1;digest:string;id:string} }

const cloneTask=(task:DurableTaskStateV1):DurableTaskStateV1=>({...task,durablePredicateIds:new Set(task.durablePredicateIds)});
const clone=(state:TaskProjectionV1):{tasks:Map<string,DurableTaskStateV1>;edges:Map<string,DependencyEdgeV1>}=>({tasks:new Map([...state.tasks].map(([id,task])=>[id,cloneTask(task)])),edges:new Map(state.edges)});
export const emptyTaskProjection=():TaskProjectionV1=>({tasks:new Map(),edges:new Map()});
const fail=(code:string):never=>{throw new DomainError(code)};
function requireTask(state:TaskProjectionV1,taskId:string,code="TASK_NOT_FOUND"):DurableTaskStateV1 { const task=state.tasks.get(taskId);if(task===undefined)throw new DomainError(code);return task; }
const predicateIds=(policy:TaskCompletionPolicyV1):string[]=>(policy.kind==="predicate"?[policy.predicate]:policy.predicates).map(completionPredicateIdentity);

export function addTask(state:TaskProjectionV1,contract:TaskContractV1):TaskProjectionV1 {
  if(!contract.taskId||!contract.contractDigest||state.tasks.has(contract.taskId)||predicateIds(contract.completionPolicy).length===0)fail("TASK_IDENTITY_CONFLICT");
  const next=clone(state);next.tasks.set(contract.taskId,{contract,lifecycle:"draft",resolution:null,winningGeneration:null,resolutionEventSequence:null,resolutionDigest:null,durablePredicateIds:new Set()});return next;
}
function validateGraph(state:TaskProjectionV1):void {
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string):void=>{if(visiting.has(id))fail("DEPENDENCY_CYCLE");if(visited.has(id))return;visiting.add(id);for(const edge of state.edges.values())if(edge.sourceTaskId===id)visit(edge.dependentTaskId);visiting.delete(id);visited.add(id)};
  for(const id of state.tasks.keys())visit(id);
}
export function addDependency(state:TaskProjectionV1,edge:DependencyEdgeV1):TaskProjectionV1 {
  const source=requireTask(state,edge.sourceTaskId,"INVALID_DEPENDENCY"),dependent=requireTask(state,edge.dependentTaskId,"INVALID_DEPENDENCY");
  if(state.edges.has(edge.edgeId)||source.lifecycle!=="draft"||dependent.lifecycle!=="draft")fail("INVALID_DEPENDENCY");
  if(!predicateIds(source.contract.completionPolicy).includes(edge.releasePredicate))fail("INVALID_RELEASE_PREDICATE");
  if(edge.edgeType==="requires_outcome"?(!edge.allowedOutcomes?.length||new Set(edge.allowedOutcomes).size!==edge.allowedOutcomes.length):edge.allowedOutcomes!==undefined)fail("INVALID_DEPENDENCY");
  const next=clone(state);next.edges.set(edge.edgeId,edge);validateGraph(next);return next;
}
export function activateTask(state:TaskProjectionV1,taskId:string):TaskProjectionV1 {const current=requireTask(state,taskId,"ILLEGAL_TASK_TRANSITION");if(current.lifecycle!=="draft")fail("ILLEGAL_TASK_TRANSITION");const next=clone(state);next.tasks.set(taskId,{...cloneTask(current),lifecycle:"active"});return next}

function authenticateEvent(event:AuthenticatedDurableEventV1):void {
  const {envelope,resultCursor}=event;
  if(envelope.schemaVersion!=="1"||envelope.streamKind!=="run"||envelope.workspaceId!==resultCursor.workspaceId||envelope.streamId!==resultCursor.runId||envelope.sequence!==resultCursor.runSequence||event.envelopeHash!==resultCursor.runEnvelopeHash)fail("PREDICATE_EVENT_UNAUTHENTICATED");
  if(envelope.eventType!==envelope.payload.eventType||envelope.payload.workspaceId!==resultCursor.workspaceId||envelope.payload.runId!==resultCursor.runId)fail("PREDICATE_EVENT_UNAUTHENTICATED");
  if(envelope.payloadHash!==domainDigest("horseness.event-payload.v1",envelope.payload as unknown as JsonValue)||event.envelopeHash!==domainDigest("horseness.event-envelope.v1",envelope as unknown as JsonValue))fail("PREDICATE_EVENT_UNAUTHENTICATED");
}
function predicateFrom(event:AuthenticatedDurableEventV1):CompletionPredicateV1 {
  authenticateEvent(event);const payload=event.envelope.payload;
  switch(payload.eventType){
    case "DeltaAcceptedV1": if(payload.resultingRevision<0)return fail("PREDICATE_EVENT_INVALID");return {kind:"canonical-change",proposalDigest:payload.proposalDigest,acceptedEventDigest:event.envelopeHash,resultingRevision:payload.resultingRevision,resultingStateHash:payload.resultingStateHash};
    case "ArtifactPublishedV1": if(payload.objectDigests.length===0||payload.publicationEventDigests.length===0)return fail("PREDICATE_EVENT_INVALID");return {kind:"artifact-published",objectDigests:[...payload.objectDigests],publicationEventDigests:[...payload.publicationEventDigests]};
    case "ApprovalRecordedV1": if(!Number.isFinite(Date.parse(payload.expiresAt))||payload.evaluationCursor.workspaceId!==event.resultCursor.workspaceId||payload.evaluationCursor.runId!==event.resultCursor.runId||payload.evaluationCursor.workspaceSequence>event.resultCursor.workspaceSequence||payload.evaluationCursor.runSequence>=event.resultCursor.runSequence)return fail("PREDICATE_EVENT_INVALID");return {kind:"approval-recorded",approvalId:payload.approvalId,scopeDigest:payload.scopeDigest,evaluationCursor:payload.evaluationCursor,expiresAt:payload.expiresAt};
    case "BindingValidSelectedReceiptV1": if(!payload.bindingValid||!payload.selected||payload.outcome!=="succeeded"||payload.generation<1||!payload.receiptDigest||!payload.attemptContextBindingDigest)return fail("PREDICATE_EVENT_INVALID");return {kind:"receipt-only"};
  }
}
export function projectDurablePredicate(state:TaskProjectionV1,event:AuthenticatedDurableEventV1):TaskProjectionV1 {
  const predicate=predicateFrom(event),taskId=event.envelope.payload.taskId,current=requireTask(state,taskId,"ILLEGAL_TASK_TRANSITION");if(current.lifecycle!=="active")fail("ILLEGAL_TASK_TRANSITION");
  const identity=completionPredicateIdentity(predicate);if(!predicateIds(current.contract.completionPolicy).includes(identity))fail("PREDICATE_NOT_IN_CONTRACT");
  const next=clone(state),ids=new Set(current.durablePredicateIds);ids.add(identity);next.tasks.set(taskId,{...cloneTask(current),durablePredicateIds:ids});return next;
}
export function resolveProjectedTask(state:TaskProjectionV1,input:{taskId:string;resolution:TaskResolution;winningGeneration:number|null;eventSequence:number;eventDigest:string}):TaskProjectionV1 {
  const current=requireTask(state,input.taskId,"ILLEGAL_TASK_TRANSITION");if(current.lifecycle!=="active"||input.eventSequence<1||!input.eventDigest)fail("ILLEGAL_TASK_TRANSITION");if(!completionPolicySatisfied(current.contract.completionPolicy,current.durablePredicateIds))fail("TASK_COMPLETION_UNSATISFIED");
  const next=clone(state);next.tasks.set(input.taskId,{...cloneTask(current),lifecycle:input.resolution,resolution:input.resolution,winningGeneration:input.winningGeneration,resolutionEventSequence:input.eventSequence,resolutionDigest:input.eventDigest});return next;
}
function authorityReasons(authority:TaskAuthorityProjectionV1,cursor:CompositeCursorV1):string[] {
  if(canonicalJson(authority.observationCursor)!==canonicalJson(cursor))fail("AUTHORITY_CURSOR_SUBSTITUTED");
  const reasons:string[]=[];if(!authority.contract.valid)reasons.push("CONTRACT_INVALID");if(authority.policy.state==="denied")reasons.push("POLICY_DENIED");if(authority.policy.state==="unknown")reasons.push("POLICY_UNKNOWN");if(authority.grant.state==="denied")reasons.push("GRANT_DENIED");if(authority.grant.state==="unknown")reasons.push("GRANT_UNKNOWN");if(authority.revocation.state==="revoked")reasons.push("GRANT_REVOKED");if(authority.revocation.state==="unknown")reasons.push("REVOCATION_UNKNOWN");if(authority.quota.state==="exhausted")reasons.push("QUOTA_EXHAUSTED");if(authority.quota.state==="unknown")reasons.push("QUOTA_UNKNOWN");if(authority.attempt.state==="live")reasons.push("ATTEMPT_LIVE");if(authority.attempt.state==="unknown_outcome")reasons.push("ATTEMPT_OUTCOME_UNKNOWN");return reasons;
}
export function evaluateTaskJoin(state:TaskProjectionV1,input:{taskId:string;cursor:CompositeCursorV1;authority:TaskAuthorityProjectionV1}):JoinEvaluationV1 {
  const task=requireTask(state,input.taskId);const edges=[...state.edges.values()].filter(edge=>edge.dependentTaskId===input.taskId).sort((a,b)=>a.edgeId.localeCompare(b.edgeId));const outcomes=new Map<string,DependencyOutcomeV1&{resolution:TaskResolution}>();let unknown=false,unsatisfied=false,cancellationPropagated=false;
  for(const edge of edges){const source=state.tasks.get(edge.sourceTaskId)!;const released=source.durablePredicateIds.has(edge.releasePredicate);if(!source.resolution||!source.resolutionEventSequence||!source.resolutionDigest||!released){unknown=true;continue}const outcome={edgeId:edge.edgeId,edgeType:edge.edgeType,sourceTaskId:edge.sourceTaskId,taskResolutionEventSequence:source.resolutionEventSequence,taskResolutionDigest:source.resolutionDigest,winningGeneration:source.winningGeneration,resolution:source.resolution};outcomes.set(edge.edgeId,outcome);const satisfied=edge.edgeType==="requires_terminal"||edge.edgeType==="requires_success"&&source.resolution==="succeeded"||edge.edgeType==="requires_outcome"&&edge.allowedOutcomes?.includes(source.resolution);if(!satisfied)unsatisfied=true;if(source.resolution==="cancelled"&&edge.propagateCancellation)cancellationPropagated=true}
  const reasons=authorityReasons(input.authority,input.cursor);if(unknown)reasons.push("DEPENDENCY_UNKNOWN");if(unsatisfied)reasons.push("DEPENDENCY_UNSATISFIED");if(cancellationPropagated)reasons.push("CANCELLATION_PROPAGATED");const terminal=["succeeded","failed","cancelled"].includes(task.lifecycle);let schedulability:Schedulability;if(terminal)schedulability="terminal";else if(task.lifecycle==="draft"||!input.authority.contract.valid||cancellationPropagated)schedulability="ineligible";else if(input.authority.attempt.state==="unknown_outcome")schedulability="unknown_outcome";else if(input.authority.attempt.state==="live")schedulability="running";else if(unknown||unsatisfied||reasons.some(reason=>["POLICY_DENIED","POLICY_UNKNOWN","GRANT_DENIED","GRANT_UNKNOWN","GRANT_REVOKED","REVOCATION_UNKNOWN","QUOTA_EXHAUSTED","QUOTA_UNKNOWN"].includes(reason)))schedulability="blocked";else schedulability="ready";
  const reasonCodes=[...new Set(reasons)].sort();const dependencies=[...outcomes.values()].map(({resolution:_resolution,...outcome})=>outcome);const snapshot=sealDependencyJoinSnapshot({schemaVersion:"1",runId:input.cursor.runId,taskId:input.taskId,taskContractDigest:task.contract.contractDigest,joinEvaluationId:`join:${input.taskId}:${input.cursor.workspaceSequence}:${input.cursor.runSequence}`,joinObservationCursor:input.cursor,dependencies,schedulability,reasonCodes});const authoritySnapshotIdentities=[input.authority.contract.snapshotDigest,input.authority.policy.snapshotDigest,input.authority.grant.snapshotDigest,input.authority.revocation.snapshotDigest,input.authority.quota.snapshotDigest,input.authority.attempt.snapshotDigest];return {taskId:input.taskId,schedulability,cancellationPropagated,reasonCodes,authoritySnapshotIdentities,snapshot};
}
