import assert from "node:assert/strict";
import test from "node:test";
import { attemptContextBindingDigest, contextManifestCoreDigest, domainDigest, emptyTaskExecutionProjectionV1, parseTaskExecutionEventV1, parseTaskExecutionProfileV1, parseTaskPlanOutputV1, reduceTaskExecutionV1, resolveTask, sealAttemptReceipt, sealDependencyJoinSnapshot, sealForkPin, sealTaskPlanV1, derivePlanAdoptionV1, taskContractDigestV2, taskExecutionProfileDigest, taskWorkflowGraphDigestV1, assertTaskWorkflowLaunchV1, assertTaskWorkflowAdoptionV1, deterministicReplay, sealEventEnvelope, type HashedEventEnvelopeV1, type TaskContractV2, type TaskExecutionPreparedDataV1, type TaskExecutionProfileV1, type CompositeCursorV1 } from "../src/index.js";
import { deriveSchedulability, evaluateDependencies, type DependencyOutcomeV1, type TaskLifecycle, type TaskResolution } from "../src/index.js";
import type { JsonValue } from "../src/index.js";

const cursor: CompositeCursorV1 = {schemaVersion:"1",kind:"composite",workspaceId:"ws",runId:"run",workspaceSequence:1,workspaceEnvelopeHash:"wh",workspaceContextEpoch:0,runSequence:1,runEnvelopeHash:"rh",runContextEpoch:0};
const version = {schemaVersion:"1" as const,kind:"composite" as const,workspaceContextEpoch:0,runContextEpoch:0,observationCursor:cursor};
const base = {workspaceId:"ws",runId:"run"};
const contract: TaskContractV2 = {schemaVersion:"2",taskId:"root",title:"Integrate",instructions:"Integrate changes",acceptanceCriteria:[],kind:"work",sourceTaskId:null,completionPolicy:{schemaVersion:"1",kind:"predicate",predicate:{kind:"receipt-only"}}};
const profile: TaskExecutionProfileV1 = {schemaVersion:"1",adapterId:"pi",hostId:"pi",hostVersion:"1",nativeExecutablePath:"/trusted/pi",nativeExecutableDigest:"executable",providerId:"provider",modelId:"concrete-model",purpose:"work",timeoutMs:1000,maxOutputBytes:1000,lookup:"local-terminal-record",idempotentLaunch:false};
function prepared(): TaskExecutionPreparedDataV1 {
  const join=sealDependencyJoinSnapshot({schemaVersion:"1",runId:"run",taskId:"root",taskContractDigest:taskContractDigestV2(contract),joinEvaluationId:"join",joinObservationCursor:cursor,dependencies:[],schedulability:"ready",reasonCodes:[]});
  const forkPin=sealForkPin({schemaVersion:"1",forkId:"fork",pinVersion:1,workspaceId:"ws",runId:"run",parentForkPinDigest:null,refreshesForkPinDigest:null,canonicalRevision:0,canonicalStateHash:"state",canonicalizerVersion:"jcs-v1",hashVersion:"sha256-v1",sourceObservationCursor:cursor,sourceContextVersion:version,dependencyJoinSnapshotDigest:join.digest,deltaAuthorityScopeDigest:"scope",pinnedPolicyDigest:"policy",ancestry:[],createdByPrincipalId:"operator",createdByGrantDigest:"grant"});
  const profileDigest=taskExecutionProfileDigest(profile);
  const renderedContext="context";
  const manifest={schemaVersion:"1" as const,workspaceId:"ws",runId:"run",attemptId:"attempt",generation:1,forkPinDigest:forkPin.forkPinDigest,sourceObservationCursor:cursor,sourceContextVersion:version,authorizationObservationCursor:cursor,authorizationContextVersion:version,authorizationOverlayV1:{policyDigest:"policy",grantDigest:"grant",quotaDigest:"quota",result:"allowed" as const},canonicalRevision:0,canonicalStateHash:"state",canonicalizerVersion:"jcs-v1" as const,hashVersion:"sha256-v1" as const,sources:[{kind:"execution-profile",digest:profileDigest,byteStart:0,byteEnd:7,priority:1}],rendererVersion:"renderer",omissions:[],selectedBytes:7,byteBudget:100,tokenizerMetadata:null,renderedOutputDigest:domainDigest("horseness.context-source-bytes.v1",Buffer.from(renderedContext).toString("base64"))};
  const binding={schemaVersion:"1" as const,attemptId:"attempt",generation:1,forkPinDigest:forkPin.forkPinDigest,contextManifestCoreDigest:contextManifestCoreDigest(manifest),sourceObservationCursor:cursor,sourceContextVersion:version,authorizationObservationCursor:cursor,authorizationContextVersion:version,providerIdempotencyKey:"key",expectedReceiptSchemaVersion:"1" as const,allowedProducerPrincipalId:"adapter",allowedProducerGrantDigest:"producer-grant"};
  return {workflowId:null,taskId:"root",attemptId:"attempt",generation:1,profile,profileDigest,forkPin,join:join.core,manifest,binding,renderedContext,evaluationClock:{schemaVersion:"1",authorityTime:"2026-01-01T00:00:00Z",observationCursor:cursor},lease:{ownerId:"owner",bootId:"boot",processId:"process",issuedAt:"2026-01-01T00:00:00Z",expiresAt:"2026-01-01T00:00:01Z",durationMs:1000,fenceToken:1,observationCursor:cursor}};
}
const planOutput={tasks:[{key:"a",title:"A",instructions:"Build A",acceptanceCriteria:["A works"],dependsOn:[]},{key:"b",title:"B",instructions:"Build B",acceptanceCriteria:["B works"],dependsOn:["a"]}]};

