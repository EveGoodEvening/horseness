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
  type HashedEventEnvelopeV1,
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
export interface DurableAuthorityEventV1 { envelope:EventEnvelopeV1<DurablePredicatePayloadV1>; envelopeHash:string; resultCursor:CompositeCursorV1 }
export interface VerifiedStreamChainHeadProofV1 {
  readonly workspaceId:string;
  readonly runId:string;
  readonly headSequence:number;
  readonly headEnvelopeHash:string;
  readonly authorityReplayDigest:string;
  readonly replay:readonly HashedEventEnvelopeV1<unknown>[];
  readonly authorizedProducers?:Readonly<Record<string,readonly string[]>>;
}
declare const verifiedAuthorityEventBrand:unique symbol;
export type VerifiedAuthorityEventV1=DurableAuthorityEventV1&{readonly [verifiedAuthorityEventBrand]:true};

export type AuthorityTruthV1 = "allowed" | "denied" | "unknown";
export type TaskAuthorityComponentKindV1="contract"|"policy"|"grant-revocation"|"quota"|"attempt-outcome";
type TaskAuthorityComponentValueV1=
  | {kind:"contract";valid:boolean}
  | {kind:"policy";state:AuthorityTruthV1}
  | {kind:"grant-revocation";grantState:AuthorityTruthV1;revocationState:"clear"|"revoked"|"unknown"}
  | {kind:"quota";state:"available"|"exhausted"|"unknown"}
  | {kind:"attempt-outcome";state:"none"|"live"|"unknown_outcome"};
