import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAuthenticatedContextV1, methodDefinition, type AuthenticatedContextV1, type JsonRpcRequestV1, type JsonRpcResponseV1, type ProtocolMethodV1 } from "@horseness/protocol";
import { Daemon } from "../src/index.js";

interface WorkspaceCursorV1 {
  readonly schemaVersion: "1";
  readonly kind: "workspace-only";
  readonly workspaceId: string;
  readonly workspaceSequence: number;
  readonly workspaceEnvelopeHash: string;
  readonly workspaceContextEpoch: number;
}
const authorityTime = (): string => "2026-08-12T00:00:00.000Z";

function fixture(): { daemon: Daemon; context: AuthenticatedContextV1 } {
  const root = mkdtempSync(join(tmpdir(), "horseness-daemon-server-"));
  const daemon = new Daemon({ workspacePath: root, databasePath: join(root, "authority.sqlite"), artifactRoot: join(root, "artifacts"), transport: { kind: "stdio" }, authorityTime }, { identity: () => "owner" });
  const capability = daemon.createBootstrapCapability("principal:owner");
  const bootstrap = daemon.consumeBootstrapCapability(capability.secret);
  const grant = daemon.grants.activeByDigest(bootstrap.grantDigest);
  assert.notEqual(grant, null);
  const context = createAuthenticatedContextV1(
    { transport: "stdio", localOnly: true, peerVerified: true, peerIdentity: "owner", processInherited: true },
    grant!,
    authorityTime(),
  );
  return { daemon, context };
}

function workspaceCursor(daemon: Daemon): WorkspaceCursorV1 {
  const head = daemon.authority.replay(daemon.config.workspaceId, "workspace", daemon.config.workspaceId).at(-1);
  assert.notEqual(head, undefined);
  return { schemaVersion: "1", kind: "workspace-only", workspaceId: daemon.config.workspaceId, workspaceSequence: head!.envelope.sequence, workspaceEnvelopeHash: head!.envelopeHash, workspaceContextEpoch: Math.max(0, head!.envelope.sequence - 1) };
}

function request(method: ProtocolMethodV1, cursor: WorkspaceCursorV1, value: Readonly<Record<string, unknown>>): JsonRpcRequestV1 {
  return {
    jsonrpc: "2.0",
    id: method,
    method,
    params: {
      protocolVersion: "1",
      observationCursor: cursor,
      body: { schemaVersion: "1", workspaceId: cursor.workspaceId, input: { schemaVersion: "1", requestType: method, value } } as never,
    },
  };
}

function sdkCompatibleValue(response: JsonRpcResponseV1, method: ProtocolMethodV1): unknown {
  assert.ok("result" in response);
  assert.equal(response.result.method, method);
  const definition = methodDefinition(method);
  assert.notEqual(definition, undefined);
  return definition!.parseResult(response.result.data).value;
}

test("dispatch envelopes domain and local DTO handler values for protocol and SDK parsing", async () => {
  const { daemon, context } = fixture();
  try {
    const cursor = workspaceCursor(daemon);
    const workspaceResponse = await daemon.server.dispatch(context, request("workspace.get.v1", cursor, { schemaVersion: "1", queryType: "GetWorkspaceV1", observationCursor: cursor }));
    const workspace = sdkCompatibleValue(workspaceResponse, "workspace.get.v1") as { resultType: string; state: unknown };
    assert.equal(workspace.resultType, "WorkspaceQueryResultV1");
    assert.ok(workspace.state);

    const listResponse = await daemon.server.dispatch(context, request("grant.list.v1", cursor, { operationId: "list-grants", principalId: "principal:owner", includeRevoked: false, limit: 10 }));
    const list = sdkCompatibleValue(listResponse, "grant.list.v1") as { outcomeId: string; grants: unknown[] };
    assert.equal(list.outcomeId, "list-grants");
    assert.ok(list.grants.length > 0);
  } finally {
    daemon.close();
  }
});