void test("planner schema rejects injected authority, invalid references, cycles, and unbounded graphs",()=>{
  assert.deepEqual(parseTaskPlanOutputV1(planOutput),planOutput);
  for(const key of ["adapterId","model","grants","completionPolicy","canonicalRoots","executablePath"]){assert.throws(()=>parseTaskPlanOutputV1({...planOutput,[key]:"injected"}));assert.throws(()=>parseTaskPlanOutputV1({tasks:[{...planOutput.tasks[0], [key]:"injected"}]}));}
  assert.throws(()=>parseTaskPlanOutputV1({tasks:[{...planOutput.tasks[0],dependsOn:["missing"]}]}));
  assert.throws(()=>parseTaskPlanOutputV1({tasks:[{...planOutput.tasks[0],dependsOn:["b"]},planOutput.tasks[1]]}));
  assert.throws(()=>parseTaskPlanOutputV1({tasks:Array.from({length:33},(_,i)=>({...planOutput.tasks[0],key:String(i)}))}));
  assert.throws(()=>parseTaskPlanOutputV1({tasks:[{...planOutput.tasks[0],acceptanceCriteria:[]}]}));
});
void test("adoption is deterministic and root depends on sinks without acquiring canonical authority",()=>{
  const plan=sealTaskPlanV1("root",taskContractDigestV2(contract),planOutput),adoption=derivePlanAdoptionV1(plan);
  assert.deepEqual(derivePlanAdoptionV1(plan),adoption);
  assert.equal(adoption.contracts.length,2);
  assert.equal(adoption.edges.filter(e=>e.dependentTaskId==="root").length,1);
  assert.equal((adoption.edges.find(e=>e.dependentTaskId==="root") ?? assert.fail("Expected fixture value")).sourceTaskId,(adoption.contracts[1] ?? assert.fail("Expected fixture value")).taskId);
  for (const task of adoption.contracts) assert.equal(task.completionPolicy.predicate.kind,"receipt-only");
  assert.throws(()=>derivePlanAdoptionV1({...plan,tasks:[{...(plan.tasks[0] ?? assert.fail("Expected fixture value")),instructions:"substituted"},(plan.tasks[1] ?? assert.fail("Expected fixture value"))]}));
});
void test("profile parsing closes options and binds concrete model identity",()=>{
  assert.deepEqual(parseTaskExecutionProfileV1(profile),profile);
  assert.throws(()=>parseTaskExecutionProfileV1({...profile,modelId:""}));
  assert.throws(()=>parseTaskExecutionProfileV1({...profile,launchOptions:{}}));
  assert.notEqual(taskExecutionProfileDigest(profile),taskExecutionProfileDigest({...profile,modelId:"other"}));
  assert.equal(Object.hasOwn(parseTaskExecutionProfileV1(profile), "effort"), false);
  assert.equal(taskExecutionProfileDigest(profile), domainDigest("horseness.task-execution-profile.v1", profile as unknown as JsonValue));
  const medium = { ...profile, effort: "medium" as const };
  assert.notEqual(taskExecutionProfileDigest(profile), taskExecutionProfileDigest(medium));
  assert.notEqual(taskExecutionProfileDigest(medium), taskExecutionProfileDigest({ ...profile, effort: "high" }));
  for (const effort of [undefined, null, "", "HIGH", "max", 1]) assert.throws(() => parseTaskExecutionProfileV1({ ...profile, effort }));
});
void test("prepared events bind exact rendered bytes and frozen profile manifest source",()=>{
  const p=prepared();
  assert.doesNotThrow(()=>parseTaskExecutionEventV1({...base,eventType:"TaskExecutionPreparedV1",prepared:p}));
  assert.throws(()=>parseTaskExecutionEventV1({...base,eventType:"TaskExecutionPreparedV1",prepared:{...p,renderedContext:"changed"}}));
  assert.throws(()=>parseTaskExecutionEventV1({...base,eventType:"TaskExecutionPreparedV1",prepared:{...p,profile:{...profile,modelId:"other"}}}));
  assert.throws(()=>parseTaskExecutionEventV1({...base,eventType:"TaskExecutionPreparedV1",prepared:{...p,profile:{...profile,effort:"high"}}}));
  assert.throws(()=>parseTaskExecutionEventV1({...base,eventType:"TaskExecutionPreparedV1",prepared:{...p,manifest:{...p.manifest,extraAuthority:true}}}));
  for (const lease of [{...p.lease,fenceToken:0},{...p.lease,durationMs:999},{...p.lease,issuedAt:"2026-02-30T00:00:00Z"},{...p.lease,observationCursor:{...cursor,runSequence:2}}]) assert.throws(()=>parseTaskExecutionEventV1({...base,eventType:"TaskExecutionPreparedV1",prepared:{...p,lease}}));
});
void test("receipt terminal fact is separate from task resolution and rejects observed model mismatch",()=>{
  let state=reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(),{...base,eventType:"TaskCreatedV2",contract},1);
  assert.equal(state.lifecycles.root,"draft");
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskActivatedV1",taskId:"root"},2);
  const p=prepared();state=reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionPreparedV1",prepared:p},3);
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionTransitionV1",taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,input:{type:"commit-launch-intent"}},4);
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionTransitionV1",taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,input:{type:"require-reconciliation"}},5);
  assert.throws(()=>reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionTransitionV1",taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,input:{type:"reconcile-not-found-idempotent"}},6));
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionTransitionV1",taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,input:{type:"reconcile-ambiguous"}},6);
  assert.equal((state.attempts["attempt:1"] ?? assert.fail("Expected fixture value")).state,"unknown_outcome");
  const core={schemaVersion:"1" as const,...base,taskId:"root",attemptId:"attempt",generation:1,attemptContextBindingDigest:attemptContextBindingDigest(p.binding),contextManifestCoreDigest:p.binding.contextManifestCoreDigest,forkPinDigest:p.forkPin.forkPinDigest,providerId:"pi-native-provider-v1",providerOperationId:"operation",providerIdempotencyKeyDigest:domainDigest("horseness.provider-idempotency-key.v1","key"),producerPrincipalId:"adapter",producerGrantDigest:"producer-grant",adapterId:"horseness-pi-v1",adapterVersion:"1",hostId:"pi",hostVersion:"1",outcome:"succeeded" as const,startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:01Z",outputDigest:"output",evidence:[],provenance:{profileDigest:p.profileDigest,observedHostId:"pi",observedHostVersion:"1",observedProviderId:"provider",observedModelId:"concrete-model",nativeSessionId:"session",exitCode:0},nonce:"nonce"};
  assert.throws(()=>reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionReceiptV1",taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,receipt:sealAttemptReceipt({...core,provenance:{...core.provenance,observedModelId:"other"}})},5));
  assert.throws(()=>reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionReceiptV1",taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,receipt:sealAttemptReceipt({...core,provenance:{...core.provenance,observedHostId:"other"}})},7));
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionReceiptV1",taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,receipt:sealAttemptReceipt(core)},7);
  assert.equal(state.lifecycles.root,"active");
  const resolution=(resolveTask({taskId:"root",generations:Object.values(state.attempts),retryPolicyDigest:"no-retry",retryPermitted:false,cancellationRequested:false,observationCursor:cursor}) ?? assert.fail("Expected fixture value"));
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskResolvedV2",resolution,evaluationClock:p.evaluationClock},8);
  assert.equal(state.lifecycles.root,"succeeded");
});
void test("workflow consent freezes graph before attempts and expiry/issuer/stopping prohibit launch",()=>{
  let state=reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(),{...base,eventType:"TaskCreatedV2",contract},1);
  const authorization={schemaVersion:"1" as const,...base,workflowId:"workflow",operationKind:"execute" as const,requestDigest:"request",planningSource:null,parentWorkflowId:null,targetTaskId:"root",targetContractDigest:taskContractDigestV2(contract),issuerPrincipalId:"operator",issuerGrantDigest:"grant",expiresAt:"2026-01-02T00:00:00Z",executionProfile:profile,plannerProfile:null,autoPlan:false,graphDigest:taskWorkflowGraphDigestV1([contract],[]),planDigest:null};
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowStartedV1",authorization},2);
  assert.doesNotThrow(() => { assertTaskWorkflowLaunchV1(state,"workflow","root","2026-01-01T00:00:00Z","operator","grant"); });
  assert.throws(() => { assertTaskWorkflowLaunchV1(state,"workflow","root","2026-01-02T00:00:00Z","operator","grant"); });
  assert.throws(() => { assertTaskWorkflowLaunchV1(state,"workflow","root","2026-01-01T00:00:00Z","other","grant"); });
  assert.throws(()=>reduceTaskExecutionV1(state,{...base,eventType:"DependencyAddedV1",edge:{edgeId:"changed",sourceTaskId:"root",dependentTaskId:"root",edgeType:"requires_success",releasePredicate:"task-resolution",propagateCancellation:true}},3));
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowStoppedV1",workflowId:"workflow",state:"cancelled",reasonCode:"TASK_CANCELLED"},3);
  assert.throws(() => { assertTaskWorkflowLaunchV1(state,"workflow","root","2026-01-01T00:00:00Z","operator","grant"); });
});

void test("atomic adoption creates only receipt work and exact adoption replay is idempotent",()=>{
  let state=reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(),{...base,eventType:"TaskCreatedV2",contract},1);
  const plan=sealTaskPlanV1("root",taskContractDigestV2(contract),planOutput);
  state={...state,plans:{[plan.planDigest]:plan}};
  const event={...base,eventType:"TaskPlanAdoptedV1" as const,taskId:"root",planDigest:plan.planDigest};
  state=reduceTaskExecutionV1(state,event,2);
  assert.equal(state.lifecycles.root,"draft");
  assert.deepEqual(reduceTaskExecutionV1(state,event,3),state);
  const other=sealTaskPlanV1("root",taskContractDigestV2(contract),{tasks:[{...(planOutput.tasks[0] ?? assert.fail("Expected fixture value")),instructions:"other"}]});
  assert.throws(()=>reduceTaskExecutionV1({...state,plans:{...state.plans,[other.planDigest]:other}},{...event,planDigest:other.planDigest},3));
});
void test("historical V1 creation and resolution replay beside V2 without canonical mutation",()=>{
  const payloads=[
    {eventType:"RunCreatedV1",...base,initialDocument:{value:1},canonicalizerVersion:"jcs-v1",hashVersion:"sha256-v1"},
    {eventType:"TaskCreatedV1",...base,taskId:"legacy",title:"Legacy work",completionPolicy:contract.completionPolicy},
    {eventType:"TaskResolvedV1",...base,taskId:"legacy",resolution:"succeeded",evaluationClock:prepared().evaluationClock},
    {eventType:"TaskCreatedV1",...base,taskId:"legacy-whitespace",title:" ",completionPolicy:contract.completionPolicy},
    {eventType:"TaskCreatedV2",...base,contract},
  ];
  const events:HashedEventEnvelopeV1<unknown>[]=[];
  let priorEnvelopeHash:string|null=null;
  for(const [index,payload] of payloads.entries()){
    const sealed:HashedEventEnvelopeV1<unknown>=sealEventEnvelope({schemaVersion:"1",streamKind:"run",workspaceId:"ws",streamId:"run",sequence:index+1,eventId:`event-${String(index)}`,eventType:payload.eventType,principalId:"authority",causationId:"cause",correlationId:"correlation",idempotencyKey:`key-${String(index)}`,priorEnvelopeHash,payload});
    events.push(sealed);priorEnvelopeHash=sealed.envelopeHash;
  }
  const replay=deterministicReplay(events);
  assert.equal(replay.canonical.revision,0);
  assert.deepEqual(replay.canonical.document,{value:1});
  assert.equal((replay.operational.execution.contracts.legacy ?? assert.fail("Expected fixture value")).instructions,"Legacy work");
  assert.equal((replay.operational.execution.contracts["legacy-whitespace"] ?? assert.fail("Expected fixture value")).instructions," ");
  assert.equal(replay.operational.execution.lifecycles.legacy,"succeeded");
  assert.equal(replay.operational.execution.lifecycles.root,"draft");
  assert.deepEqual(deterministicReplay(events),replay);
});

void test("automatic consent binds the adopted graph and stopped parent prevents planner continuation",()=>{
  let state=reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(),{...base,eventType:"TaskCreatedV2",contract},1);
  const plannerProfile={...profile,purpose:"planner" as const};
  const authorization={schemaVersion:"1" as const,...base,workflowId:"auto",operationKind:"execute" as const,requestDigest:"request",planningSource:{taskId:"root",contractDigest:taskContractDigestV2(contract)},parentWorkflowId:null,targetTaskId:"root",targetContractDigest:taskContractDigestV2(contract),issuerPrincipalId:"operator",issuerGrantDigest:"grant",expiresAt:"2026-01-02T00:00:00Z",executionProfile:profile,plannerProfile,autoPlan:true,graphDigest:null,planDigest:null};
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowStartedV1",authorization},2);
  const planner={...contract,taskId:"planner",kind:"planner" as const,sourceTaskId:"root"};
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskCreatedV2",contract:planner},3);
  const child={...authorization,workflowId:"planning",operationKind:"breakdown" as const,requestDigest:"planner-request",parentWorkflowId:"auto",targetTaskId:"planner",targetContractDigest:taskContractDigestV2(planner),executionProfile:plannerProfile,plannerProfile:null,autoPlan:false,graphDigest:taskWorkflowGraphDigestV1([planner],[])};
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowStartedV1",authorization:child},4);
  assert.doesNotThrow(() => { assertTaskWorkflowLaunchV1(state,"planning","planner","2026-01-01T00:00:00Z","operator","grant"); });
  const stopped=reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowStoppedV1",workflowId:"auto",state:"cancelled",reasonCode:"TASK_CANCELLED"},5);
  assert.throws(() => { assertTaskWorkflowLaunchV1(stopped,"planning","planner","2026-01-01T00:00:00Z","operator","grant"); });
  const plan=sealTaskPlanV1("root",taskContractDigestV2(contract),planOutput);
  assert.doesNotThrow(() => { assertTaskWorkflowAdoptionV1(state,"auto",plan,"2026-01-01T00:00:00Z","operator","grant"); });
  assert.throws(() => { assertTaskWorkflowAdoptionV1(state,"auto",plan,"2026-01-02T00:00:00Z","operator","grant"); });
  assert.throws(() => { assertTaskWorkflowAdoptionV1(state,"auto",plan,"2026-01-01T00:00:00Z","operator","revoked-grant"); });
  state={...state,plans:{[plan.planDigest]:plan}};
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskPlanAdoptedV1",taskId:"root",planDigest:plan.planDigest},5);
  const adopted=derivePlanAdoptionV1(plan),closureContracts=[contract,...adopted.contracts];
  const graphDigest=taskWorkflowGraphDigestV1(closureContracts,adopted.edges);
  assert.throws(()=>reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowPlanBoundV1",workflowId:"auto",planDigest:plan.planDigest,graphDigest:"substituted"},6));
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowPlanBoundV1",workflowId:"auto",planDigest:plan.planDigest,graphDigest},6);
  assert.doesNotThrow(() => { assertTaskWorkflowLaunchV1(state,"auto",(adopted.contracts[0] ?? assert.fail("Expected fixture value")).taskId,"2026-01-01T00:00:00Z","operator","grant"); });
  assert.throws(() => { assertTaskWorkflowLaunchV1(state,"auto","planner","2026-01-01T00:00:00Z","operator","grant"); });
});

void test("planner outcomes are associated per planner and immutable across retries",()=>{
  let state=reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(),{...base,eventType:"TaskCreatedV2",contract},1);
  for(const taskId of ["rejected","first","second","third"]){
    state=reduceTaskExecutionV1(state,{...base,eventType:"TaskCreatedV2",contract:{...contract,taskId,kind:"planner",sourceTaskId:"root"}},2);
  }
  // The planner-result boundary consumes an already resolved successful planner.
  state={...state,lifecycles:{...state.lifecycles,first:"succeeded",second:"succeeded",third:"succeeded"}};
  const rejection={...base,eventType:"TaskPlanRejectedV1" as const,taskId:"root",plannerTaskId:"rejected",reasonCode:"PLAN_INVALID"};
  state=reduceTaskExecutionV1(state,rejection,3);
  assert.deepEqual(reduceTaskExecutionV1(state,rejection,4),state);
  assert.throws(()=>reduceTaskExecutionV1(state,{...rejection,reasonCode:"OTHER"},4),/PLAN_OUTCOME_CONFLICT/);
  const plan=sealTaskPlanV1("root",taskContractDigestV2(contract),planOutput);
  const proposal={...base,eventType:"TaskPlanProposedV1" as const,plannerTaskId:"first",plan};
  state=reduceTaskExecutionV1(state,proposal,4);
  assert.equal(state.planRejections.root,undefined);
  assert.equal(state.planRejectionsByPlanner.rejected,"PLAN_INVALID");
  assert.deepEqual(reduceTaskExecutionV1(state,proposal,5),state);
  assert.deepEqual(reduceTaskExecutionV1(state,rejection,5),state);
  const other=sealTaskPlanV1("root",taskContractDigestV2(contract),{tasks:[{...(planOutput.tasks[0] ?? assert.fail("Expected fixture value")),instructions:"Different preview"}]});
  assert.throws(()=>reduceTaskExecutionV1(state,{...proposal,plan:other},5),/PLAN_OUTCOME_CONFLICT/);
  assert.throws(()=>reduceTaskExecutionV1(state,{...rejection,plannerTaskId:"first"},5),/PLAN_OUTCOME_CONFLICT/);
  assert.throws(()=>reduceTaskExecutionV1({...state,lifecycles:{...state.lifecycles,rejected:"succeeded"}},{...proposal,plannerTaskId:"rejected"},5),/PLAN_OUTCOME_CONFLICT/);
  assert.equal(state.latestPlansByTask.root,plan.planDigest);
  state=reduceTaskExecutionV1(state,{...proposal,plannerTaskId:"second",plan:other},5);
  assert.equal(state.latestPlansByTask.root,other.planDigest);
  assert.deepEqual(reduceTaskExecutionV1(state,proposal,6),state);
  state=reduceTaskExecutionV1(state,{...proposal,plannerTaskId:"third"},6);
  assert.equal(state.latestPlansByTask.root,plan.planDigest);
  assert.deepEqual(reduceTaskExecutionV1(state,{...proposal,plannerTaskId:"second",plan:other},7),state);
  assert.deepEqual(state.plansByPlanner,{first:plan.planDigest,second:other.planDigest,third:plan.planDigest});
  assert.deepEqual(state.plans,{[plan.planDigest]:plan,[other.planDigest]:other});
});