export interface TaskAuthorityComponentSnapshotV1 {
  schemaVersion:"1";
  workspaceId:string;
  runId:string;
  taskId:string;
  observationCursor:CompositeCursorV1;
  value:TaskAuthorityComponentValueV1;
  projectionProof:{schemaVersion:"1";projectionName:string;projectionVersion:"1";snapshotDigest:string;replayDigest:string};
}
const authenticatedTaskAuthority:unique symbol=Symbol("authenticatedTaskAuthority");
export interface TaskAuthorityProjectionV1 {
  schemaVersion:"1";
  observationCursor:CompositeCursorV1;
  taskId:string;
  components:readonly TaskAuthorityComponentSnapshotV1[];
  compositeDigest:string;
  readonly [authenticatedTaskAuthority]:true;
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

export function authorityReplayDigest(replay:readonly HashedEventEnvelopeV1<unknown>[]):string {
  return domainDigest("horseness.authority-replay.v1",replay as unknown as JsonValue);
}
export function verifyAuthorityEvent(event:DurableAuthorityEventV1,proof:VerifiedStreamChainHeadProofV1):VerifiedAuthorityEventV1 {
  const {envelope,resultCursor}=event;
  let prior:string|null=null;
  let expectedSequence=1;
  for(const item of proof.replay){if(item.envelope.schemaVersion!=="1"||item.envelope.streamKind!=="run"||item.envelope.workspaceId!==proof.workspaceId||item.envelope.streamId!==proof.runId||item.envelope.sequence!==expectedSequence||item.envelope.priorEnvelopeHash!==prior||item.envelope.payloadHash!==domainDigest("horseness.event-payload.v1",item.envelope.payload as unknown as JsonValue)||item.envelopeHash!==domainDigest("horseness.event-envelope.v1",item.envelope as unknown as JsonValue))fail("PREDICATE_EVENT_UNAUTHENTICATED");prior=item.envelopeHash;expectedSequence+=1}
  const head=proof.replay.at(-1),replayed=proof.replay.find(item=>item.envelope.sequence===envelope.sequence);
  if(proof.workspaceId!==resultCursor.workspaceId||proof.runId!==resultCursor.runId||proof.headSequence!==resultCursor.runSequence||proof.headEnvelopeHash!==resultCursor.runEnvelopeHash||head?.envelope.sequence!==proof.headSequence||head.envelopeHash!==proof.headEnvelopeHash||proof.authorityReplayDigest!==authorityReplayDigest(proof.replay))fail("PREDICATE_EVENT_UNAUTHENTICATED");
  if(replayed===undefined||replayed.envelopeHash!==event.envelopeHash||canonicalJson(replayed.envelope)!==canonicalJson(envelope))fail("PREDICATE_EVENT_UNAUTHENTICATED");
  if(envelope.schemaVersion!=="1"||envelope.streamKind!=="run"||envelope.workspaceId!==resultCursor.workspaceId||envelope.streamId!==resultCursor.runId||envelope.sequence>resultCursor.runSequence)fail("PREDICATE_EVENT_UNAUTHENTICATED");
  if(envelope.eventType!==envelope.payload.eventType||envelope.payload.workspaceId!==resultCursor.workspaceId||envelope.payload.runId!==resultCursor.runId)fail("PREDICATE_EVENT_UNAUTHENTICATED");
  if(envelope.payloadHash!==domainDigest("horseness.event-payload.v1",envelope.payload as unknown as JsonValue)||event.envelopeHash!==domainDigest("horseness.event-envelope.v1",envelope as unknown as JsonValue))fail("PREDICATE_EVENT_UNAUTHENTICATED");
  const allowed=proof.authorizedProducers?.[envelope.eventType];if(allowed!==undefined&&!allowed.includes(envelope.principalId))fail("PREDICATE_EVENT_UNAUTHENTICATED");
  return event as VerifiedAuthorityEventV1;
}
function predicateFrom(event:VerifiedAuthorityEventV1):CompletionPredicateV1 {
  const payload=event.envelope.payload;
  switch(payload.eventType){
    case "DeltaAcceptedV1": if(payload.resultingRevision<0)return fail("PREDICATE_EVENT_INVALID");return {kind:"canonical-change",proposalDigest:payload.proposalDigest,acceptedEventDigest:event.envelopeHash,resultingRevision:payload.resultingRevision,resultingStateHash:payload.resultingStateHash};
    case "ArtifactPublishedV1": if(payload.objectDigests.length===0||payload.publicationEventDigests.length===0)return fail("PREDICATE_EVENT_INVALID");return {kind:"artifact-published",objectDigests:[...payload.objectDigests],publicationEventDigests:[...payload.publicationEventDigests]};
    case "ApprovalRecordedV1": if(!Number.isFinite(Date.parse(payload.expiresAt))||payload.evaluationCursor.workspaceId!==event.resultCursor.workspaceId||payload.evaluationCursor.runId!==event.resultCursor.runId||payload.evaluationCursor.workspaceSequence>event.resultCursor.workspaceSequence||payload.evaluationCursor.runSequence>=event.resultCursor.runSequence)return fail("PREDICATE_EVENT_INVALID");return {kind:"approval-recorded",approvalId:payload.approvalId,scopeDigest:payload.scopeDigest,evaluationCursor:payload.evaluationCursor,expiresAt:payload.expiresAt};
    case "BindingValidSelectedReceiptV1": if(!payload.bindingValid||!payload.selected||payload.outcome!=="succeeded"||payload.generation<1||!payload.receiptDigest||!payload.attemptContextBindingDigest)return fail("PREDICATE_EVENT_INVALID");return {kind:"receipt-only"};
  }
}
export function projectDurablePredicate(state:TaskProjectionV1,event:VerifiedAuthorityEventV1):TaskProjectionV1 {
  const predicate=predicateFrom(event),taskId=event.envelope.payload.taskId,current=requireTask(state,taskId,"ILLEGAL_TASK_TRANSITION");if(current.lifecycle!=="active")fail("ILLEGAL_TASK_TRANSITION");
  const identity=completionPredicateIdentity(predicate);if(!predicateIds(current.contract.completionPolicy).includes(identity))fail("PREDICATE_NOT_IN_CONTRACT");
  const next=clone(state),ids=new Set(current.durablePredicateIds);ids.add(identity);next.tasks.set(taskId,{...cloneTask(current),durablePredicateIds:ids});return next;
}
export function resolveProjectedTask(state:TaskProjectionV1,input:{taskId:string;resolution:TaskResolution;winningGeneration:number|null;eventSequence:number;eventDigest:string}):TaskProjectionV1 {
  const current=requireTask(state,input.taskId,"ILLEGAL_TASK_TRANSITION");if(current.lifecycle!=="active"||input.eventSequence<1||!input.eventDigest)fail("ILLEGAL_TASK_TRANSITION");if(!completionPolicySatisfied(current.contract.completionPolicy,current.durablePredicateIds))fail("TASK_COMPLETION_UNSATISFIED");
  const next=clone(state);next.tasks.set(input.taskId,{...cloneTask(current),lifecycle:input.resolution,resolution:input.resolution,winningGeneration:input.winningGeneration,resolutionEventSequence:input.eventSequence,resolutionDigest:input.eventDigest});return next;
}
const projectionName=(kind:TaskAuthorityComponentKindV1):string=>`task-authority/${kind}`;
function componentDigest(snapshot:TaskAuthorityComponentSnapshotV1):string {const {projectionProof:_proof,...core}=snapshot;return domainDigest("horseness.task-authority-component.v1",core as unknown as JsonValue)}
function compositeDigest(input:{schemaVersion:"1";observationCursor:CompositeCursorV1;taskId:string;components:readonly TaskAuthorityComponentSnapshotV1[]}):string {return domainDigest("horseness.task-authority-composite.v1",{schemaVersion:input.schemaVersion,observationCursor:input.observationCursor,taskId:input.taskId,componentDigests:input.components.map(component=>component.projectionProof.snapshotDigest)} as unknown as JsonValue)}
export function authenticateTaskAuthorityProjection(input:Omit<TaskAuthorityProjectionV1,typeof authenticatedTaskAuthority>):TaskAuthorityProjectionV1 {
  if(input.schemaVersion!=="1"||!input.taskId||input.components.length!==5)fail("AUTHORITY_PROOF_INVALID");
  const kinds=new Set<TaskAuthorityComponentKindV1>();
  for(const component of input.components){const kind=component.value.kind;kinds.add(kind);if(component.schemaVersion!=="1"||component.workspaceId!==input.observationCursor.workspaceId||component.runId!==input.observationCursor.runId||component.taskId!==input.taskId||canonicalJson(component.observationCursor)!==canonicalJson(input.observationCursor))fail("AUTHORITY_CURSOR_SUBSTITUTED");const proof=component.projectionProof;if(proof.schemaVersion!=="1"||proof.projectionVersion!=="1"||proof.projectionName!==projectionName(kind)||!proof.snapshotDigest||!proof.replayDigest||proof.snapshotDigest!==componentDigest(component)||proof.replayDigest!==domainDigest("horseness.task-authority-replay-proof.v1",{projectionName:proof.projectionName,projectionVersion:proof.projectionVersion,observationCursor:component.observationCursor,snapshotDigest:proof.snapshotDigest} as unknown as JsonValue))fail("AUTHORITY_PROOF_INVALID")}
  if(kinds.size!==5||input.compositeDigest!==compositeDigest(input))fail("AUTHORITY_PROOF_INVALID");return {...input,[authenticatedTaskAuthority]:true};
}
function authorityAggregate(authority:TaskAuthorityProjectionV1,cursor:CompositeCursorV1,taskId:string):{reasons:string[];contractValid:boolean;attempt:"none"|"live"|"unknown_outcome"} {
  if(authority[authenticatedTaskAuthority]!==true)fail("AUTHORITY_PROOF_INVALID");if(authority.taskId!==taskId||canonicalJson(authority.observationCursor)!==canonicalJson(cursor))fail("AUTHORITY_CURSOR_SUBSTITUTED");authenticateTaskAuthorityProjection(authority);
  const values=new Map(authority.components.map(component=>[component.value.kind,component.value]));const contract=values.get("contract") as Extract<TaskAuthorityComponentValueV1,{kind:"contract"}>,policy=values.get("policy") as Extract<TaskAuthorityComponentValueV1,{kind:"policy"}>,grant=values.get("grant-revocation") as Extract<TaskAuthorityComponentValueV1,{kind:"grant-revocation"}>,quota=values.get("quota") as Extract<TaskAuthorityComponentValueV1,{kind:"quota"}>,attempt=values.get("attempt-outcome") as Extract<TaskAuthorityComponentValueV1,{kind:"attempt-outcome"}>;
  const reasons:string[]=[];if(!contract.valid)reasons.push("CONTRACT_INVALID");if(policy.state==="denied")reasons.push("POLICY_DENIED");if(policy.state==="unknown")reasons.push("POLICY_UNKNOWN");if(grant.grantState==="denied")reasons.push("GRANT_DENIED");if(grant.grantState==="unknown")reasons.push("GRANT_UNKNOWN");if(grant.revocationState==="revoked")reasons.push("GRANT_REVOKED");if(grant.revocationState==="unknown")reasons.push("REVOCATION_UNKNOWN");if(quota.state==="exhausted")reasons.push("QUOTA_EXHAUSTED");if(quota.state==="unknown")reasons.push("QUOTA_UNKNOWN");if(attempt.state==="live")reasons.push("ATTEMPT_LIVE");if(attempt.state==="unknown_outcome")reasons.push("ATTEMPT_OUTCOME_UNKNOWN");return {reasons,contractValid:contract.valid,attempt:attempt.state};
}
export function evaluateTaskJoin(state:TaskProjectionV1,input:{taskId:string;cursor:CompositeCursorV1;authority:TaskAuthorityProjectionV1}):JoinEvaluationV1 {
  const task=requireTask(state,input.taskId);const edges=[...state.edges.values()].filter(edge=>edge.dependentTaskId===input.taskId).sort((a,b)=>a.edgeId.localeCompare(b.edgeId));const outcomes=new Map<string,DependencyOutcomeV1&{resolution:TaskResolution}>();let unknown=false,unsatisfied=false,cancellationPropagated=false;
  for(const edge of edges){const source=state.tasks.get(edge.sourceTaskId)!;const released=source.durablePredicateIds.has(edge.releasePredicate);if(!source.resolution||!source.resolutionEventSequence||!source.resolutionDigest||!released){unknown=true;continue}const outcome={edgeId:edge.edgeId,edgeType:edge.edgeType,sourceTaskId:edge.sourceTaskId,taskResolutionEventSequence:source.resolutionEventSequence,taskResolutionDigest:source.resolutionDigest,winningGeneration:source.winningGeneration,resolution:source.resolution};outcomes.set(edge.edgeId,outcome);const satisfied=edge.edgeType==="requires_terminal"||edge.edgeType==="requires_success"&&source.resolution==="succeeded"||edge.edgeType==="requires_outcome"&&edge.allowedOutcomes?.includes(source.resolution);if(!satisfied)unsatisfied=true;if(source.resolution==="cancelled"&&edge.propagateCancellation)cancellationPropagated=true}
  const aggregate=authorityAggregate(input.authority,input.cursor,input.taskId),reasons=aggregate.reasons;if(unknown)reasons.push("DEPENDENCY_UNKNOWN");if(unsatisfied)reasons.push("DEPENDENCY_UNSATISFIED");if(cancellationPropagated)reasons.push("CANCELLATION_PROPAGATED");const terminal=["succeeded","failed","cancelled"].includes(task.lifecycle);let schedulability:Schedulability;if(terminal)schedulability="terminal";else if(task.lifecycle==="draft"||!aggregate.contractValid||cancellationPropagated)schedulability="ineligible";else if(aggregate.attempt==="unknown_outcome")schedulability="unknown_outcome";else if(aggregate.attempt==="live")schedulability="running";else if(unknown||unsatisfied||reasons.some(reason=>["POLICY_DENIED","POLICY_UNKNOWN","GRANT_DENIED","GRANT_UNKNOWN","GRANT_REVOKED","REVOCATION_UNKNOWN","QUOTA_EXHAUSTED","QUOTA_UNKNOWN"].includes(reason)))schedulability="blocked";else schedulability="ready";
  const reasonCodes=[...new Set(reasons)].sort();const dependencies=[...outcomes.values()].map(({resolution:_resolution,...outcome})=>outcome);const snapshot=sealDependencyJoinSnapshot({schemaVersion:"1",runId:input.cursor.runId,taskId:input.taskId,taskContractDigest:task.contract.contractDigest,joinEvaluationId:`join:${input.taskId}:${input.cursor.workspaceSequence}:${input.cursor.runSequence}`,joinObservationCursor:input.cursor,dependencies,schedulability,reasonCodes});const authoritySnapshotIdentities=input.authority.components.map(component=>component.projectionProof.snapshotDigest);return {taskId:input.taskId,schedulability,cancellationPropagated,reasonCodes,authoritySnapshotIdentities,snapshot};
}
