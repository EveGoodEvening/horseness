import { createRunGenesis, deterministicReplay, deterministicWorkspaceReplay, type JsonValue } from "@horseness/domain";
import { failureResponse, parseJsonRpcRequestV1, successResponse, type AuthenticatedContextV1, type CoordinatorBodyV1, type JsonRpcRequestV1, type JsonRpcResponseV1, type ProtocolMethodV1 } from "@horseness/protocol";
import type { SQLiteAuthority } from "@horseness/store-sqlite";
import type { GrantStore } from "./grant-store.js";

export type DaemonMethodHandlerV1 = (request: JsonRpcRequestV1, body: CoordinatorBodyV1, context: AuthenticatedContextV1) => Promise<{ data: JsonValue; resultCursor?: JsonValue | null }> | { data: JsonValue; resultCursor?: JsonValue | null };

function coordinatorBody(value: JsonValue): CoordinatorBodyV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("schemaVersion" in value) || value.schemaVersion !== "1" || !("workspaceId" in value) || typeof value.workspaceId !== "string" || !("input" in value)) throw new Error("coordinator body invalid");
  return value as unknown as CoordinatorBodyV1;
}

export class DaemonServer {
  private readonly handlers = new Map<ProtocolMethodV1, DaemonMethodHandlerV1>();
  constructor(private readonly authority: SQLiteAuthority, readonly grants: GrantStore) { this.registerBuiltins(); }

  register(method: ProtocolMethodV1, handler: DaemonMethodHandlerV1): void { this.handlers.set(method, handler); }