void test("pre-handoff abort resolves atomically with workflow stop and never creates a receipt",()=>{
  let state=reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(),{...base,eventType:"TaskCreatedV2",contract},1);
  const authorization={schemaVersion:"1" as const,...base,workflowId:"workflow",operationKind:"dispatch" as const,requestDigest:"request",planningSource:null,parentWorkflowId:null,targetTaskId:"root",targetContractDigest:taskContractDigestV2(contract),issuerPrincipalId:"operator",issuerGrantDigest:"grant",expiresAt:"2026-01-02T00:00:00Z",executionProfile:profile,plannerProfile:null,autoPlan:false,graphDigest:taskWorkflowGraphDigestV1([contract],[]),planDigest:null};
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowStartedV1",authorization},2);
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskActivatedV1",taskId:"root"},3);
  const p={...prepared(),workflowId:"workflow"};
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionPreparedV1",prepared:p},4);
  const abort={...base,eventType:"TaskExecutionAbortedV1" as const,taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,reasonCode:"AUTHORIZATION_REVOKED",evaluationClock:p.evaluationClock};
  const handedOff=reduceTaskExecutionV1(state,{...base,eventType:"TaskExecutionTransitionV1",taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,input:{type:"commit-launch-intent"}},5);
  assert.throws(()=>reduceTaskExecutionV1(handedOff,abort,6),/ABORT_POST_HANDOFF/);
  const before=state;
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskWorkflowStoppedV1",workflowId:"workflow",state:"revoked",reasonCode:"AUTHORIZATION_REVOKED"},5);
  state=reduceTaskExecutionV1(state,abort,6);
  assert.equal(state.lifecycles.root,"active");
  assert.deepEqual(state.aborted,{"attempt:1":{reasonCode:"AUTHORIZATION_REVOKED",eventSequence:6}});
  assert.deepEqual(state.receipts,{});
  assert.equal((state.attempts["attempt:1"] ?? assert.fail("Expected fixture value")).terminalEventSequence,6);
  assert.throws(()=>reduceTaskExecutionV1(state,abort,7),/ABORT_POST_HANDOFF/);
  const receipt=sealAttemptReceipt({schemaVersion:"1",...base,taskId:"root",attemptId:"attempt",generation:1,attemptContextBindingDigest:attemptContextBindingDigest(p.binding),contextManifestCoreDigest:p.binding.contextManifestCoreDigest,forkPinDigest:p.forkPin.forkPinDigest,providerId:"pi-native-provider-v1",providerOperationId:"operation",providerIdempotencyKeyDigest:domainDigest("horseness.provider-idempotency-key.v1","key"),producerPrincipalId:"adapter",producerGrantDigest:"producer-grant",adapterId:"horseness-pi-v1",adapterVersion:"1",hostId:"pi",hostVersion:"1",outcome:"succeeded",startedAt:"2026-01-01T00:00:00Z",finishedAt:"2026-01-01T00:00:01Z",outputDigest:"output",evidence:[],nonce:"unlaunched-receipt",provenance:{profileDigest:p.profileDigest,observedHostId:"pi",observedHostVersion:"1",observedProviderId:"provider",observedModelId:"concrete-model",nativeSessionId:"operation",exitCode:0}});
  const receiptEvent={...base,eventType:"TaskExecutionReceiptV1" as const,taskId:"root",attemptId:"attempt",generation:1,profileDigest:p.profileDigest,receipt};
  assert.throws(()=>reduceTaskExecutionV1(before,receiptEvent,5),/RECEIPT_PRE_HANDOFF/);
  assert.throws(()=>reduceTaskExecutionV1(state,receiptEvent,7),/RECEIPT_PRE_HANDOFF/);
  const resolution=(resolveTask({taskId:"root",generations:Object.values(state.attempts),retryPolicyDigest:"no-retry",retryPermitted:false,cancellationRequested:true,observationCursor:cursor}) ?? assert.fail("Expected fixture value"));
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskResolvedV2",resolution,evaluationClock:p.evaluationClock},7);
  assert.equal(state.lifecycles.root,"cancelled");
  assert.deepEqual((state.resolutions.root ?? assert.fail("Expected fixture value")).consideredGenerationOutcomes,[{generation:1,outcome:"cancelled",terminalEventSequence:6}]);
  assert.deepEqual(state.receipts,{});
  assert.throws(()=>reduceTaskExecutionV1(state,receiptEvent,8),/RECEIPT_PRE_HANDOFF/);
  const payloads=[
    {eventType:"RunCreatedV1",...base,initialDocument:{value:1},canonicalizerVersion:"jcs-v1",hashVersion:"sha256-v1"},
    {...base,eventType:"TaskCreatedV2",contract},
    {...base,eventType:"TaskWorkflowStartedV1",authorization},
    {...base,eventType:"TaskActivatedV1",taskId:"root"},
    {...base,eventType:"TaskExecutionPreparedV1",prepared:p},
    {...base,eventType:"TaskWorkflowStoppedV1",workflowId:"workflow",state:"revoked",reasonCode:"AUTHORIZATION_REVOKED"},
    abort,
  ];
  const events:HashedEventEnvelopeV1<unknown>[]=[];
  let priorEnvelopeHash:string|null=null;
  for(const [index,payload] of payloads.entries()){
    const sealed:HashedEventEnvelopeV1<unknown>=sealEventEnvelope({schemaVersion:"1",streamKind:"run",workspaceId:"ws",streamId:"run",sequence:index+1,eventId:`abort-event-${String(index)}`,eventType:payload.eventType,principalId:"authority",causationId:"cause",correlationId:"correlation",idempotencyKey:`abort-key-${String(index)}`,priorEnvelopeHash,payload});
    events.push(sealed);priorEnvelopeHash=sealed.envelopeHash;
  }
  const replay=deterministicReplay(events);
  assert.deepEqual(deterministicReplay(events),replay);
  assert.deepEqual(replay.operational.execution.aborted,{"attempt:1":{reasonCode:"AUTHORIZATION_REVOKED",eventSequence:7}});
  assert.deepEqual(replay.operational.execution.receipts,{});
  assert.equal((replay.operational.execution.attempts["attempt:1"] ?? assert.fail("Expected fixture value")).state,"cancelled");
});

