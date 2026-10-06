import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DomainError, NO_POLICY_DIGEST, attemptContextBindingDigest, createRunGenesis, createWorkspaceGenesis, deterministicReplay, domainDigest, sealAttemptReceipt, sealEventEnvelope, taskExecutionProfileDigest, type JsonValue, type TaskContractV2, type TaskExecutionProfileV1 } from "@horseness/domain";
import type { AuthenticatedGrantV1, WorkerAdapterV1 } from "@horseness/protocol";
import { CrashInjectedError, SQLiteAuthority, createOrLoadAuthorityCredential } from "@horseness/store-sqlite";
import { TaskExecutionServiceV1, type ExecutionGrantAuthorityV1, type ExecutionHostDriverV1, type StartTaskWorkflowV1 } from "../../src/execution/service.js";

const now = "2026-10-06T12:00:00.000Z";
const profile: TaskExecutionProfileV1 = { schemaVersion: "1", adapterId: "pi", hostId: "pi", hostVersion: "0.73.1", nativeExecutablePath: "/unit/native", nativeExecutableDigest: "a".repeat(64), providerId: "unit", modelId: "exact-model", purpose: "work", timeoutMs: 30_000, maxOutputBytes: 65_536, lookup: "local-terminal-record", idempotentLaunch: false };