  async dispatch(context: AuthenticatedContextV1, input: unknown): Promise<JsonRpcResponseV1> {
    let id: string | number | null = null;
    try {
      if (typeof input === "object" && input !== null && "id" in input) { const candidate = input.id; if (candidate === null || typeof candidate === "string" || typeof candidate === "number") id = candidate; }
      const request = parseJsonRpcRequestV1(input, context); id = request.id;
      const handler = this.handlers.get(request.method);
      if (handler === undefined) throw new Error(`daemon method not implemented: ${request.method}`);
      const result = await handler(request, coordinatorBody(request.params.body), context);
      return successResponse(request.id, request.method, { schemaVersion: "1", resultType: request.method, value: result.data } as unknown as JsonValue, result.resultCursor ?? null);
    } catch (error) { return failureResponse(id, error); }
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
      if (body.runId === undefined || typeof body.input.value !== "object" || body.input.value === null || !("commandId" in body.input.value) || typeof body.input.value.commandId !== "string" || !("initialDocument" in body.input.value)) throw new Error("run command invalid");
      const cursor = request.params.observationCursor; if (cursor.kind !== "absent-run-genesis") throw new Error("absent run cursor required");
      const genesis = createRunGenesis({ observationCursor: cursor, initialDocument: body.input.value.initialDocument as JsonValue, principalId: context.principalId, commandId: body.input.value.commandId });
      this.authority.appendAtomic({ commandId: body.input.value.commandId, runGenesis: { observationCursor: cursor, event: genesis.event } });
      const resultContextVersion = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: genesis.resultCursor.workspaceContextEpoch, runContextEpoch: genesis.resultCursor.runContextEpoch, observationCursor: genesis.resultCursor } as const;
      const data = { schemaVersion: "1", resultType: "RunCommandResultV1", commandId: body.input.value.commandId, resultCursor: genesis.resultCursor, resultContextVersion };
      return { data: data as unknown as JsonValue, resultCursor: genesis.resultCursor as unknown as JsonValue };
    });

    this.register("grant.issue.v1",(_request,body,context)=>{
      const value=body.input.value;if(typeof value!=="object"||value===null||!("operationId" in value)||typeof value.operationId!=="string"||!("principalId" in value)||typeof value.principalId!=="string"||!("principalRole" in value)||typeof value.principalRole!=="string"||!("actions" in value)||!Array.isArray(value.actions)||!("resourceScope" in value)||typeof value.resourceScope!=="object"||value.resourceScope===null||!("expiresAt" in value)||typeof value.expiresAt!=="string")throw new Error("grant issue input invalid");
      if(context.principalRole!=="authority"||context.workspaceId!==body.workspaceId)throw new Error("grant issue authority required");const scope=value.resourceScope;
      const peerIdentity="peerIdentity" in scope&&typeof scope.peerIdentity==="string"?scope.peerIdentity:value.principalId;const allowed=value.actions.filter((item):item is ProtocolMethodV1=>typeof item==="string") as ProtocolMethodV1[];
      const issued=this.grants.issue({peerIdentity,principalId:value.principalId,principalRole:value.principalRole as never,workspaceId:body.workspaceId,allowedMethods:allowed,expiresAt:value.expiresAt});
      return{data:{outcomeId:value.operationId,status:"completed",grantId:issued.grantReference,grantDigest:issued.grant.grantDigest,issuedAt:new Date().toISOString()}};
    });
    this.register("grant.delegate.v1",(_request,body,context)=>{
      const value=body.input.value;if(typeof value!=="object"||value===null||!("operationId" in value)||typeof value.operationId!=="string"||!("parentGrantDigest" in value)||typeof value.parentGrantDigest!=="string"||!("delegatePrincipalId" in value)||typeof value.delegatePrincipalId!=="string"||!("actions" in value)||!Array.isArray(value.actions)||!("resourceScope" in value)||typeof value.resourceScope!=="object"||value.resourceScope===null||!("expiresAt" in value)||typeof value.expiresAt!=="string")throw new Error("grant delegate input invalid");
      if(context.principalRole!=="authority")throw new Error("grant delegate authority required");const active=this.grants.activeByDigest(value.parentGrantDigest);if(active===null)throw new Error("parent grant inactive");if(Date.parse(value.expiresAt)>Date.parse(active.expiresAt))throw new Error("delegation expiry exceeds parent");const scope=value.resourceScope as Record<string,unknown>;const peerIdentity="peerIdentity" in scope&&typeof scope.peerIdentity==="string"?scope.peerIdentity:value.delegatePrincipalId;
      const stringScope=(key:"runId"|"taskId"|"attemptId"|"proposalId"|"adapterId"):string|undefined=>key in scope&&typeof scope[key]==="string"?scope[key]:undefined;const runId=stringScope("runId"),taskId=stringScope("taskId"),attemptId=stringScope("attemptId"),proposalId=stringScope("proposalId"),adapterId=stringScope("adapterId");const generation="generation" in scope&&Number.isSafeInteger(scope.generation)&&Number(scope.generation)>=1?Number(scope.generation):undefined;
      const bindings=[[active.runId,runId],[active.taskId,taskId],[active.attemptId,attemptId],[active.generation,generation],[active.proposalId,proposalId],[active.adapterId,adapterId]] as const;if(bindings.some(([parent,child])=>parent!==null&&child!==parent))throw new Error("delegation resource scope exceeds parent");const allowed=value.actions.filter((item):item is ProtocolMethodV1=>typeof item==="string") as ProtocolMethodV1[];if(allowed.some(method=>!active.allowedMethods.includes(method)))throw new Error("delegation exceeds parent scope");
      const issued=this.grants.issue({peerIdentity,principalId:value.delegatePrincipalId,principalRole:active.principalRole,workspaceId:body.workspaceId,...(runId===undefined?{}:{runId}),...(taskId===undefined?{}:{taskId}),...(attemptId===undefined?{}:{attemptId}),...(generation===undefined?{}:{generation}),...(proposalId===undefined?{}:{proposalId}),...(adapterId===undefined?{}:{adapterId}),allowedMethods:allowed,expiresAt:value.expiresAt},value.parentGrantDigest);return{data:{outcomeId:value.operationId,status:"completed",grantId:issued.grantReference,grantDigest:issued.grant.grantDigest,delegationDepth:1}};
    });
    this.register("grant.revoke.v1",(_request,body,context)=>{const value=body.input.value;if(typeof value!=="object"||value===null||!("operationId" in value)||typeof value.operationId!=="string"||!("grantDigest" in value)||typeof value.grantDigest!=="string"||!("effectiveAt" in value)||typeof value.effectiveAt!=="string")throw new Error("grant revoke input invalid");if(context.principalRole!=="authority")throw new Error("grant revoke authority required");const reference=this.grants.referenceForDigest(value.grantDigest);if(reference===null||!this.grants.revoke(reference))throw new Error("grant not active");return{data:{outcomeId:value.operationId,status:"completed",grantDigest:value.grantDigest,revokedAt:value.effectiveAt,observationCursor:requestCursor(body.workspaceId,this.authority)}};});
    this.register("grant.list.v1",(_request,body,context)=>{const value=body.input.value;if(typeof value!=="object"||value===null||!("operationId" in value)||typeof value.operationId!=="string"||!("principalId" in value)||typeof value.principalId!=="string"||!("includeRevoked" in value)||typeof value.includeRevoked!=="boolean")throw new Error("grant list input invalid");if(context.principalRole!=="authority")throw new Error("grant list authority required");const grants=this.grants.list(value.principalId).filter(grant=>value.includeRevoked||!grant.revoked);return{data:{outcomeId:value.operationId,status:"completed",grants:grants as unknown as JsonValue,observationCursor:requestCursor(body.workspaceId,this.authority)}};});
  }
}

function requestCursor(workspaceId:string,authority:SQLiteAuthority):JsonValue{const head=authority.replay(workspaceId,"workspace",workspaceId).at(-1);if(head===undefined)throw new Error("workspace not found");return{schemaVersion:"1",kind:"workspace-only",workspaceId,workspaceSequence:head.envelope.sequence,workspaceEnvelopeHash:head.envelopeHash,workspaceContextEpoch:Math.max(0,head.envelope.sequence-1)} as unknown as JsonValue;}