const branchingPlanOutput = {tasks:[
  {key:"a",title:"a",instructions:"Build A",acceptanceCriteria:["A works"],dependsOn:[]},
  {key:"b",title:"b",instructions:"Build B",acceptanceCriteria:["B works"],dependsOn:[]},
  {key:"c",title:"c",instructions:"Join A and B",acceptanceCriteria:["C works"],dependsOn:["a","b"]},
  {key:"d",title:"d",instructions:"Extend A",acceptanceCriteria:["D works"],dependsOn:["a"]},
  {key:"e",title:"e",instructions:"Join C and D",acceptanceCriteria:["E works"],dependsOn:["c","d"]},
  {key:"f",title:"f",instructions:"Extend B",acceptanceCriteria:["F works"],dependsOn:["b"]},
]};

void test("multi-root diamond adoption preserves every dependency and attaches only sinks to the objective",()=>{
  const plan=sealTaskPlanV1("root",taskContractDigestV2(contract),branchingPlanOutput);
  const before=structuredClone(plan);
  const adoption=derivePlanAdoptionV1(plan);
  const names=new Map(adoption.contracts.map(task=>[task.taskId,task.title]));
  names.set("root","root");
  assert.deepEqual(adoption.edges.map(edge=>{
    const source=names.get(edge.sourceTaskId) ?? assert.fail("Unknown dependency source");
    const dependent=names.get(edge.dependentTaskId) ?? assert.fail("Unknown dependency target");
    return `${source}->${dependent}`;
  }).sort(),["a->c","a->d","b->c","b->f","c->e","d->e","e->root","f->root"]);
  assert.equal(new Set(adoption.edges.map(edge=>edge.edgeId)).size,8);
  for(const [index,task] of adoption.contracts.entries()){
    const item=branchingPlanOutput.tasks[index] ?? assert.fail("Missing plan task");
    assert.deepEqual(task,{schemaVersion:"2",taskId:task.taskId,title:item.title,instructions:item.instructions,acceptanceCriteria:item.acceptanceCriteria,kind:"work",sourceTaskId:"root",completionPolicy:{schemaVersion:"1",kind:"predicate",predicate:{kind:"receipt-only"}}});
  }
  for(const edge of adoption.edges){
    assert.equal(edge.edgeType,"requires_success");
    assert.equal(edge.releasePredicate,"task-resolution");
    assert.equal(edge.propagateCancellation,true);
  }
  let source=reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(),{...base,eventType:"TaskCreatedV2",contract},1);
  source={...source,plans:{[plan.planDigest]:plan}};
  const snapshot=structuredClone(source);
  const adopted=reduceTaskExecutionV1(source,{...base,eventType:"TaskPlanAdoptedV1",taskId:"root",planDigest:plan.planDigest},2);
  assert.deepEqual(adopted.edges,adoption.edges);
  assert.deepEqual(adopted.adopted[plan.planDigest],adoption.contracts.map(task=>task.taskId));
  assert.deepEqual(adopted.lifecycles,Object.fromEntries(["root",...adoption.contracts.map(task=>task.taskId)].map(id=>[id,"draft"])));
  assert.deepEqual(source,snapshot);
  assert.deepEqual(plan,before);
});

