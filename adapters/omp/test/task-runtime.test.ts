import assert from "node:assert/strict";
import test from "node:test";
import { resolveOMPTaskProfileV1, createOMPTaskAdapterV1 } from "../src/index.js";
import type { TaskEffortV1 } from "@horseness/domain";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeTaskSpoolV1, type NativeTaskAdapterOptionsV1, type NativeTaskTerminalV1 } from "@horseness/adapter-kit";
import { taskExecutionProfileDigest, verifyAttemptReceipt } from "@horseness/domain";

void test("OMP requires a concrete provider/model before executable resolution",async()=>{
 for(const model of [null,"sonnet","anthropic/*","anthropic/claude-sonnet:high"]){
  await assert.rejects(resolveOMPTaskProfileV1({workspacePath:"/unavailable",executablePath:"/unavailable/omp",model,purpose:"planner"}),error=>error instanceof Error&&"code" in error&&error.code==="MODEL_REQUIRED");
 }
});
void test("OMP rejects invalid effort before native inspection",async()=>{
 for(const effort of [null,"ultra",1])await assert.rejects(resolveOMPTaskProfileV1({workspacePath:"/unused",model:"provider/model",purpose:"work",executablePath:"/does-not-exist",effort:effort as TaskEffortV1}),{code:"EXECUTION_INVALID"});
});
for(const [effort,outcome] of [[undefined,"failed"],[undefined,"cancelled"],["off","failed"],["none","failed"],["xhigh","failed"],["max","failed"]] as const)void test(`OMP preserves frozen ${effort??"legacy"} selections when collecting retained ${outcome} receipts`,async()=>{
 const stateDirectory=await mkdtemp(join(tmpdir(),"horseness-omp-terminal-"));
 const options:NativeTaskAdapterOptionsV1={binding:{schemaVersion:"1",workspaceId:"workspace",runId:"run",taskId:"task",attemptId:"attempt",generation:1,forkPinDigest:"fork",contextManifestCoreDigest:"manifest",attemptContextBindingDigest:"binding",providerIdempotencyKeyDigest:"key",attemptCapability:"capability"},producerPrincipalId:"producer",producerGrantDigest:"grant",workspacePath:stateDirectory,stateDirectory,renderedContext:"task context",model:"provider/model",purpose:"work",profile:{schemaVersion:"1",adapterId:"omp",hostId:"omp",hostVersion:"17.2.15",nativeExecutablePath:"/unavailable/omp",nativeExecutableDigest:"a".repeat(64),providerId:"provider",modelId:"model",purpose:"work",timeoutMs:1000,maxOutputBytes:1048576,lookup:"local-terminal-record",idempotentLaunch:false}};
 if(effort!==undefined)options.profile={...options.profile,effort};
 try{
  const spool=await createNativeTaskSpoolV1(options);await spool.begin();const bytes=Buffer.from(JSON.stringify({content:[{type:"text",text:"partial native diagnostic"}],errorMessage:"provider rejected request"}));const digest=await spool.publish(bytes,"application/json");
  const provenance={profileDigest:taskExecutionProfileDigest(options.profile),observedHostId:"omp",observedHostVersion:"17.2.15",observedProviderId:"provider",observedModelId:"model",nativeSessionId:"native-session",exitCode:1};
  const record:NativeTaskTerminalV1={providerOperationId:"native-session",nativeSessionId:"native-session",startedAt:"2026-10-06T00:00:00Z",finishedAt:"2026-10-06T00:01:00Z",outcome,outputDigest:null,evidence:[{digest,mediaType:"application/json",size:bytes.byteLength}],provenance};await spool.save(record);
  const session=await createOMPTaskAdapterV1({...options,effort:"high"});
  try{const receipt=await session.adapter.collectReceipt(options.binding);verifyAttemptReceipt(receipt);assert.equal(receipt.outcome,outcome);assert.equal(receipt.outputDigest,null);assert.deepEqual(receipt.provenance,provenance);assert.deepEqual((await session.publication(digest)).bytes,bytes);assert.deepEqual(await session.adapter.collectReceipt(options.binding),receipt);
   await assert.rejects(async()=>session.adapter.collectReceipt({...options.binding,attemptId:"other"}),{code:"BINDING_SUBSTITUTED"});await writeFile(join(stateDirectory,digest+".bytes"),"substituted");await assert.rejects(session.adapter.collectReceipt(options.binding),/PUBLICATION_DIGEST_MISMATCH/);
  }finally{await session.close();}
 }finally{await rm(stateDirectory,{recursive:true,force:true});}
});
