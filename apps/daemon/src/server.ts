import { DomainError, canonicalJson, createRunGenesis, deterministicReplay, deterministicWorkspaceReplay, domainDigest, parseTaskContractV2, sealEventEnvelope, taskContractDigestV2, workflowDomainErrorV1, type AttemptReceiptEnvelopeV1, type CompositeCursorV1, type JsonValue, type NativeTaskAdapterIdV1 } from "@horseness/domain";
import { failureResponse, parseJsonRpcRequestV1, protocolError, successResponse, type AuthenticatedContextV1, type CoordinatorBodyV1, type JsonRpcRequestV1, type JsonRpcResponseV1, type ProtocolMethodV1 } from "@horseness/protocol";
import { StoreConflictError, type SQLiteAuthority } from "@horseness/store-sqlite";
import type { GrantAuthorityObservationV1, GrantStore } from "./grant-store.js";
import { TaskExecutionServiceV1, type ExecutionHostDriverV1 } from "@horseness/orchestrator";
import { createTaskHostDriverV1 } from "./task-hosts.js";

export interface DaemonExecutionConfigV1 { readonly workspaceId:string; readonly workspacePath:string; readonly stateRoot:string; readonly authorityTime:()=>string; readonly hostDriver?:ExecutionHostDriverV1 }

export type DaemonMethodHandlerV1 = (request: JsonRpcRequestV1, body: CoordinatorBodyV1, context: AuthenticatedContextV1, authorization:GrantAuthorityObservationV1) => Promise<{ data: JsonValue; resultCursor?: JsonValue | null }> | { data: JsonValue; resultCursor?: JsonValue | null };

function coordinatorBody(value: JsonValue): CoordinatorBodyV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("schemaVersion" in value) || value.schemaVersion !== "1" || !("workspaceId" in value) || typeof value.workspaceId !== "string" || !("input" in value)) throw new Error("coordinator body invalid");
  return value as unknown as CoordinatorBodyV1;
}

export class DaemonServer {
  private readonly handlers = new Map<ProtocolMethodV1, DaemonMethodHandlerV1>();
  private executionValue:TaskExecutionServiceV1|null=null;
  constructor(private readonly authority: SQLiteAuthority, readonly grants: GrantStore, private readonly executionConfig?:DaemonExecutionConfigV1) { this.registerBuiltins(); }

  private get execution():TaskExecutionServiceV1 {
    if(this.executionValue)return this.executionValue;
    const config=this.executionConfig;
    if(!config)throw new DomainError("EXECUTION_INVALID","daemon execution configuration is unavailable");
    this.executionValue=new TaskExecutionServiceV1(this.authority,config.workspaceId,{
      observe:digest=>this.grants.observe(digest),
      reference:digest=>this.grants.referenceForDigest(digest),
      producer:input=>{
        const observation=this.grants.observe(input.actor.grantDigest),issuer=observation?.grant;
        if(!observation||!issuer||issuer.principalId!==input.actor.principalId||issuer.workspaceId!==config.workspaceId||Date.parse(input.expiresAt)>Date.parse(issuer.expiresAt)||issuer.adapterId!==null&&issuer.adapterId!==input.adapterId||issuer.runId!==null&&issuer.runId!==input.runId)throw new DomainError("AUTHORIZATION_DENIED");
        if(issuer.taskId!==null&&issuer.taskId!==input.taskId){const task=deterministicReplay(this.authority.replay(config.workspaceId,"run",input.runId)).operational.execution.contracts[input.taskId];if(task?.sourceTaskId!==issuer.taskId)throw new DomainError("AUTHORIZATION_DENIED");}
        const principalId=`adapter:${input.attemptId}:${String(input.generation)}`;
        const grant=this.grants.issue({peerIdentity:issuer.peerIdentity,principalId,principalRole:"adapter",workspaceId:config.workspaceId,runId:input.runId,taskId:input.taskId,attemptId:input.attemptId,generation:input.generation,adapterId:input.adapterId,allowedMethods:["receipt.submit.v1","task.get.v1"],expiresAt:input.expiresAt},input.actor.grantDigest,{id:`producer:${input.attemptId}:${String(input.generation)}`,requestDigest:domainDigest("horseness.task-producer-grant.v1",input as unknown as JsonValue)},observation);
        return {principalId,grantDigest:grant.grant.grantDigest,capability:grant.grantReference};
      },
    },config.hostDriver??createTaskHostDriverV1(config.workspacePath,config.stateRoot),config.authorityTime);
    return this.executionValue;
  }