void test("branching dependency frontiers release only on success and report cancellation separately",()=>{
  const adoption=derivePlanAdoptionV1(sealTaskPlanV1("root",taskContractDigestV2(contract),branchingPlanOutput));
  const names=new Map(adoption.contracts.map(task=>[task.taskId,task.title]));
  names.set("root","root");
  const evaluate=(name:string,resolutions:Readonly<Record<string,TaskResolution>>)=>{
    const edges=adoption.edges.filter(edge=>names.get(edge.dependentTaskId)===name);
    const outcomes=new Map<string,DependencyOutcomeV1 & {resolution:TaskResolution}>();
    for(const edge of edges){
      const resolution=resolutions[names.get(edge.sourceTaskId) ?? assert.fail("Missing source")];
      if(resolution) outcomes.set(edge.edgeId,{edgeId:edge.edgeId,edgeType:edge.edgeType,sourceTaskId:edge.sourceTaskId,taskResolutionEventSequence:10,taskResolutionDigest:`resolution-${edge.sourceTaskId}`,winningGeneration:resolution==="succeeded"?1:null,resolution});
    }
    return evaluateDependencies(edges,outcomes);
  };
  const frontier=(resolutions:Readonly<Record<string,TaskResolution>>)=>[...names.values()].filter(name=>{
    const dependencies=evaluate(name,resolutions);
    const lifecycle:TaskLifecycle=resolutions[name] ?? "active";
    return deriveSchedulability({lifecycle,contractValid:true,dependenciesSatisfied:dependencies.satisfied,hasUnknownDependency:dependencies.unknown,cancellationPropagated:dependencies.cancellationPropagated,authorizationAllowed:true,quotaAllowed:true,liveAttempt:false,unknownOutcome:false})==="ready";
  }).sort();
  assert.deepEqual(frontier({}),["a","b"]);
  assert.deepEqual(frontier({a:"succeeded"}),["b","d"]);
  assert.deepEqual(frontier({a:"succeeded",b:"succeeded"}),["c","d","f"]);
  assert.deepEqual(frontier({a:"succeeded",b:"succeeded",c:"succeeded"}),["d","f"]);
  assert.deepEqual(frontier({a:"succeeded",b:"succeeded",c:"succeeded",d:"succeeded"}),["e","f"]);
  assert.deepEqual(frontier({a:"succeeded",b:"succeeded",c:"succeeded",d:"succeeded",e:"succeeded"}),["f"]);
  assert.deepEqual(frontier({a:"succeeded",b:"succeeded",c:"succeeded",d:"succeeded",e:"succeeded",f:"succeeded"}),["root"]);
  assert.deepEqual(evaluate("c",{a:"failed"}),{satisfied:false,unknown:true,cancellationPropagated:false,reasonCodes:["DEPENDENCY_UNKNOWN","DEPENDENCY_UNSATISFIED"]});
  assert.deepEqual(evaluate("c",{a:"cancelled",b:"succeeded"}),{satisfied:false,unknown:false,cancellationPropagated:true,reasonCodes:["CANCELLATION_PROPAGATED","DEPENDENCY_UNSATISFIED"]});
  assert.deepEqual(frontier({a:"failed",b:"succeeded"}),["f"]);
  assert.deepEqual(frontier({a:"cancelled",b:"succeeded"}),["f"]);
  assert.deepEqual(frontier({a:"succeeded",b:"succeeded",c:"succeeded",d:"succeeded",e:"failed",f:"succeeded"}),[]);
  assert.deepEqual(frontier({a:"succeeded",b:"succeeded",c:"succeeded",d:"succeeded",e:"cancelled",f:"succeeded"}),[]);
});

