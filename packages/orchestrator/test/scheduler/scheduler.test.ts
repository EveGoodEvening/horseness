import assert from "node:assert/strict";
import test from "node:test";
import { domainDigest, sealEventEnvelope, type CompositeCursorV1, type JsonValue } from "@horseness/domain";
import { activateTask, addTask, emptyTaskProjection, evaluateTaskJoin, issueStoredAuthorityEvent, issueTaskAuthorityProjection, type DurableAuthorityEventV1, type DurablePredicatePayloadV1 } from "../../src/tasks/task-projection.js";
import { selectReadyTasks } from "../../src/scheduler/index.js";

const cursor:CompositeCursorV1={schemaVersion:"1",kind:"composite",workspaceId:"w",workspaceSequence:1,workspaceEnvelopeHash:"wh",workspaceContextEpoch:0,runId:"r",runSequence:2,runEnvelopeHash:"rh",runContextEpoch:1};
const projectionValues={contract:{taskId:"t",kind:"contract",valid:true},policy:{taskId:"t",kind:"policy",state:"allowed"},"grant-revocation":{taskId:"t",kind:"grant-revocation",grantState:"allowed",revocationState:"clear"},quota:{taskId:"t",kind:"quota",state:"available"},"attempt-outcome":{taskId:"t",kind:"attempt-outcome",state:"none"}} as const;
function readerFor(record:DurableAuthorityEventV1){return {authenticatedView:()=>({cursor}),exactRunHeadSnapshot:(_workspaceId:string,_runId:string,name:string)=>name.startsWith("durable-authority-event/")?{state:record}:{state:projectionValues[name.slice("task-authority/".length) as keyof typeof projectionValues]}} as never;}
function accepted(taskId="t",proposalDigest="p"){
 const payload:DurablePredicatePayloadV1={eventType:"DeltaAcceptedV1",workspaceId:"w",runId:"r",taskId,proposalDigest,resultingRevision:1,resultingStateHash:"state"};
 const sealed=sealEventEnvelope({schemaVersion:"1",eventId:`evt-${taskId}`,streamKind:"run",workspaceId:"w",streamId:"r",sequence:2,priorEnvelopeHash:"prior",eventType:"DeltaAcceptedV1",payload,principalId:"authority",causationId:"command",correlationId:"run",idempotencyKey:`key-${taskId}`});
 const record:DurableAuthorityEventV1={envelope:sealed.envelope,envelopeHash:sealed.envelopeHash,resultCursor:cursor};
 return issueStoredAuthorityEvent(readerFor(record),{workspaceId:"w",runId:"r",sequence:2,eventType:"DeltaAcceptedV1"});
}
function join(){
 const record=accepted();const reader=readerFor(record);let state=emptyTaskProjection();state=addTask(state,{taskId:"t",contractDigest:"contract-t",completionPolicy:{schemaVersion:"1",kind:"predicate",predicate:{kind:"receipt-only"}}});state=activateTask(state,"t");return evaluateTaskJoin(state,{taskId:"t",cursor,authority:issueTaskAuthorityProjection(reader,{workspaceId:"w",runId:"r",taskId:"t"})});
}
function candidate(priority=1,sequence=1){return{taskId:"t",priority,createdSequence:sequence,join:join(),deltaAccepted:accepted(),proposalDigest:"p"};}

test("ready decisions require runtime-authenticated join and accepted capabilities",()=>{const input=candidate();const [decision]=selectReadyTasks([input]);assert.equal(decision!.decisionCode,"READY");assert.ok(decision!.authorizationKey);const [duplicate]=selectReadyTasks([input],new Set([decision!.authorizationKey!]));assert.equal(duplicate!.decisionCode,"ALREADY_AUTHORIZED");assert.throws(()=>selectReadyTasks([{...input,join:{...input.join}} as never]),/JOIN_EVALUATION_UNAUTHENTICATED/);assert.throws(()=>selectReadyTasks([{...input,deltaAccepted:{...input.deltaAccepted}} as never]),/PREDICATE_EVENT_UNVERIFIED/);});

test("cross-task or proposal-substituted acceptance cannot authorize scheduling",()=>{assert.equal(selectReadyTasks([{...candidate(),deltaAccepted:accepted("other")}])[0]!.decisionCode,"AUTHORITY_IDENTITY_MISMATCH");assert.equal(selectReadyTasks([{...candidate(),proposalDigest:"other"}])[0]!.decisionCode,"AUTHORITY_IDENTITY_MISMATCH");});

test("no authorization is produced before durable accepted authority",()=>{const [decision]=selectReadyTasks([{...candidate(),deltaAccepted:null}]);assert.equal(decision!.decisionCode,"DELTA_NOT_ACCEPTED");assert.equal(decision!.authorizationKey,null);});