  startExecution():void { if(this.executionConfig)this.execution.wake(); }
  async stopExecution():Promise<void> { const service=this.executionValue;this.executionValue=null;if(service)await service.close(); }

  register(method: ProtocolMethodV1, handler: DaemonMethodHandlerV1): void { this.handlers.set(method, handler); }

  async dispatch(context: AuthenticatedContextV1, input: unknown): Promise<JsonRpcResponseV1> {
    let id: string | number | null = null;
    try {
      if (typeof input === "object" && input !== null && "id" in input) { const candidate = input.id; if (candidate === null || typeof candidate === "string" || typeof candidate === "number") id = candidate; }
      const request = parseJsonRpcRequestV1(input, context); id = request.id;
      const authorization=this.grants.observe(context.grantDigest);
      if(!authorization||authorization.grant.principalId!==context.principalId||authorization.grant.principalRole!==context.principalRole||authorization.grant.peerIdentity!==context.transport.peerIdentity)throw protocolError("GRANT_INVALID");
      const handler = this.handlers.get(request.method);
      if (handler === undefined) throw new Error(`daemon method not implemented: ${request.method}`);
      const result = await handler(request, coordinatorBody(request.params.body), context, authorization);
      return successResponse(request.id, request.method, { schemaVersion: "1", resultType: request.method, value: result.data } as unknown as JsonValue, result.resultCursor ?? null);
    } catch (error) { return failureResponse(id, error instanceof StoreConflictError ? protocolError(error.message.includes("reused with different request") ? "INVALID_PARAMS" : "STALE_OBSERVATION") : error instanceof DomainError ? protocolError("INVALID_PARAMS",false,{...workflowDomainErrorV1(error.code),message:error.message}) : error); }
  }

  private registerBuiltins(): void {
    this.register("workspace.get.v1", (_request, body) => {
      const events = this.authority.replay(body.workspaceId, "workspace", body.workspaceId);
      const state = deterministicWorkspaceReplay(events); const last = events.at(-1); if (last === undefined) throw new Error("workspace not found");
      const cursor = { schemaVersion: "1", kind: "workspace-only", workspaceId: body.workspaceId, workspaceSequence: last.envelope.sequence, workspaceEnvelopeHash: last.envelopeHash, workspaceContextEpoch: Math.max(0, last.envelope.sequence - 1) } as const;
      return { data: { schemaVersion: "1", resultType: "WorkspaceQueryResultV1", observationCursor: cursor, state: state as unknown as JsonValue }, resultCursor: cursor as unknown as JsonValue };
    });
    this.register("run.get.v1", (_request, body) => {
      if (body.runId === undefined) throw new Error("run identity required");
      const workspace = this.authority.replay(body.workspaceId, "workspace", body.workspaceId).at(-1); const events = this.authority.replay(body.workspaceId, "run", body.runId); const run = deterministicReplay(events); const last = events.at(-1);
      if (workspace === undefined || last === undefined) throw new Error("run not found");
      const cursor = { schemaVersion: "1", kind: "composite", workspaceId: body.workspaceId, workspaceSequence: workspace.envelope.sequence, workspaceEnvelopeHash: workspace.envelopeHash, workspaceContextEpoch: Math.max(0, workspace.envelope.sequence - 1), runId: body.runId, runSequence: last.envelope.sequence, runEnvelopeHash: last.envelopeHash, runContextEpoch: Math.max(0, last.envelope.sequence - 1) } as const;
      return { data: { schemaVersion: "1", resultType: "RunQueryResultV1", observationCursor: cursor, state: run as unknown as JsonValue }, resultCursor: cursor as unknown as JsonValue };
    });
    this.register("run.create.v1", (request, body, context) => {
      if (body.runId === undefined || typeof body.input.value !== "object" || (body.input.value as unknown) === null || !("commandId" in body.input.value) || typeof body.input.value.commandId !== "string" || !("initialDocument" in body.input.value)) throw protocolError("INVALID_PARAMS");
      const commandId = body.input.value.commandId;
      const value=body.input.value;
      const cursor=request.params.observationCursor;
      if(cursor.kind!=="absent-run-genesis"||cursor.workspaceId!==body.workspaceId||cursor.runId!==body.runId||value.observationCursor===undefined||canonicalJson(value.observationCursor as JsonValue)!==canonicalJson(cursor as unknown as JsonValue)||value.commandId!==request.params.idempotencyKey)throw protocolError("INVALID_PARAMS");
      const genesis = createRunGenesis({ observationCursor: cursor, initialDocument: value.initialDocument as JsonValue, principalId: context.principalId, commandId });
      this.authority.appendAtomic({ commandId, runGenesis: { observationCursor: cursor, event: genesis.event } });
      const resultContextVersion = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: genesis.resultCursor.workspaceContextEpoch, runContextEpoch: genesis.resultCursor.runContextEpoch, observationCursor: genesis.resultCursor } as const;
      const data = { schemaVersion: "1", resultType: "RunCommandResultV1", commandId: body.input.value.commandId, resultCursor: genesis.resultCursor, resultContextVersion };
      return { data: data as unknown as JsonValue, resultCursor: genesis.resultCursor as unknown as JsonValue };
    });

