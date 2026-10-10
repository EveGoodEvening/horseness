import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterKitError, createBindingGuard, createNativeTaskSpoolV1, nativeRenderedContextDigestV1, nativeExecutableDigestV1, resolveNativeExecutablePathV1, runNativeProcessV1, type NativeTaskAdapterOptionsV1, type NativeTaskAdapterSessionV1, type NativeTaskProfileOptionsV1, type NativeTaskTerminalV1 } from "@horseness/adapter-kit";
import { parseTaskEffortV1, taskExecutionProfileDigest, type TaskExecutionProfileV1 } from "@horseness/domain";
import { createOMPAdapterV1, OMP_ADAPTER_ID, OMP_HOST_VERSION } from "./index.js";
import type { AdapterCancelRequestV1, AdapterLaunchRequestV1, AdapterReconcileRequestV1, AdapterResumeRequestV1, WorkerAdapterV1 } from "@horseness/protocol";

export async function resolveOMPTaskProfileV1(options:NativeTaskProfileOptionsV1):Promise<TaskExecutionProfileV1>{
 options={...options};
 const {effort="medium"}=options;parseTaskEffortV1(effort);
 if(options.model===null||!/^[-a-zA-Z0-9_.]+\/[^\s:*?]+$/.test(options.model))throw new AdapterKitError("MODEL_REQUIRED","Specify exact provider/model; configured or fuzzy defaults cannot be frozen safely");
 const slash=options.model.indexOf("/"); const executablePath=await resolveNativeExecutablePathV1("omp",options.executablePath);
 const nativeExecutableDigest=await nativeExecutableDigestV1(executablePath);
 if(nativeExecutableDigest!=="60a12d6c14d4877efeef9e6cb86de3ba84e39be59e2e43204b09dbdd75386020")throw new Error("NATIVE_EXECUTABLE_UNTRUSTED: expected the pinned OMP 17.2.15 distribution entrypoint");
 const version=await runNativeProcessV1({executablePath,args:["--version"],cwd:options.workspacePath,timeoutMs:10000,maxOutputBytes:65536,env:{PATH:process.env.PATH??""}});
 if(version.exitCode!==0||(version.stdout+version.stderr).trim()!==`omp/${OMP_HOST_VERSION}`)throw new Error("NATIVE_VERSION_UNSUPPORTED");
 // Observe only non-secret identity fields through the pinned extension API.
 // No prompt is submitted, and discovery of project extensions/skills is disabled.
 const metadataDirectory=await mkdtemp(join(tmpdir(),"horseness-omp-profile-"));
 try{
  const metadataPath=join(metadataDirectory,"identity.json");const extensionPath=join(metadataDirectory,"identity.mjs");
  await writeFile(extensionPath,`import {writeFileSync} from "node:fs"; export default function(api){api.on("session_start",(_event,ctx)=>{writeFileSync(new URL("./identity.json",import.meta.url),JSON.stringify({providerId:ctx.model?.provider??null,modelId:ctx.model?.id??null,efforts:ctx.model?.thinking?.efforts??[]}),{mode:0o600,flag:"wx"});process.exit(0);});}`,{mode:0o600,flag:"wx"});
  const probe=await runNativeProcessV1({executablePath,args:["--mode","rpc","--no-session","--no-tools","--no-extensions","--no-skills","--no-rules","--no-title","--no-prewalk","--no-lsp","--no-pty","--extension",extensionPath,"--provider",options.model.slice(0,slash),"--model",options.model.slice(slash+1),"--thinking","off"],cwd:options.workspacePath,timeoutMs:10000,maxOutputBytes:65536});
  if(probe.exitCode!==0)throw new AdapterKitError("MODEL_UNAVAILABLE","Native host did not provide nonsecret model identity");
  const identityBytes=await readFile(metadataPath,"utf8").catch((error:unknown)=>{if((error as NodeJS.ErrnoException).code==="ENOENT")throw new AdapterKitError("MODEL_UNAVAILABLE","Native identity event was absent");throw error;});
  const identity=JSON.parse(identityBytes) as {providerId:unknown;modelId:unknown;efforts:unknown};
  if(identity.providerId!==options.model.slice(0,slash)||identity.modelId!==options.model.slice(slash+1))throw new AdapterKitError("MODEL_REQUIRED","Native host selected a fallback; specify the exact provider/model identity");
  if((effort==="xhigh"||effort==="max")&&(!Array.isArray(identity.efforts)||!identity.efforts.includes(effort)))throw new AdapterKitError("NATIVE_EFFORT_UNSUPPORTED","Requested model does not expose the selected thinking level");
 }finally{await rm(metadataDirectory,{recursive:true,force:true});}
 const timeoutMs=options.timeoutMs??300000;if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000)throw new Error("NATIVE_TIMEOUT_INVALID");
 return {schemaVersion:"1",adapterId:"omp",hostId:"omp",hostVersion:OMP_HOST_VERSION,nativeExecutablePath:executablePath,nativeExecutableDigest,providerId:options.model.slice(0,slash),modelId:options.model.slice(slash+1),purpose:options.purpose,effort,timeoutMs,maxOutputBytes:1048576,lookup:"local-terminal-record",idempotentLaunch:false};
}
export async function createOMPTaskAdapterV1(options:NativeTaskAdapterOptionsV1):Promise<NativeTaskAdapterSessionV1>{
 options={...structuredClone(options),renderedContext:options.renderedContext.normalize("NFC")};const profile=Object.freeze(options.profile);
 if(profile.adapterId!=="omp"||profile.hostId!=="omp"||profile.hostVersion!==OMP_HOST_VERSION||profile.purpose!==options.purpose||profile.lookup!=="local-terminal-record"||(profile.idempotentLaunch as unknown)!==false)throw new Error("NATIVE_PROFILE_MISMATCH");
 const spool=await createNativeTaskSpoolV1(options);let verified:TaskExecutionProfileV1=profile;
 if(!await spool.handedOff()){
  if(await nativeExecutableDigestV1(profile.nativeExecutablePath)!==profile.nativeExecutableDigest)throw new Error("NATIVE_PROFILE_MISMATCH");
  const resolved=await resolveOMPTaskProfileV1({...options,effort:profile.effort??"medium",model:profile.providerId+"/"+profile.modelId,executablePath:profile.nativeExecutablePath,timeoutMs:profile.timeoutMs});
  if(profile.effort===undefined){const legacy={...resolved};delete legacy.effort;verified=legacy;}else verified=resolved;
 }
 if(taskExecutionProfileDigest(verified)!==taskExecutionProfileDigest(profile))throw new Error("NATIVE_PROFILE_MISMATCH");
 if(Buffer.byteLength(options.renderedContext)>1048576)throw new Error("NATIVE_CONTEXT_LIMIT");
 const guard=createBindingGuard(options.binding);const controller=new AbortController();let active:Promise<NativeTaskTerminalV1>|undefined;
 async function collect(){if(active)return active;return spool.load();}
 const secure=createOMPAdapterV1({binding:options.binding,producerPrincipalId:options.producerPrincipalId,producerGrantDigest:options.producerGrantDigest,credential:{schemaVersion:"1",kind:"host-reference",reference:"native-host-session",scope:{workspaceId:options.binding.workspaceId,adapterId:OMP_ADAPTER_ID,purpose:"omp-provider-auth"}},runtime:{
 async launch(request){guard.assert(request);if(request.renderedContextDigest!==nativeRenderedContextDigestV1(options.renderedContext))throw new Error("NATIVE_CONTEXT_MISMATCH");if(active)return active;const retained=await spool.load();if(retained)return retained;if(await nativeExecutableDigestV1(profile.nativeExecutablePath)!==profile.nativeExecutableDigest)throw new Error("NATIVE_PROFILE_MISMATCH");
 const nativeGuardPath=join(options.stateDirectory,"identity-guard.mjs");const observationPath=join(options.stateDirectory,"native-observation.json");
 const thinking=profile.effort===undefined||profile.effort==="none"?"off":profile.effort;
 await writeFile(join(options.stateDirectory,"identity-config.json"),JSON.stringify({profileDigest:taskExecutionProfileDigest(profile),providerId:profile.providerId,modelId:profile.modelId,thinking:profile.effort===undefined?null:thinking}),{mode:0o600,flag:"wx"});
 await writeFile(nativeGuardPath,`import {readFileSync,writeFileSync} from "node:fs"; export default function(api){const config=JSON.parse(readFileSync(new URL("./identity-config.json",import.meta.url),"utf8"));function guard(ctx){if(ctx.model?.provider!==config.providerId||ctx.model?.id!==config.modelId)process.exit(23);if(config.thinking!==null&&api.getThinkingLevel()!==config.thinking)process.exit(24);}api.on("session_start",(_event,ctx)=>{guard(ctx);writeFileSync(new URL("./native-observation.json",import.meta.url),JSON.stringify({profileDigest:config.profileDigest,providerId:ctx.model.provider,modelId:ctx.model.id,nativeSessionId:ctx.sessionManager.getSessionId()}),{mode:0o600,flag:"wx"});});api.on("before_agent_start",(_event,ctx)=>{guard(ctx);});}`,{mode:0o600,flag:"wx"});
 await spool.begin();active=(async()=>{
 const startedAt=new Date().toISOString();
 const result=await runNativeProcessV1({executablePath:profile.nativeExecutablePath,args:["--print","--mode","json","--provider",profile.providerId,"--model",profile.modelId,"--thinking",thinking,"--session-dir",options.stateDirectory,"--no-extensions","--extension",nativeGuardPath,"--no-skills","--no-rules","--no-title",...(profile.purpose==="planner"?["--no-tools"]:[])],cwd:options.workspacePath,input:options.renderedContext,timeoutMs:profile.timeoutMs,maxOutputBytes:profile.maxOutputBytes,signal:controller.signal});
 if(result.exitCode===24)throw new AdapterKitError("NATIVE_EFFORT_UNSUPPORTED","Native model cannot honor the frozen thinking level");
 let header:Record<string,unknown>|undefined,end:Record<string,unknown>|undefined;
 for(let offset=0;offset<result.stdout.length;){
  const newline=result.stdout.indexOf("\n",offset);const boundary=newline<0?result.stdout.length:newline;
  const line=result.stdout.slice(offset,boundary);offset=boundary+1;if(line.trim()==="")continue;
  const event=JSON.parse(line) as Record<string,unknown>;
  if(event.type==="session"&&header===undefined)header=event;
  if(event.type==="agent_end")end=event;
 }
 if(typeof header?.id!=="string")throw new Error("NATIVE_SESSION_UNOBSERVABLE");
 const observed=JSON.parse(await readFile(observationPath,"utf8")) as {profileDigest:unknown;providerId:unknown;modelId:unknown;nativeSessionId:unknown};
 if(observed.profileDigest!==taskExecutionProfileDigest(profile)||observed.providerId!==profile.providerId||observed.modelId!==profile.modelId||observed.nativeSessionId!==header.id)throw new Error("NATIVE_MODEL_MISMATCH");
 if(!end||!Array.isArray(end.messages))throw new Error("NATIVE_TERMINAL_UNOBSERVABLE");
 let message:Record<string,unknown>|undefined;
 for(const nativeMessage of end.messages as Record<string,unknown>[]){if(nativeMessage.role!=="assistant")continue;if(nativeMessage.provider!==profile.providerId||nativeMessage.model!==profile.modelId)throw new Error("NATIVE_MODEL_MISMATCH");message=nativeMessage;}
 if(!message)throw new Error("NATIVE_MODEL_UNOBSERVABLE");
 const content=message.content;if(!Array.isArray(content))throw new Error("NATIVE_OUTPUT_UNOBSERVABLE");let output="";
 for(const part of content as Record<string,unknown>[]){if(part.type!=="text")continue;if(typeof part.text!=="string")throw new Error("NATIVE_OUTPUT_UNOBSERVABLE");output+=(output.length===0?"":"\n")+part.text;}
 const outcome=result.exitCode===0&&message.stopReason==="stop"?"succeeded":"failed";
 if(outcome==="succeeded"&&output.length===0)throw new Error("NATIVE_OUTPUT_UNOBSERVABLE");
 const outputDigest=outcome==="succeeded"?await spool.publish(Buffer.from(output),"text/plain"):null;
 const provenance={profileDigest:taskExecutionProfileDigest(profile),observedHostId:profile.hostId,observedHostVersion:verified.hostVersion,observedProviderId:message.provider as string,observedModelId:message.model as string,nativeSessionId:header.id,exitCode:result.exitCode};
 const evidenceBytes=Buffer.from(JSON.stringify({provenance,stderr:result.stderr,sessionHeader:header,message:{role:message.role,provider:message.provider,model:message.model,stopReason:message.stopReason,content:message.content,errorMessage:message.errorMessage}}));const evidenceDigest=await spool.publish(evidenceBytes,"application/json");const record:NativeTaskTerminalV1={providerOperationId:header.id,nativeSessionId:header.id,startedAt,finishedAt:new Date().toISOString(),outcome,outputDigest,evidence:[{digest:evidenceDigest,mediaType:"application/json",size:evidenceBytes.byteLength}],provenance};await spool.save(record);return record;
 })();return active;},async cancel(){controller.abort();return collect();},async reconcile(){return collect();},resume(){return Promise.reject(new Error("NATIVE_RESUME_UNSUPPORTED"));},async collect(){return collect();}}});
 const adapter:WorkerAdapterV1={
  async detectCapabilities(){const capabilities=await secure.detectCapabilities();return {...capabilities,cancel:false,reattach:"unsupported",nativeResume:"unsupported",contextInjection:"bytes",outputMediaTypes:["text/plain"]};},
  async launch(request:AdapterLaunchRequestV1){guard.assert(request);if(request.renderedContextDigest!==nativeRenderedContextDigestV1(options.renderedContext))throw new Error("NATIVE_CONTEXT_MISMATCH");return secure.launch(request);},
  async cancel(request:AdapterCancelRequestV1){guard.assert(request);return Promise.reject(new Error("NATIVE_CANCEL_UNSUPPORTED"));},
  async reconcile(request:AdapterReconcileRequestV1){guard.assert(request);const record=await collect();if(record===null)throw new Error("UNKNOWN_OUTCOME");return secure.reconcile(request);},
  async resume(request:AdapterResumeRequestV1){guard.assert(request);return Promise.reject(new Error("NATIVE_RESUME_UNSUPPORTED"));},
  collectReceipt:secure.collectReceipt.bind(secure),
 };
 return {adapter,publication:spool.publication.bind(spool),async close(){controller.abort();if(active)await active.catch(()=>undefined);await spool.close();}};
}
