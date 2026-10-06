import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { taskExecutionProfileDigest } from "@horseness/domain";
import { createNativeTaskSpoolV1, nativeRenderedContextDigestV1, runNativeProcessV1, type NativeTaskAdapterOptionsV1, type NativeTaskTerminalV1 } from "../src/index.js";

async function withSpool(run:(options:NativeTaskAdapterOptionsV1)=>Promise<void>){
 const stateDirectory=await mkdtemp(join(tmpdir(),"horseness-native-task-"));
 const options:NativeTaskAdapterOptionsV1={binding:{schemaVersion:"1",workspaceId:"workspace",runId:"run",taskId:"task",attemptId:"attempt",generation:1,forkPinDigest:"fork-digest",contextManifestCoreDigest:"manifest-digest",attemptContextBindingDigest:"binding-digest",providerIdempotencyKeyDigest:"key-digest",attemptCapability:"capability-reference"},producerPrincipalId:"producer",producerGrantDigest:"grant-digest",workspacePath:stateDirectory,stateDirectory,renderedContext:"task context",model:"provider/model",purpose:"work",profile:{schemaVersion:"1",adapterId:"pi",hostId:"pi",hostVersion:"0.73.1",nativeExecutablePath:"/trusted/pi",nativeExecutableDigest:"a".repeat(64),providerId:"provider",modelId:"model",purpose:"work",timeoutMs:1000,maxOutputBytes:1048576,lookup:"local-terminal-record",idempotentLaunch:false}};
 try{await run(options);}finally{await rm(stateDirectory,{recursive:true,force:true});}
}
async function terminal(options:NativeTaskAdapterOptionsV1):Promise<NativeTaskTerminalV1>{const spool=await createNativeTaskSpoolV1(options);const outputDigest=await spool.publish(Buffer.from("actual successful output"),"text/plain");return {providerOperationId:"native-operation",nativeSessionId:"native-session",startedAt:"2026-10-06T00:00:00Z",finishedAt:"2026-10-06T00:01:00Z",outcome:"succeeded",outputDigest,evidence:[],provenance:{profileDigest:taskExecutionProfileDigest(options.profile),observedHostId:"pi",observedHostVersion:"0.73.1",observedProviderId:"provider",observedModelId:"model",nativeSessionId:"native-session",exitCode:0}};}

test("handoff without a retained terminal cannot authorize a second launch",async()=>withSpool(async options=>{const spool=await createNativeTaskSpoolV1(options);assert.equal(await spool.load(),null);await spool.begin();const reopened=await createNativeTaskSpoolV1(options);await assert.rejects(reopened.load(),/UNKNOWN_OUTCOME/);await assert.rejects(reopened.begin(),{code:"EEXIST"});}));
test("terminal recovery binds profile and immutable attempt",async()=>withSpool(async options=>{const spool=await createNativeTaskSpoolV1(options);await spool.begin();const record=await terminal(options);await spool.save(record);assert.deepEqual(await (await createNativeTaskSpoolV1(options)).load(),record);const substituted=await createNativeTaskSpoolV1({...options,binding:{...options.binding,attemptId:"different"}});await assert.rejects(substituted.load(),/NATIVE_BINDING_MISMATCH/);const changedProfile=await createNativeTaskSpoolV1({...options,profile:{...options.profile,modelId:"other"}});await assert.rejects(changedProfile.load(),/NATIVE_BINDING_MISMATCH/);}));
test("a successful retained terminal must report the frozen native model",async()=>withSpool(async options=>{const spool=await createNativeTaskSpoolV1(options);await spool.begin();const record=await terminal(options);await assert.rejects(spool.save({...record,provenance:{...(record.provenance as object),observedModelId:"other"}}),/NATIVE_MODEL_MISMATCH/);await assert.rejects(spool.load(),/UNKNOWN_OUTCOME/);}));
test("retained provenance cannot substitute profile or native host identity",async()=>withSpool(async options=>{
 const spool=await createNativeTaskSpoolV1(options);await spool.begin();const record=await terminal(options);
 await assert.rejects(spool.save({...record,provenance:{...(record.provenance as object),profileDigest:"substituted"}}),/NATIVE_PROFILE_MISMATCH/);
 await assert.rejects(spool.save({...record,provenance:{...(record.provenance as object),observedHostVersion:"other"}}),/NATIVE_MODEL_MISMATCH/);
 await assert.rejects(spool.save({...record,provenance:{...(record.provenance as object),nativeSessionId:null}}),/NATIVE_TERMINAL_UNOBSERVABLE/);
}));
test("retained terminal tampering is rejected",async()=>withSpool(async options=>{const spool=await createNativeTaskSpoolV1(options);await spool.begin();await spool.save(await terminal(options));const path=join(options.stateDirectory,"terminal.json");const envelope=JSON.parse(await readFile(path,"utf8"));envelope.record.nativeSessionId="substituted";await writeFile(path,JSON.stringify(envelope));await assert.rejects(spool.load(),/NATIVE_TERMINAL_TAMPERED/);}));
test("publication bytes are verified after restart and reject substitution",async()=>withSpool(async options=>{const spool=await createNativeTaskSpoolV1(options);await spool.begin();const bytes=Buffer.from("actual output");const digest=await spool.publish(bytes,"text/plain");const recovered=await createNativeTaskSpoolV1(options);assert.deepEqual((await recovered.publication(digest)).bytes,bytes);await writeFile(join(options.stateDirectory,digest+".bytes"),"substituted");await assert.rejects(recovered.publication(digest),/PUBLICATION_DIGEST_MISMATCH/);await assert.rejects(recovered.publication("../terminal"),/PUBLICATION_DIGEST_INVALID/);}));
test("rendered context digest uses the existing NFC context-source namespace",()=>{assert.equal(nativeRenderedContextDigestV1("e\u0301"),nativeRenderedContextDigestV1("é"));assert.notEqual(nativeRenderedContextDigestV1("one"),nativeRenderedContextDigestV1("two"));});
test("bounded native process preserves Unicode written in separate pipe chunks",async()=>{
 const lines:string[]=[];
 const result=await runNativeProcessV1({executablePath:process.execPath,args:["-e","process.stdout.write(Buffer.from([0xc3]),()=>process.stdout.write(Buffer.from([0xa9,10])))"],cwd:tmpdir(),timeoutMs:1000,maxOutputBytes:1024,onLine(line){lines.push(line);}});
 assert.equal(result.stdout,"é\n");assert.deepEqual(lines,["é"]);assert.equal(result.exitCode,0);
});
test("native process rejects oversized output instead of returning a truncated success",async()=>{
 await assert.rejects(runNativeProcessV1({executablePath:process.execPath,args:["-e","process.stdout.write('x'.repeat(4096))"],cwd:tmpdir(),timeoutMs:1000,maxOutputBytes:1024}),/NATIVE_OUTPUT_LIMIT/);
});