    this.register("run.list.v1", (_request, body) => {
      const value=body.input.value as Record<string,unknown>;
      const {offset,limit}=page(value);
      const workspace=this.authority.replay(body.workspaceId,"workspace",body.workspaceId).at(-1);
      if(!workspace)throw protocolError("INVALID_PARAMS");
      const ids=this.authority.listRunIds(body.workspaceId);
      if(offset>ids.length)throw protocolError("INVALID_PARAMS");
      const runs=ids.slice(offset,offset+limit).map(runId=>{
        const events=this.authority.replay(body.workspaceId,"run",runId),last=events.at(-1),first=events[0];
        if(last===undefined||first===undefined)throw protocolError("INVALID_PARAMS");
        const genesis=first.envelope.payload as unknown as {initialDocument:JsonValue};
        const document=genesis.initialDocument;
        const title=typeof document==="object"&&document!==null&&!Array.isArray(document)&&typeof document.title==="string"?document.title:runId;
        return {runId,title,observationCursor:composite(body.workspaceId,runId,workspace,last)};
      });
      return {data:{outcomeId:value.operationId,status:"completed",runs,nextContinuationToken:offset+limit<ids.length?String(offset+limit):""} as unknown as JsonValue};
    });
    this.register("task.create.v1", (request,body,context)=>{
      const cursor=request.params.observationCursor;
      if(cursor.kind!=="composite"||!body.runId||!body.taskId||cursor.workspaceId!==body.workspaceId||cursor.runId!==body.runId)throw protocolError("INVALID_PARAMS");
      if(cursor.runContextEpoch!==Math.max(0,cursor.runSequence-1))throw protocolError("STALE_OBSERVATION");
      const value=body.input.value as Record<string,unknown>;
      const contract=parseTaskContractV2(value.taskContract);
      if(typeof value.operationId!=="string"||value.operationId!==request.params.idempotencyKey||contract.taskId!==body.taskId||contract.kind!=="work"||contract.sourceTaskId!==null||!Array.isArray(value.dependencyTaskIds)||value.dependencyTaskIds.length!==0)throw protocolError("INVALID_PARAMS");
      const payload={eventType:"TaskCreatedV2" as const,workspaceId:body.workspaceId,runId:body.runId,contract};
      const events=this.authority.replay(body.workspaceId,"run",body.runId);
      const existing=deterministicReplay(events).operational.execution.contracts[body.taskId];
      if(existing&&!events.some(item=>item.envelope.causationId===value.operationId&&item.envelope.payload.eventType==="TaskCreatedV2"&&item.envelope.payload.contract.taskId===body.taskId))throw protocolError("INVALID_PARAMS");
      const event=sealEventEnvelope({schemaVersion:"1",streamKind:"run",workspaceId:body.workspaceId,streamId:body.runId,sequence:cursor.runSequence+1,eventId:domainDigest("horseness.task-created-event-id.v1",{workspaceId:body.workspaceId,runId:body.runId,commandId:value.operationId} as JsonValue),eventType:payload.eventType,principalId:context.principalId,causationId:value.operationId,correlationId:value.operationId,idempotencyKey:value.operationId,priorEnvelopeHash:cursor.runEnvelopeHash,payload});
      this.authority.appendAtomic({commandId:value.operationId,workspaceObservationCursor:cursor,run:{streamKind:"run",workspaceId:body.workspaceId,streamId:body.runId,expectedSequence:cursor.runSequence,expectedEnvelopeHash:cursor.runEnvelopeHash,events:[event]}});
      const resultCursor={...cursor,runSequence:event.envelope.sequence,runEnvelopeHash:event.envelopeHash,runContextEpoch:event.envelope.sequence-1};
      return {data:{outcomeId:value.operationId,status:"completed",taskId:body.taskId,taskContractDigest:taskContractDigestV2(contract),observationCursor:resultCursor},resultCursor:resultCursor as unknown as JsonValue};
    });
    this.register("task.list.v1",(_request,body,context)=>{
      if(!body.runId)throw protocolError("INVALID_PARAMS");
      const value=body.input.value as Record<string,unknown>,states=value.states;
      if(!Array.isArray(states)||states.some((state:unknown)=>typeof state!=="string"||!["draft","active","succeeded","failed","cancelled"].includes(state))||new Set(states).size!==states.length)throw protocolError("INVALID_PARAMS");
      const {offset,limit}=page(value);
      const workspace=this.authority.replay(body.workspaceId,"workspace",body.workspaceId).at(-1),events=this.authority.replay(body.workspaceId,"run",body.runId),last=events.at(-1);
      if(!workspace||!last)throw protocolError("INVALID_PARAMS");
      const tasks=this.execution.list(body.runId,{principalId:context.principalId,grantDigest:context.grantDigest}).filter(item=>states.length===0||states.includes((item as Record<string,JsonValue>).lifecycle));
      if(offset>tasks.length)throw protocolError("INVALID_PARAMS");
      const observationCursor=composite(body.workspaceId,body.runId,workspace,last);
      return {data:{outcomeId:value.operationId,status:"completed",tasks:tasks.slice(offset,offset+limit),nextContinuationToken:offset+limit<tasks.length?String(offset+limit):"",observationCursor} as unknown as JsonValue,resultCursor:observationCursor as unknown as JsonValue};
    });
    this.register("task.get.v1",(_request,body,context)=>{
      if(!body.runId||!body.taskId)throw protocolError("INVALID_PARAMS");
      const value=body.input.value as Record<string,unknown>;
      return {data:{outcomeId:value.operationId,status:"completed",task:this.execution.describe(body.runId,body.taskId,context),observationCursor:this.execution.observation(body.runId)} as unknown as JsonValue};
    });
    for(const [method,operationKind] of [["task.dispatch.v1","dispatch"],["task.breakdown.v1","breakdown"],["task.execute.v1","execute"]] as const)this.register(method,async(request,body,context)=>{
      const cursor=request.params.observationCursor,value=body.input.value as Record<string,unknown>;
      if(cursor.kind!=="composite"||!body.taskId||!body.runId||value.taskId!==body.taskId||value.operationId!==request.params.idempotencyKey||typeof value.operationId!=="string")throw protocolError("INVALID_PARAMS");
      const result=await this.execution.start({operationKind,operationId:value.operationId,requestDigest:domainDigest("horseness.task-workflow-request.v1",{principalId:context.principalId,method,params:request.params} as unknown as JsonValue),observationCursor:cursor,taskId:body.taskId,actor:context,adapterId:value.adapterId as NativeTaskAdapterIdV1,model:value.model===""?null:value.model as string,...(operationKind==="execute"?{autoPlan:value.autoPlan as boolean,plannerAdapterId:value.plannerAdapterId as NativeTaskAdapterIdV1,plannerModel:value.plannerModel===""?null:value.plannerModel as string}:{})});
      return {data:result};
    });
    this.register("task.adoptPlan.v1",(request,body,context)=>{
      const cursor=request.params.observationCursor,value=body.input.value as Record<string,unknown>;
      if(cursor.kind!=="composite"||!body.runId||!body.taskId||value.taskId!==body.taskId||value.operationId!==request.params.idempotencyKey||typeof value.operationId!=="string"||typeof value.planDigest!=="string")throw protocolError("INVALID_PARAMS");
      return {data:this.execution.adopt({runId:body.runId,taskId:body.taskId,planDigest:value.planDigest,operationId:value.operationId,requestDigest:domainDigest("horseness.task-workflow-request.v1",{principalId:context.principalId,method:request.method,params:request.params} as unknown as JsonValue),observationCursor:cursor,actor:context})};
    });
    this.register("task.cancel.v1",async(request,body,context)=>{
      const cursor=request.params.observationCursor,value=body.input.value as Record<string,unknown>;
      if(cursor.kind!=="composite"||!body.runId||!body.taskId||value.taskId!==body.taskId||value.operationId!==request.params.idempotencyKey||typeof value.operationId!=="string")throw protocolError("INVALID_PARAMS");
      const observationCursor=await this.execution.cancel({runId:body.runId,taskId:body.taskId,operationId:value.operationId,requestDigest:domainDigest("horseness.task-workflow-request.v1",{principalId:context.principalId,method:request.method,params:request.params} as unknown as JsonValue),observationCursor:cursor,actor:context});
      return {data:{outcomeId:value.operationId,status:"completed",taskId:body.taskId,resolution:"cancellation-requested",observationCursor} as unknown as JsonValue};
    });
    this.register("receipt.submit.v1",async(request,body,context)=>{
      if(!body.runId||!request.params.idempotencyKey)throw protocolError("INVALID_PARAMS");
      const receipt=body.input.value as unknown as AttemptReceiptEnvelopeV1;
      const resultCursor=await this.execution.submitReceipt(body.runId,receipt,context);
      return {data:{schemaVersion:"1",resultType:"RunCommandResultV1",commandId:request.params.idempotencyKey,resultCursor,resultContextVersion:{schemaVersion:"1",kind:"composite",workspaceContextEpoch:resultCursor.workspaceContextEpoch,runContextEpoch:resultCursor.runContextEpoch,observationCursor:resultCursor}} as unknown as JsonValue,resultCursor:resultCursor as unknown as JsonValue};
    });
    this.register("dispatch.get.v1",(_request,body,context)=>{
      const value=body.input.value as Record<string,unknown>;
      if(!body.runId||!body.taskId||!body.attemptId||!body.generation||value.dispatchId!==body.attemptId)throw protocolError("INVALID_PARAMS");
      return {data:{outcomeId:value.operationId,status:"completed",dispatch:this.execution.dispatchState(body.runId,body.taskId,body.attemptId,body.generation,context),observationCursor:this.execution.observation(body.runId)} as unknown as JsonValue};
    });
    for(const [method,action] of [["dispatch.launch.v1","launch"],["dispatch.reconcile.v1","reconcile"]] as const)this.register(method,async(request,body,context)=>{
      const value=body.input.value as Record<string,unknown>,cursor=request.params.observationCursor;
      if(cursor.kind!=="composite"||!body.runId||!body.taskId||!body.attemptId||!body.generation||typeof value.operationId!=="string"||value.operationId!==request.params.idempotencyKey||(action==="launch"?(value.attemptId!==body.attemptId||value.generation!==body.generation):value.dispatchId!==body.attemptId))throw protocolError("INVALID_PARAMS");
      const result=await this.execution.dispatchExisting({runId:body.runId,taskId:body.taskId,attemptId:body.attemptId,generation:body.generation,operationId:value.operationId,requestDigest:domainDigest("horseness.execution-rpc-request.v1",{principalId:context.principalId,method,params:request.params} as unknown as JsonValue),observationCursor:cursor,actor:context,action,...(action==="launch"?{adapterId:value.adapterId as string,bindingDigest:value.contextBindingDigest as string}:{})});
      return {data:result};
    });
    this.register("grant.issue.v1",(request,body,context,authorization)=>{
      const value=body.input.value as Record<string,unknown>;
      if(typeof value.operationId!=="string"||value.operationId!==request.params.idempotencyKey||typeof value.principalId!=="string"||typeof value.principalRole!=="string"||!Array.isArray(value.actions)||value.actions.some(action=>typeof action!=="string")||typeof value.resourceScope!=="object"||value.resourceScope===null||Array.isArray(value.resourceScope)||typeof value.expiresAt!=="string")throw protocolError("INVALID_PARAMS");
      if(context.principalRole!=="authority"||context.workspaceId!==body.workspaceId)throw protocolError("METHOD_NOT_AUTHORIZED");
      if(value.principalRole!=="authority"&&value.principalRole!=="approver"&&value.principalRole!=="operator"&&value.principalRole!=="worker"&&value.principalRole!=="adapter")throw protocolError("INVALID_PARAMS");
      const issuer=this.grants.activeByDigest(context.grantDigest);
      if(!issuer)throw protocolError("GRANT_INVALID");
      if(!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)>Date.parse(issuer.expiresAt))throw protocolError("INVALID_PARAMS");
      const scope=value.resourceScope as Record<string,unknown>;
      if(scope.workspaceId!==undefined&&scope.workspaceId!==body.workspaceId)throw protocolError("AUTH_SCOPE_MISMATCH");
      const bindings:{runId?:string;taskId?:string;attemptId?:string;generation?:number;proposalId?:string;adapterId?:string}={};
      for(const key of ["runId","taskId","attemptId","proposalId","adapterId"] as const){
        const selected=scope[key];
        if(selected!==undefined&&selected!==null){if(typeof selected!=="string"||selected.length===0)throw protocolError("INVALID_PARAMS");bindings[key]=selected;}
        if(issuer[key]!==null&&issuer[key]!==selected)throw protocolError("AUTH_SCOPE_MISMATCH");
      }
      if(scope.generation!==undefined&&scope.generation!==null){if(!Number.isSafeInteger(scope.generation)||Number(scope.generation)<1)throw protocolError("INVALID_PARAMS");bindings.generation=Number(scope.generation);}
      if(issuer.generation!==null&&issuer.generation!==bindings.generation)throw protocolError("AUTH_SCOPE_MISMATCH");
      const peerIdentity=typeof scope.peerIdentity==="string"?scope.peerIdentity:value.principalId;
      const issued=this.grants.issue({peerIdentity,principalId:value.principalId,principalRole:value.principalRole,workspaceId:body.workspaceId,...bindings,allowedMethods:value.actions as ProtocolMethodV1[],expiresAt:value.expiresAt},null,{id:`grant.issue:${context.principalId}:${value.operationId}`,requestDigest:domainDigest("horseness.grant-issue-request.v1",request.params as unknown as JsonValue)},authorization);
      return{data:{outcomeId:value.operationId,status:"completed",grantId:issued.grantReference,grantDigest:issued.grant.grantDigest,issuedAt:issued.issuedAt}};
    });
    this.register("grant.delegate.v1",(request,body,context,authorization)=>{
      const value=body.input.value as Record<string,unknown>;
      if(typeof value.operationId!=="string"||value.operationId!==request.params.idempotencyKey||typeof value.parentGrantDigest!=="string"||typeof value.delegatePrincipalId!=="string"||!Array.isArray(value.actions)||value.actions.some(action=>typeof action!=="string")||typeof value.resourceScope!=="object"||value.resourceScope===null||Array.isArray(value.resourceScope)||typeof value.expiresAt!=="string")throw protocolError("INVALID_PARAMS");
      if(context.principalRole!=="authority")throw protocolError("METHOD_NOT_AUTHORIZED");
      const parent=this.grants.activeByDigest(value.parentGrantDigest),issuer=authorization.grant;
      if(!parent)throw protocolError("GRANT_INVALID");
      if(!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)>Math.min(Date.parse(parent.expiresAt),Date.parse(issuer.expiresAt)))throw protocolError("INVALID_PARAMS");
      const scope=value.resourceScope as Record<string,unknown>,bindings:{runId?:string;taskId?:string;attemptId?:string;generation?:number;proposalId?:string;adapterId?:string}={};
      for(const key of ["runId","taskId","attemptId","proposalId","adapterId"] as const){const selected=scope[key];if(selected!==undefined&&selected!==null){if(typeof selected!=="string"||!selected)throw protocolError("INVALID_PARAMS");bindings[key]=selected;}if(parent[key]!==null&&parent[key]!==selected||issuer[key]!==null&&issuer[key]!==selected)throw protocolError("AUTH_SCOPE_MISMATCH");}
      if(scope.generation!==undefined&&scope.generation!==null){if(!Number.isSafeInteger(scope.generation)||Number(scope.generation)<1)throw protocolError("INVALID_PARAMS");bindings.generation=Number(scope.generation);}
      if(parent.generation!==null&&parent.generation!==bindings.generation||issuer.generation!==null&&issuer.generation!==bindings.generation)throw protocolError("AUTH_SCOPE_MISMATCH");
      const allowed=value.actions as ProtocolMethodV1[];if(allowed.some(method=>!parent.allowedMethods.includes(method)))throw protocolError("METHOD_NOT_AUTHORIZED");
      const peerIdentity=typeof scope.peerIdentity==="string"?scope.peerIdentity:value.delegatePrincipalId;
      const issued=this.grants.issue({peerIdentity,principalId:value.delegatePrincipalId,principalRole:parent.principalRole,workspaceId:body.workspaceId,...bindings,allowedMethods:allowed,expiresAt:value.expiresAt},value.parentGrantDigest,{id:`grant.delegate:${context.principalId}:${value.operationId}`,requestDigest:domainDigest("horseness.grant-delegate-request.v1",request.params as unknown as JsonValue)},authorization);
      return {data:{outcomeId:value.operationId,status:"completed",grantId:issued.grantReference,grantDigest:issued.grant.grantDigest,delegationDepth:1}};
    });
    this.register("grant.revoke.v1",(_request,body,context,authorization)=>{
      const value=body.input.value as Record<string,unknown>;
      if(typeof value.operationId!=="string"||typeof value.grantDigest!=="string"||typeof value.effectiveAt!=="string")throw protocolError("INVALID_PARAMS");
      if(context.principalRole!=="authority")throw protocolError("METHOD_NOT_AUTHORIZED");
      const target=this.grants.list().find(grant=>grant.grantDigest===value.grantDigest);
      if(!target)throw protocolError("GRANT_INVALID");
      for(const key of ["runId","taskId","attemptId","generation","proposalId","adapterId"] as const)if(authorization.grant[key]!==null&&authorization.grant[key]!==target[key])throw protocolError("AUTH_SCOPE_MISMATCH");
      const reference=this.grants.referenceForDigest(value.grantDigest);
      if(reference===null||!this.grants.revoke(reference,authorization))throw protocolError("GRANT_INVALID");
      return {data:{outcomeId:value.operationId,status:"completed",grantDigest:value.grantDigest,revokedAt:value.effectiveAt,observationCursor:requestCursor(body.workspaceId,this.authority)}};
    });
    this.register("grant.list.v1",(_request,body,context)=>{const value:unknown=body.input.value;if(typeof value!=="object"||value===null||!("operationId" in value)||typeof value.operationId!=="string"||!("principalId" in value)||typeof value.principalId!=="string"||!("includeRevoked" in value)||typeof value.includeRevoked!=="boolean")throw new Error("grant list input invalid");if(context.principalRole!=="authority")throw new Error("grant list authority required");const grants=this.grants.list(value.principalId).filter(grant=>value.includeRevoked?true:!grant.revoked).map(grant=>({...grant,current:grant.grantDigest===context.grantDigest}));return{data:{outcomeId:value.operationId,status:"completed",grants:grants as unknown as JsonValue,observationCursor:requestCursor(body.workspaceId,this.authority)}};});
  }
}