void test("planner graph size accepts exact endpoints and rejects adjacent out-of-range sizes",()=>{
  const tasks=Array.from({length:32},(_,index)=>({key:String(index),title:`Task ${String(index)}`,instructions:"Perform work",acceptanceCriteria:["Work complete"],dependsOn:index===0?[]:[String(index-1)]}));
  assert.deepEqual(parseTaskPlanOutputV1({tasks:tasks.slice(0,1)}),{tasks:tasks.slice(0,1)});
  assert.deepEqual(parseTaskPlanOutputV1({tasks}),{tasks});
  const adoption=derivePlanAdoptionV1(sealTaskPlanV1("root",taskContractDigestV2(contract),{tasks}));
  assert.equal(adoption.contracts.length,32);
  assert.equal(adoption.edges.length,32);
  assert.deepEqual(adoption.edges.filter(edge=>edge.dependentTaskId==="root").map(edge=>edge.sourceTaskId),[adoption.contracts[31]?.taskId]);
  assert.throws(()=>parseTaskPlanOutputV1({tasks:[]}),/PLAN_INVALID/);
  assert.throws(()=>parseTaskPlanOutputV1({tasks:[...tasks,{...tasks[0],key:"32"}]}),/PLAN_INVALID/);
});

void test("objective preparation requires both adopted sink resolutions, not terminal lifecycles or failed sinks",()=>{
  const plan=sealTaskPlanV1("root",taskContractDigestV2(contract),branchingPlanOutput);
  let state=reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(),{...base,eventType:"TaskCreatedV2",contract},1);
  state=reduceTaskExecutionV1({...state,plans:{[plan.planDigest]:plan}},{...base,eventType:"TaskPlanAdoptedV1",taskId:"root",planDigest:plan.planDigest},2);
  state=reduceTaskExecutionV1(state,{...base,eventType:"TaskActivatedV1",taskId:"root"},3);
  const sinks=state.edges.filter(edge=>edge.dependentTaskId==="root");
  const resolutionFor=(taskId:string,outcome:TaskResolution)=>resolveTask({taskId,generations:[{attemptId:`attempt-${taskId}`,generation:1,state:outcome,bindingDigest:"binding",idempotencyKeyDigest:"key",providerHandle:"handle",terminalEventSequence:4,findingCodes:[]}],retryPolicyDigest:"no-retry",retryPermitted:false,cancellationRequested:outcome==="cancelled",observationCursor:cursor}) ?? assert.fail("Expected terminal resolution");
  const resolutions=Object.fromEntries(sinks.map(edge=>[edge.sourceTaskId,resolutionFor(edge.sourceTaskId,"succeeded")]));
  const p=prepared();
  const join=sealDependencyJoinSnapshot({...p.join,dependencies:sinks.map(edge=>({edgeId:edge.edgeId,edgeType:edge.edgeType,sourceTaskId:edge.sourceTaskId,taskResolutionEventSequence:4,taskResolutionDigest:`resolution-${edge.sourceTaskId}`,winningGeneration:1}))});
  const forkPin=sealForkPin({...p.forkPin.core,dependencyJoinSnapshotDigest:join.digest});
  const manifest={...p.manifest,forkPinDigest:forkPin.forkPinDigest};
  const bound={...p,join:join.core,forkPin,manifest,binding:{...p.binding,forkPinDigest:forkPin.forkPinDigest,contextManifestCoreDigest:contextManifestCoreDigest(manifest)}};
  const event={...base,eventType:"TaskExecutionPreparedV1" as const,prepared:bound};
  const before=structuredClone(state);
  assert.throws(()=>reduceTaskExecutionV1(state,event,5),/TASK_NOT_READY/);
  const first=sinks[0] ?? assert.fail("Missing first sink");
  const second=sinks[1] ?? assert.fail("Missing second sink");
  assert.throws(()=>reduceTaskExecutionV1({...state,resolutions:{[first.sourceTaskId]:resolutions[first.sourceTaskId] ?? assert.fail("Missing resolution")}},event,5),/TASK_NOT_READY/);
  for(const outcome of ["failed","cancelled"] as const){
    const blocked={...state,resolutions:{...resolutions,[second.sourceTaskId]:resolutionFor(second.sourceTaskId,outcome)}};
    const snapshot=structuredClone(blocked);
    assert.throws(()=>reduceTaskExecutionV1(blocked,event,5),/TASK_NOT_READY/);
    assert.deepEqual(blocked,snapshot);
  }
  // Terminal lifecycle facts alone do not constitute dependency release.
  const terminalOnly={...state,lifecycles:{...state.lifecycles,...Object.fromEntries(sinks.map(edge=>[edge.sourceTaskId,"succeeded" as const]))}};
  assert.throws(()=>reduceTaskExecutionV1(terminalOnly,event,5),/TASK_NOT_READY/);
  const ready={...state,resolutions};
  const readyBefore=structuredClone(ready);
  const launched=reduceTaskExecutionV1(ready,event,5);
  assert.equal(launched.attempts["attempt:1"]?.state,"planned");
  assert.deepEqual(launched.prepared["attempt:1"],bound);
  assert.deepEqual(ready,readyBefore);
  assert.deepEqual(state,before);
});