test("dispatch fails closed when a registered handler returns a malformed raw result", async () => {
  const { daemon, context } = fixture();
  try {
    const cursor = workspaceCursor(daemon);
    daemon.server.register("grant.list.v1", () => ({ data: { outcomeId: "missing-required-fields" } }));
    const response = await daemon.server.dispatch(context, request("grant.list.v1", cursor, { operationId: "list-grants", principalId: "principal:owner", includeRevoked: false, limit: 10 }));
    assert.ok("error" in response);
    assert.equal(response.error.data.reasonCode, "INVALID_PARAMS");
  } finally {
    daemon.close();
  }
});

test("run and task workflow survives restart without changing canonical state", async () => {
  const {daemon,context}=fixture();
  const workspace=workspaceCursor(daemon),workspaceId=workspace.workspaceId,runId="daily-run",taskId="daily-task";
  const call=(method:ProtocolMethodV1,cursor:unknown,value:unknown,ids:{runId?:string;taskId?:string}={},key?:string):JsonRpcRequestV1=>({jsonrpc:"2.0",id:method,method,params:{protocolVersion:"1",observationCursor:cursor as never,...(key?{idempotencyKey:key}:{}),body:{schemaVersion:"1",workspaceId,...ids,input:{schemaVersion:"1",requestType:method,value}} as never}});
  const absent={...workspace,kind:"absent-run-genesis",runId,expectedRunHead:"absent"};
  const contract={schemaVersion:"1",taskId,title:"Write notes",completionPolicy:{schemaVersion:"1",kind:"predicate",predicate:{kind:"receipt-only"}}};
  const createRun=call("run.create.v1",absent,{schemaVersion:"1",commandType:"CreateRunV1",commandId:"create-run",observationCursor:absent,principalId:context.principalId,initialDocument:{title:"Daily"}},{runId},"create-run");
  let restarted:Daemon|undefined;
  try {
    const empty=sdkCompatibleValue(await daemon.server.dispatch(context,call("run.list.v1",workspace,{operationId:"empty-runs",limit:100,continuationToken:""})),"run.list.v1") as {runs:unknown[]};
    assert.deepEqual(empty.runs,[]);
    const created=sdkCompatibleValue(await daemon.server.dispatch(context,createRun),"run.create.v1") as {resultCursor:unknown};
    const runCursor=created.resultCursor;
    const before=sdkCompatibleValue(await daemon.server.dispatch(context,call("run.get.v1",runCursor,{schemaVersion:"1",queryType:"GetRunV1",observationCursor:runCursor},{runId})),"run.get.v1") as {state:{canonical:{revision:number;stateHash:string}}};
    const emptyTasks=sdkCompatibleValue(await daemon.server.dispatch(context,call("task.list.v1",runCursor,{operationId:"empty-tasks",states:[],limit:100,continuationToken:""},{runId})),"task.list.v1") as {tasks:unknown[]};
    assert.deepEqual(emptyTasks.tasks,[]);
    const taskRequest=call("task.create.v1",runCursor,{operationId:"create-task",taskContract:contract,dependencyTaskIds:[]},{runId,taskId},"create-task");
    const task=sdkCompatibleValue(await daemon.server.dispatch(context,taskRequest),"task.create.v1") as {observationCursor:unknown};
    assert.deepEqual(sdkCompatibleValue(await daemon.server.dispatch(context,taskRequest),"task.create.v1"),task);
    const list=sdkCompatibleValue(await daemon.server.dispatch(context,call("task.list.v1",task.observationCursor,{operationId:"list-tasks",states:[],limit:100,continuationToken:""},{runId})),"task.list.v1") as {tasks:unknown[]};
    assert.deepEqual(list.tasks,[{taskId,title:"Write notes",lifecycle:"draft",completionPolicy:contract.completionPolicy}]);
    const after=sdkCompatibleValue(await daemon.server.dispatch(context,call("run.get.v1",task.observationCursor,{schemaVersion:"1",queryType:"GetRunV1",observationCursor:task.observationCursor},{runId})),"run.get.v1") as typeof before;
    assert.deepEqual(after.state.canonical,before.state.canonical);
    const runs=sdkCompatibleValue(await daemon.server.dispatch(context,call("run.list.v1",workspace,{operationId:"list-runs",limit:100,continuationToken:""})),"run.list.v1") as {runs:{title:string;observationCursor:unknown}[]};
    assert.equal(runs.runs[0]?.title,"Daily");assert.deepEqual(runs.runs[0]?.observationCursor,task.observationCursor);
    daemon.close();restarted=new Daemon({workspacePath:daemon.config.workspacePath,databasePath:daemon.config.databasePath,artifactRoot:daemon.config.artifactRoot,workspaceId,transport:{kind:"stdio"},authorityTime},{identity:()=>"owner"});
    const persisted=sdkCompatibleValue(await restarted.server.dispatch(context,call("task.list.v1",task.observationCursor,{operationId:"after-restart",states:[],limit:100,continuationToken:""},{runId})),"task.list.v1") as {tasks:unknown[]};
    assert.deepEqual(persisted.tasks,list.tasks);
  } finally { if(restarted)restarted.close();else daemon.close(); }
});