function fixture(interruptPrepared=false,adapterId:string|null=null) {
  const root = mkdtempSync(join(tmpdir(), "horseness-execution-service-")), database = join(root, "authority.sqlite"), artifacts = join(root, "artifacts");
  const credential = createOrLoadAuthorityCredential(database, artifacts, "workspace");
  const initial = SQLiteAuthority.open(database, artifacts);
  const owner: AuthenticatedGrantV1 = { schemaVersion: "1", principalId: "owner", principalRole: "authority", grantDigest: "owner-grant", peerIdentity: "owner", expiresAt: "2027-01-01T00:00:00.000Z", revoked: false, workspaceId: "workspace", runId: null, taskId: null, attemptId: null, generation: null, proposalId: null, adapterId, allowedMethods: ["task.dispatch.v1", "task.breakdown.v1", "task.execute.v1", "task.cancel.v1", "task.adoptPlan.v1"] };
  const workspace = createWorkspaceGenesis({ workspaceId: "workspace", authorityPrincipalId: "owner", initialGrantDigest: owner.grantDigest, authorityConsumptionMarker: "consumed", activePolicyDigest: NO_POLICY_DIGEST, commandId: "workspace" });
  const grantsState = { grants: [owner] };
  initial.bootstrapWorkspaceAuthorityAtomic({ commandId: "workspace", workspace: { streamKind: "workspace", workspaceId: "workspace", streamId: "workspace", expectedSequence: 0, expectedEnvelopeHash: null, events: [workspace.event] }, authorityState: { schemaVersion: "1", workspaceId: "workspace", stateKind: "grants", revision: 1, state: grantsState as unknown as JsonValue, stateDigest: domainDigest("horseness.workspace-authority-state.v1", grantsState as unknown as JsonValue) } });
  const absent = { ...workspace.resultCursor, kind: "absent-run-genesis" as const, runId: "run", expectedRunHead: "absent" as const };
  const run = createRunGenesis({ observationCursor: absent, initialDocument: { objective: "Change a file" }, principalId: "owner", commandId: "run" });
  initial.appendAtomic({ commandId: "run", runGenesis: { observationCursor: absent, event: run.event } });
  const contract: TaskContractV2 = { schemaVersion: "2", taskId: "task", title: "Change a file", instructions: "Change a file", acceptanceCriteria: [], kind: "work", sourceTaskId: null, completionPolicy: { schemaVersion: "1", kind: "predicate", predicate: { kind: "receipt-only" } } };
  const created = sealEventEnvelope({ schemaVersion: "1", streamKind: "run", workspaceId: "workspace", streamId: "run", sequence: 2, priorEnvelopeHash: run.event.envelopeHash, eventId: "task", eventType: "TaskCreatedV2", principalId: "owner", causationId: "task", correlationId: "task", idempotencyKey: "task", payload: { eventType: "TaskCreatedV2" as const, workspaceId: "workspace", runId: "run", contract } });
  initial.appendAtomic({ commandId: "task", run: { streamKind: "run", workspaceId: "workspace", streamId: "run", expectedSequence: 1, expectedEnvelopeHash: run.event.envelopeHash, events: [created] } });
  initial.close();
  let storeForCrash:SQLiteAuthority|undefined,interrupted=false;
  const { authority } = SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "workspace", sessionId: root, credential },point=>{
    if(interruptPrepared&&!interrupted&&point==="transaction.commit.after"&&storeForCrash?.replay("workspace","run","run").at(-1)?.envelope.eventType==="TaskExecutionPreparedV1"){interrupted=true;throw new CrashInjectedError(point);}
  });
  storeForCrash=authority;
  function replaceGrants(grants: AuthenticatedGrantV1[]) {
    const current = authority.authenticatedAuthorityState("workspace", "grants");
    authority.compareAndSwapAuthorityState({ commandId: `grants-${current.revision}`, workspaceId: "workspace", stateKind: "grants", expectedRevision: current.revision, expectedStateDigest: current.stateDigest, nextState: { grants } as unknown as JsonValue });
  }
  const grantAuthority: ExecutionGrantAuthorityV1 = {
    observe(digest) {
      const current = authority.authenticatedAuthorityState("workspace", "grants"), state = current.state as unknown as { grants: AuthenticatedGrantV1[] };
      const grant = state.grants.find(item => item.grantDigest === digest);
      if (!grant || grant.revoked) return null;
      return { grant, expectation: { stateKind: current.stateKind, revision: current.revision, stateDigest: current.stateDigest } };
    },
    producer(input) {
      const current = authority.authenticatedAuthorityState("workspace", "grants"), state = current.state as unknown as { grants: AuthenticatedGrantV1[] };
      const principalId = `producer:${input.attemptId}`, grantDigest = `grant:${input.attemptId}`;
      if (!state.grants.some(item => item.grantDigest === grantDigest)) replaceGrants([...state.grants, { ...owner, principalId, grantDigest, principalRole: "adapter", runId: input.runId, taskId: input.taskId, attemptId: input.attemptId, generation: input.generation, adapterId:input.adapterId, expiresAt: input.expiresAt, allowedMethods: ["receipt.submit.v1"] }]);
      return { principalId, grantDigest, capability: grantDigest };
    },
    reference(digest) { return grantAuthority.observe(digest) ? digest : null; },
  };
  const calls = { resolve: 0, launch: 0, reconcile: 0 };
  const native: WorkerAdapterV1 = {
    async detectCapabilities() { return { schemaVersion: "1", adapterId: "horseness-pi-v1", providerId: "pi-native-provider-v1", launch: true, cancel: false, reconcile: "supported", reattach: "unsupported", nativeResume: "unsupported", contextInjection: "bytes", receiptCollection: true, maxContextBytes: 1024 * 1024, outputMediaTypes: ["text/plain"], evidenceMediaTypes: ["application/json"] }; },
    async launch() { calls.launch++; throw new DomainError("UNKNOWN_OUTCOME"); },
    async reconcile() { calls.reconcile++; throw new DomainError("UNKNOWN_OUTCOME"); },
    async collectReceipt() { throw new DomainError("UNKNOWN_OUTCOME"); },
    async cancel() { return { schemaVersion: "1", status: "unsupported", providerOperationId: null, nativeSessionId: null, details: {} }; },
    async resume() { return { schemaVersion: "1", status: "unsupported", providerOperationId: null, nativeSessionId: null, details: {} }; },
  };
  const hosts: ExecutionHostDriverV1 = {
    async resolve(_adapterId, _model, purpose) { calls.resolve++; return { ...profile, purpose }; },
    async open() { return { adapter: native, async publication() { throw new DomainError("ARTIFACT_MISMATCH"); }, async close() {} }; },
  };
  const service = new TaskExecutionServiceV1(authority, "workspace", grantAuthority, hosts, () => now);
  const request: StartTaskWorkflowV1 = { operationKind: "dispatch", operationId: "dispatch", requestDigest: "original-request", observationCursor: service.observation("run"), taskId: "task", actor: { principalId: "owner", grantDigest: "owner-grant" }, adapterId: "pi", model: "unit/exact-model" };
  function state() { return deterministicReplay(authority.replay("workspace", "run", "run")).operational.execution; }
  async function stopped() {
    for (let turn = 0; turn < 100; turn++) {
      const workflows = Object.values(state().workflows);
      if (workflows.length && workflows.every(item => item.state !== "running")) return;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    throw new Error("workflow did not reach a durable stop");
  }
  return { root, authority, service, request, hosts, calls, grantAuthority, state, stopped, revoke() { const current = authority.authenticatedAuthorityState("workspace", "grants").state as unknown as { grants: AuthenticatedGrantV1[] }; replaceGrants(current.grants.map(item => item.principalId === "owner" ? { ...item, revoked: true } : item)); }, async close() { await service.close(); authority.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("lost start acknowledgement recovers the original authorization and rejects changed payload", async () => {
  const f = fixture();
  try {
    const original = await f.service.start(f.request);
    assert.deepEqual(await f.service.start(f.request), original);
    await assert.rejects(f.service.start({ ...f.request, requestDigest: "changed", model: "unit/different" }), /OPERATION_ID_REUSED/);
    assert.equal(f.calls.resolve, 1);
    assert.equal(Object.values(f.state().workflows).length, 1);
  } finally { await f.close(); }
});

test("issuer revocation after acknowledgement prevents all native handoff", async () => {
  const f = fixture();
  try {
    await f.service.start(f.request); f.revoke(); await f.stopped();
    assert.equal(f.calls.launch, 0);
    assert.equal(Object.values(f.state().workflows)[0]?.state, "revoked");
    assert.deepEqual(f.state().attempts, {});
  } finally { await f.close(); }
});

test("unknown handoff remains durable and another explicit dispatch only reconciles", async () => {
  const f = fixture();
  try {
    await f.service.start(f.request); await f.stopped();
    assert.equal(f.calls.launch, 1);
    assert.equal(Object.values(f.state().attempts)[0]?.state, "unknown_outcome");
    await f.service.start({ ...f.request, operationId: "inspect-unknown", requestDigest: "inspect-unknown", observationCursor: f.service.observation("run") });
    await f.stopped();
    assert.equal(f.calls.launch, 1);
    assert.equal(f.calls.reconcile, 1);
    assert.equal(Object.values(f.state().attempts)[0]?.state, "unknown_outcome");
  } finally { await f.close(); }
});

test("cancelling an auto-plan objective before its first turn prevents planner and work launches", async () => {
  const f = fixture();
  try {
    await f.service.start({ ...f.request, operationKind: "execute", autoPlan: true });
    await f.service.cancel({ runId: "run", taskId: "task", actor: f.request.actor, observationCursor: f.service.observation("run"), operationId: "cancel", requestDigest:"cancel-request" });
    await f.stopped();
    assert.equal(f.state().lifecycles.task, "cancelled");
    assert.equal(Object.values(f.state().workflows)[0]?.state, "cancelled");
    assert.equal(f.calls.launch, 0);
    assert.deepEqual(Object.keys(f.state().contracts), ["task"]);
  } finally { await f.close(); }
});

test("a Pi-scoped issuer cannot preflight another executor or planner",async()=>{
  const f=fixture(false,"horseness-pi-v1");
  try {
    await assert.rejects(f.service.start({...f.request,adapterId:"claude"}),/AUTHORIZATION_DENIED/);
    await assert.rejects(f.service.start({...f.request,operationKind:"execute",autoPlan:true,plannerAdapterId:"codex"}),/AUTHORIZATION_DENIED/);
    assert.equal(f.calls.resolve,0);assert.deepEqual(f.state().workflows,{});
  } finally {await f.close();}
});

test("cancellation terminalizes a durably prepared unlaunched attempt and recovers its exact result",async()=>{
  const f=fixture(true);
  try {
    await f.service.start(f.request);await f.stopped();
    assert.equal(Object.values(f.state().attempts)[0]?.state,"planned");assert.equal(f.calls.launch,0);
    const cancellation={runId:"run",taskId:"task",actor:f.request.actor,operationId:"cancel-prepared",requestDigest:"cancel-prepared-request",observationCursor:f.service.observation("run")};
    const cursor=await f.service.cancel(cancellation);
    assert.equal(f.state().lifecycles.task,"cancelled");assert.equal(Object.values(f.state().attempts)[0]?.state,"cancelled");assert.deepEqual(f.state().receipts,{});
    assert.equal(Object.values(f.state().aborted)[0]?.reasonCode,"OPERATOR_CANCELLED");
    assert.deepEqual(await f.service.cancel(cancellation),cursor);
    await assert.rejects(f.service.cancel({...cancellation,requestDigest:"changed"}),/OPERATION_ID_REUSED/);
    await f.service.close();
    const restarted=new TaskExecutionServiceV1(f.authority,"workspace",f.grantAuthority,f.hosts,()=>now);
    try {restarted.wake();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal((restarted.describe("run","task",f.request.actor) as Record<string,JsonValue>).lifecycle,"cancelled");assert.equal(f.calls.launch,0);}finally{await restarted.close();}
  } finally {await f.close();}
});

test("a receipt producer cannot turn a known foreign digest into its own readable output",async()=>{
  const f=fixture();
  try {
    await f.service.start(f.request);await f.stopped();
    const prepared=Object.values(f.state().prepared)[0]!;
    const head=f.authority.replay("workspace","run","run").at(-1)!;
    const bytes=Buffer.from("foreign scoped output"),digest=createHash("sha256").update(bytes).digest("hex");
    const event=sealEventEnvelope({schemaVersion:"1",streamKind:"run",workspaceId:"workspace",streamId:"run",sequence:head.envelope.sequence+1,priorEnvelopeHash:head.envelopeHash,eventId:"foreign-publication",eventType:"TaskCreatedV2",principalId:"owner",causationId:"foreign-publication",correlationId:"foreign-publication",idempotencyKey:"foreign-publication",payload:{eventType:"TaskCreatedV2" as const,workspaceId:"workspace",runId:"run",contract:{...f.state().contracts.task!,taskId:"foreign",title:"Foreign",instructions:"Foreign"}}});
    f.authority.publishAndAppendAtomic({commandId:"foreign-publication",run:{streamKind:"run",workspaceId:"workspace",streamId:"run",expectedSequence:head.envelope.sequence,expectedEnvelopeHash:head.envelopeHash,events:[event]},artifacts:[{data:bytes,mediaType:"text/plain",references:[{ownerKind:"event",ownerId:event.envelope.eventId}]}],requiredArtifactDigests:[digest]});
    const receipt=sealAttemptReceipt({schemaVersion:"1",workspaceId:"workspace",runId:"run",taskId:"task",attemptId:prepared.attemptId,generation:prepared.generation,attemptContextBindingDigest:attemptContextBindingDigest(prepared.binding),contextManifestCoreDigest:prepared.binding.contextManifestCoreDigest,forkPinDigest:prepared.forkPin.forkPinDigest,providerId:"pi-native-provider-v1",providerOperationId:"native-operation",providerIdempotencyKeyDigest:domainDigest("horseness.provider-idempotency-key.v1",prepared.binding.providerIdempotencyKey),producerPrincipalId:prepared.binding.allowedProducerPrincipalId,producerGrantDigest:prepared.binding.allowedProducerGrantDigest,adapterId:"horseness-pi-v1",adapterVersion:"0.1.0",hostId:"pi",hostVersion:"0.73.1",outcome:"succeeded",startedAt:now,finishedAt:now,outputDigest:digest,evidence:[],provenance:{profileDigest:taskExecutionProfileDigest(prepared.profile),observedHostId:"pi",observedHostVersion:"0.73.1",observedProviderId:"unit",observedModelId:"exact-model",nativeSessionId:"native-session",exitCode:0},nonce:"foreign-reference"});
    await assert.rejects(f.service.submitReceipt("run",receipt,{principalId:receipt.producerPrincipalId,grantDigest:receipt.producerGrantDigest}),/receipt object has no authorized attempt publication/);
    assert.deepEqual(f.state().receipts,{});assert.equal((f.service.describe("run","task",f.request.actor) as Record<string,JsonValue>).output,null);
    assert.deepEqual(f.authority.artifacts.readReferenced(digest),bytes);
  } finally {await f.close();}
});

test("fresh dispatch cannot launch a retained preparation with another profile",async()=>{
  const f=fixture(true);
  try {
    await f.service.start(f.request);await f.stopped();
    const original=Object.values(f.state().prepared)[0]!;
    f.hosts.resolve=async()=>({...profile,adapterId:"claude",hostId:"claude",hostVersion:"2.1.228",providerId:"anthropic",modelId:"claude-concrete",nativeExecutablePath:"/unit/claude",nativeExecutableDigest:"b".repeat(64)});
    await f.service.start({...f.request,operationId:"different-host",requestDigest:"different-host",adapterId:"claude",model:"claude-concrete",observationCursor:f.service.observation("run")});await f.stopped();
    assert.equal(f.calls.launch,0);assert.deepEqual(Object.values(f.state().prepared),[original]);
    assert.equal(Object.values(f.state().workflows).at(-1)?.reasonCode,"EXECUTION_PROFILE_MISMATCH");
  } finally {await f.close();}
});

test("a replacement scoped issuer cannot borrow a revoked issuer's planned attempt",async()=>{
  const f=fixture(true);
  try {
    await f.service.start(f.request);await f.stopped();f.revoke();
    const current=f.authority.authenticatedAuthorityState("workspace","grants"),state=current.state as unknown as {grants:AuthenticatedGrantV1[]};
    const replacement:AuthenticatedGrantV1={...state.grants[0]!,principalId:"replacement",grantDigest:"replacement-grant",revoked:false,adapterId:"horseness-pi-v1"};
    f.authority.compareAndSwapAuthorityState({commandId:"replacement",workspaceId:"workspace",stateKind:"grants",expectedRevision:current.revision,expectedStateDigest:current.stateDigest,nextState:{grants:[...state.grants,replacement]} as unknown as JsonValue});
    await f.service.start({...f.request,operationId:"new-issuer",requestDigest:"new-issuer",actor:{principalId:replacement.principalId,grantDigest:replacement.grantDigest},observationCursor:f.service.observation("run")});await f.stopped();
    assert.equal(f.calls.launch,0);assert.equal(Object.values(f.state().attempts)[0]?.state,"planned");
    assert.equal(Object.values(f.state().workflows).at(-1)?.reasonCode,"AUTHORIZATION_DENIED");
  } finally {await f.close();}
});