test("native processes do not inherit provider secrets or executable preload options",async()=>{
 const result=await runNativeProcessV1({executablePath:process.execPath,args:["-e","process.stdout.write(JSON.stringify({home:process.env.HOME,key:process.env.OPENAI_API_KEY??null,preload:process.env.NODE_OPTIONS??null}))"],cwd:tmpdir(),timeoutMs:1000,maxOutputBytes:1024,env:{HOME:tmpdir(),OPENAI_API_KEY:"unit-only-marker",NODE_OPTIONS:"--require /must-not-run.js"}});
 assert.deepEqual(JSON.parse(result.stdout),{home:tmpdir(),key:null,preload:null});assert.equal(result.exitCode,0);
});
test("terminal output invariants reject invalid records before retention",async()=>withSpool(async options=>{
 const spool=await createNativeTaskSpoolV1(options);await spool.begin();const record=await terminal(options);
 await assert.rejects(spool.save({...record,outputDigest:null}),/NATIVE_TERMINAL_OUTPUT_INVALID/);
 for(const outcome of ["failed","cancelled"] as const)await assert.rejects(spool.save({...record,outcome}),/NATIVE_TERMINAL_OUTPUT_INVALID/);
 await assert.rejects(spool.save({...record,outputDigest:"b".repeat(64)}),{code:"ENOENT"});
 await assert.rejects(spool.load(),/UNKNOWN_OUTCOME/);
}));
for(const outcome of ["failed","cancelled"] as const)test(`${outcome} terminals retain diagnostics without completion output`,async()=>withSpool(async options=>{
 const spool=await createNativeTaskSpoolV1(options);await spool.begin();const success=await terminal(options);
 const bytes=Buffer.from("native diagnostic: partial answer, provider rejected request");const digest=await spool.publish(bytes,"text/plain");
 const record:NativeTaskTerminalV1={...success,outcome,outputDigest:null,evidence:[{digest,mediaType:"text/plain",size:bytes.byteLength}],provenance:{...(success.provenance as object),exitCode:1}};
 await spool.save(record);const recovered=await createNativeTaskSpoolV1(options);assert.deepEqual(await recovered.load(),record);assert.deepEqual((await recovered.publication(digest)).bytes,bytes);
 await assert.rejects((await createNativeTaskSpoolV1({...options,binding:{...options.binding,attemptId:"other"}})).load(),/NATIVE_BINDING_MISMATCH/);
 await writeFile(join(options.stateDirectory,digest+".bytes"),"substituted diagnostic");await assert.rejects(recovered.load(),/PUBLICATION_DIGEST_MISMATCH/);
}));
test("successful terminal reload verifies its published output",async()=>withSpool(async options=>{
 const spool=await createNativeTaskSpoolV1(options);await spool.begin();const record=await terminal(options);await spool.save(record);
 await writeFile(join(options.stateDirectory,record.outputDigest+".bytes"),"substituted output");await assert.rejects((await createNativeTaskSpoolV1(options)).load(),/PUBLICATION_DIGEST_MISMATCH/);
}));