test("workflow rejects stale observations and changed request keys without appending", async () => {
  const {daemon,context}=fixture();const workspace=workspaceCursor(daemon),workspaceId=workspace.workspaceId,runId="run";
  const call=(method:ProtocolMethodV1,cursor:unknown,value:unknown,taskId?:string,key?:string):JsonRpcRequestV1=>({jsonrpc:"2.0",id:method,method,params:{protocolVersion:"1",observationCursor:cursor as never,...(key?{idempotencyKey:key}:{}),body:{schemaVersion:"1",workspaceId,runId,...(taskId?{taskId}:{}),input:{schemaVersion:"1",requestType:method,value}} as never}});
  try {
    const absent={...workspace,kind:"absent-run-genesis",runId,expectedRunHead:"absent"};
    const run=sdkCompatibleValue(await daemon.server.dispatch(context,call("run.create.v1",absent,{schemaVersion:"1",commandType:"CreateRunV1",commandId:"run-command",observationCursor:absent,principalId:context.principalId,initialDocument:{}},undefined,"run-command")),"run.create.v1") as {resultCursor:unknown};
    const cursor=run.resultCursor,contract=(taskId:string,title:string)=>({schemaVersion:"1",taskId,title,completionPolicy:{schemaVersion:"1",kind:"predicate",predicate:{kind:"receipt-only"}}});
    const first=await daemon.server.dispatch(context,call("task.create.v1",cursor,{operationId:"task-command",taskContract:contract("one","One"),dependencyTaskIds:[]},"one","task-command"));assert.ok("result" in first);
    const stale=await daemon.server.dispatch(context,call("task.create.v1",cursor,{operationId:"stale-command",taskContract:contract("two","Two"),dependencyTaskIds:[]},"two","stale-command"));assert.ok("error" in stale);assert.equal(stale.error.data.reasonCode,"STALE_OBSERVATION");
    const changed=await daemon.server.dispatch(context,call("task.create.v1",cursor,{operationId:"task-command",taskContract:contract("one","Changed"),dependencyTaskIds:[]},"one","task-command"));assert.ok("error" in changed);assert.equal(changed.error.data.reasonCode,"INVALID_PARAMS");
    const current=(sdkCompatibleValue(first,"task.create.v1") as {observationCursor:unknown}).observationCursor;
    const listed=sdkCompatibleValue(await daemon.server.dispatch(context,call("task.list.v1",current,{operationId:"list",states:[],limit:100,continuationToken:""})),"task.list.v1") as {tasks:{taskId:string}[]};assert.deepEqual(listed.tasks.map(item=>item.taskId),["one"]);
  }finally{daemon.close();}
});

test("workflow methods require granted capability", async () => {
  const {daemon}=fixture();
  try {
    const cursor=workspaceCursor(daemon);
    const issued=daemon.grants.issue({peerIdentity:"reader",principalId:"reader",principalRole:"operator",workspaceId:cursor.workspaceId,allowedMethods:["workspace.get.v1"],expiresAt:"2027-08-12T00:00:00.000Z"});
    const reader=createAuthenticatedContextV1({transport:"stdio",localOnly:true,peerVerified:true,peerIdentity:"reader",processInherited:true},issued.grant,authorityTime());
    const response=await daemon.server.dispatch(reader,request("run.list.v1",cursor,{operationId:"denied",limit:100,continuationToken:""}));
    assert.ok("error" in response);assert.equal(response.error.data.reasonCode,"METHOD_NOT_AUTHORIZED");
  }finally{daemon.close();}
});