function revisionFixture() {
  let state = reduceTaskExecutionV1(emptyTaskExecutionProjectionV1(), { ...base, eventType: "TaskCreatedV2", contract }, 1);
  state = reduceTaskExecutionV1(state, { ...base, eventType: "TaskCreatedV2", contract: { ...contract, taskId: "planner", kind: "planner", sourceTaskId: "root" } }, 2);
  const plan = sealTaskPlanV1("root", taskContractDigestV2(contract), planOutput);
  state = reduceTaskExecutionV1({ ...state, lifecycles: { ...state.lifecycles, planner: "succeeded" } }, { ...base, eventType: "TaskPlanProposedV1", plannerTaskId: "planner", plan }, 3);
  const revised = sealTaskPlanV1("root", plan.sourceContractDigest, { tasks: [
    { key: "a", title: "Revised A", instructions: "Build a smaller A", acceptanceCriteria: ["A satisfies the revised contract"], dependsOn: ["c"] },
    { key: "c", title: "New prerequisite", instructions: "Prepare C instead of B", acceptanceCriteria: ["C is ready"], dependsOn: [] },
  ] });
  return { state, plan, revised, event: { ...base, eventType: "TaskPlanRevisedV1" as const, basePlanDigest: plan.planDigest, plan: revised } };
}