function requestCursor(workspaceId:string,authority:SQLiteAuthority):JsonValue{const head=authority.replay(workspaceId,"workspace",workspaceId).at(-1);if(head===undefined)throw new Error("workspace not found");return{schemaVersion:"1",kind:"workspace-only",workspaceId,workspaceSequence:head.envelope.sequence,workspaceEnvelopeHash:head.envelopeHash,workspaceContextEpoch:Math.max(0,head.envelope.sequence-1)} as unknown as JsonValue;}

function page(value:Record<string,unknown>):{offset:number;limit:number}{
  const {limit,continuationToken}=value;
  if(!Number.isSafeInteger(limit)||typeof limit!=="number"||limit<1||limit>100||typeof continuationToken!=="string"||continuationToken!==""&&!/^[1-9][0-9]*$/.test(continuationToken))throw protocolError("INVALID_PARAMS");
  const offset=continuationToken===""?0:Number(continuationToken);
  if(!Number.isSafeInteger(offset))throw protocolError("INVALID_PARAMS");
  return {offset,limit};
}

function composite(workspaceId:string,runId:string,workspace:{envelope:{sequence:number};envelopeHash:string},run:{envelope:{sequence:number};envelopeHash:string}):CompositeCursorV1{
  return {schemaVersion:"1",kind:"composite",workspaceId,workspaceSequence:workspace.envelope.sequence,workspaceEnvelopeHash:workspace.envelopeHash,workspaceContextEpoch:Math.max(0,workspace.envelope.sequence-1),runId,runSequence:run.envelope.sequence,runEnvelopeHash:run.envelopeHash,runContextEpoch:Math.max(0,run.envelope.sequence-1)};
}