void test("revision preserves the original planner preview and only the reviewed adoption creates changed work", () => {
  const { state, plan, revised, event } = revisionFixture(), before = structuredClone(state);
  const next = reduceTaskExecutionV1(state, event, 4);
  assert.deepEqual(state, before);
  assert.deepEqual(next.plans[plan.planDigest], plan);
  assert.deepEqual(next.plans[revised.planDigest], revised);
  assert.equal(next.latestPlansByTask.root, revised.planDigest);
  assert.deepEqual(next.plansByPlanner, { planner: plan.planDigest });
  assert.deepEqual(next.contracts, state.contracts);
  assert.deepEqual(next.edges, []);
  assert.deepEqual(next.adopted, {});
  assert.deepEqual(next.attempts, {});
  const adopted = reduceTaskExecutionV1(next, { ...base, eventType: "TaskPlanAdoptedV1", taskId: "root", planDigest: revised.planDigest }, 5);
  const children = Object.values(adopted.contracts).filter(task => task.sourceTaskId === "root" && task.kind === "work");
  assert.deepEqual(children.map(task => ({ title: task.title, instructions: task.instructions, acceptanceCriteria: task.acceptanceCriteria })), revised.tasks.map(({ title, instructions, acceptanceCriteria }) => ({ title, instructions, acceptanceCriteria })));
  const a = children.find(task => task.title === "Revised A"), c = children.find(task => task.title === "New prerequisite");
  assert.ok(a); assert.ok(c);
  assert.deepEqual(adopted.edges.map(edge => [edge.sourceTaskId, edge.dependentTaskId]), [[c.taskId, a.taskId], [a.taskId, "root"]]);
  assert.equal(adopted.lifecycles.root, "draft");
  assert.deepEqual(adopted.workflows, {});
});

void test("revision refuses stale, adopted, active, cancelled, foreign and changed-source plans without mutation", () => {
  const { state, plan, event } = revisionFixture();
  const revised = reduceTaskExecutionV1(state, event, 4);
  assert.throws(() => reduceTaskExecutionV1(revised, event, 5), /PLAN_STALE/);
  const adopted = reduceTaskExecutionV1(state, { ...base, eventType: "TaskPlanAdoptedV1", taskId: "root", planDigest: plan.planDigest }, 4);
  assert.throws(() => reduceTaskExecutionV1(adopted, event, 5), /PLAN_ALREADY_ADOPTED/);
  for (const lifecycle of ["active", "cancelled", "failed", "succeeded"] as const) assert.throws(() => reduceTaskExecutionV1({ ...state, lifecycles: { ...state.lifecycles, root: lifecycle } }, event, 4), /TASK_NOT_DRAFT/);
  assert.throws(() => reduceTaskExecutionV1(state, { ...event, basePlanDigest: "missing" }, 4), /PLAN_NOT_FOUND/);
  const foreign = sealTaskPlanV1("planner", plan.sourceContractDigest, planOutput);
  assert.throws(() => reduceTaskExecutionV1(state, { ...event, plan: foreign }, 4), /PLAN_NOT_FOUND/);
  assert.throws(() => reduceTaskExecutionV1({ ...state, contracts: { ...state.contracts, root: { ...contract, instructions: "Changed objective" } } }, event, 4), /PLAN_SOURCE_CHANGED/);
  const substituted = sealTaskPlanV1("root", "different-contract", planOutput);
  assert.throws(() => reduceTaskExecutionV1(state, { ...event, plan: substituted }, 4), /PLAN_SOURCE_CHANGED/);
  assert.throws(() => reduceTaskExecutionV1(state, { ...event, plan: { ...event.plan, tasks: planOutput.tasks } }, 4), /PLAN_INVALID/);
  assert.deepEqual(state.plans, { [plan.planDigest]: plan });
  assert.deepEqual(state.adopted, {});
});

void test("revision cannot change a graph covered by active execution or planning consent", () => {
  const { state, event } = revisionFixture();
  for (const operationKind of ["execute", "breakdown"] as const) {
    const target = operationKind === "execute" ? contract : state.contracts.planner;
    assert.ok(target);
    const executionProfile = { ...profile, purpose: target.kind };
    const authorization = { schemaVersion: "1" as const, ...base, workflowId: "workflow", operationKind, requestDigest: "request", planningSource: { taskId: "root", contractDigest: taskContractDigestV2(contract) }, parentWorkflowId: null, targetTaskId: target.taskId, targetContractDigest: taskContractDigestV2(target), issuerPrincipalId: "operator", issuerGrantDigest: "grant", expiresAt: "2026-01-02T00:00:00Z", executionProfile, plannerProfile: operationKind === "execute" ? { ...profile, purpose: "planner" as const } : null, autoPlan: operationKind === "execute", graphDigest: operationKind === "execute" ? null : taskWorkflowGraphDigestV1([target], []), planDigest: null };
    const planningState = { ...state, lifecycles: { ...state.lifecycles, planner: "draft" as const } };
    const active = reduceTaskExecutionV1(planningState, { ...base, eventType: "TaskWorkflowStartedV1", authorization }, 4), snapshot = structuredClone(active);
    assert.throws(() => reduceTaskExecutionV1(active, event, 5), /WORKFLOW_ALREADY_RUNNING/);
    assert.deepEqual(active, snapshot);
  }
});
