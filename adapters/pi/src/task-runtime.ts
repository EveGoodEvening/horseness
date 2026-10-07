import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AdapterKitError, createBindingGuard, createNativeTaskSpoolV1, nativeRenderedContextDigestV1, nativeExecutableDigestV1, resolveNativeExecutablePathV1, runNativeProcessV1, type NativeTaskAdapterOptionsV1, type NativeTaskAdapterSessionV1, type NativeTaskProfileOptionsV1, type NativeTaskTerminalV1 } from "@horseness/adapter-kit";
import { taskExecutionProfileDigest, type TaskExecutionProfileV1 } from "@horseness/domain";
import { createPiAdapterV1, PI_ADAPTER_ID, PI_HOST_VERSION } from "./index.js";
import type { AdapterCancelRequestV1, AdapterLaunchRequestV1, AdapterReconcileRequestV1, AdapterResumeRequestV1, WorkerAdapterV1 } from "@horseness/protocol";

export async function resolvePiTaskProfileV1(options:NativeTaskProfileOptionsV1):Promise<TaskExecutionProfileV1>{
 options={...options};
 if(options.model===null||!/^[-a-zA-Z0-9_.]+\/[^\s:*?]+$/.test(options.model))throw new AdapterKitError("MODEL_REQUIRED","Specify exact provider/model; configured or fuzzy defaults cannot be frozen safely");
 const slash=options.model.indexOf("/"); const executablePath=await resolveNativeExecutablePathV1("pi",options.executablePath);
 const nativeExecutableDigest=await nativeExecutableDigestV1(executablePath);
 if(nativeExecutableDigest!=="e959f463b06ddd15ed882783ac02f39ecaeef950ef967da86380f39dda6595fa")throw new Error("NATIVE_EXECUTABLE_UNTRUSTED: expected the pinned Pi 0.73.1 distribution entrypoint");
 const version=await runNativeProcessV1({executablePath,args:["--version"],cwd:options.workspacePath,timeoutMs:10000,maxOutputBytes:65536,env:{PATH:process.env.PATH??""}});
 if(version.exitCode!==0||(version.stdout+version.stderr).trim()!==PI_HOST_VERSION)throw new Error("NATIVE_VERSION_UNSUPPORTED");
 // The pinned CLI's dedicated catalog emits provider/id and non-secret sizing flags.
 const providerId=options.model.slice(0,slash),modelId=options.model.slice(slash+1);
 const listing=await runNativeProcessV1({executablePath,args:["--list-models",modelId,"--no-session","--no-tools","--no-extensions","--no-skills","--no-prompt-templates","--no-themes","--no-context-files"],cwd:options.workspacePath,timeoutMs:10000,maxOutputBytes:65536});
 const exact=listing.exitCode===0&&(listing.stdout+"\n"+listing.stderr).split("\n").some(line=>{const columns=line.trim().split(/\s+/u);return columns.length===6&&columns[0]===providerId&&columns[1]===modelId;});
 if(!exact)throw new AdapterKitError("MODEL_UNAVAILABLE","Requested provider/model is not exposed exactly by the native nonsecret catalog");
 const timeoutMs=options.timeoutMs??300000;if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>3600000)throw new Error("NATIVE_TIMEOUT_INVALID");
 return {schemaVersion:"1",adapterId:"pi",hostId:"pi",hostVersion:PI_HOST_VERSION,nativeExecutablePath:executablePath,nativeExecutableDigest,providerId:options.model.slice(0,slash),modelId:options.model.slice(slash+1),purpose:options.purpose,timeoutMs,maxOutputBytes:1048576,lookup:"local-terminal-record",idempotentLaunch:false};
}
export async function createPiTaskAdapterV1(options:NativeTaskAdapterOptionsV1):Promise<NativeTaskAdapterSessionV1>{
 options={...structuredClone(options),renderedContext:options.renderedContext.normalize("NFC")};const profile=Object.freeze(options.profile);
 if(profile.adapterId!=="pi"||profile.hostId!=="pi"||profile.hostVersion!==PI_HOST_VERSION||profile.purpose!==options.purpose||profile.lookup!=="local-terminal-record"||profile.idempotentLaunch!==false)throw new Error("NATIVE_PROFILE_MISMATCH");
 const spool=await createNativeTaskSpoolV1(options);let verified:TaskExecutionProfileV1=profile;
 if(!await spool.handedOff()){
  if(await nativeExecutableDigestV1(profile.nativeExecutablePath)!==profile.nativeExecutableDigest)throw new Error("NATIVE_PROFILE_MISMATCH");
  verified=await resolvePiTaskProfileV1({...options,model:profile.providerId+"/"+profile.modelId,executablePath:profile.nativeExecutablePath,timeoutMs:profile.timeoutMs});
 }
 if(taskExecutionProfileDigest(verified)!==taskExecutionProfileDigest(profile))throw new Error("NATIVE_PROFILE_MISMATCH");
 if(Buffer.byteLength(options.renderedContext)>1048576)throw new Error("NATIVE_CONTEXT_LIMIT");
 const guard=createBindingGuard(options.binding);const controller=new AbortController();let active:Promise<NativeTaskTerminalV1>|undefined;
 async function collect(){if(active)return active;return spool.load();}
 const secure=createPiAdapterV1({binding:options.binding,producerPrincipalId:options.producerPrincipalId,producerGrantDigest:options.producerGrantDigest,credential:{schemaVersion:"1",kind:"host-reference",reference:"native-host-session",scope:{workspaceId:options.binding.workspaceId,adapterId:PI_ADAPTER_ID,purpose:"pi-provider-auth"}},runtime:{
 async launch(request){guard.assert(request);if(request.renderedContextDigest!==nativeRenderedContextDigestV1(options.renderedContext))throw new Error("NATIVE_CONTEXT_MISMATCH");if(active)return active;const retained=await spool.load();if(retained)return retained;if(await nativeExecutableDigestV1(profile.nativeExecutablePath)!==profile.nativeExecutableDigest)throw new Error("NATIVE_PROFILE_MISMATCH");
 const nativeGuardPath=join(options.stateDirectory,"identity-guard.mjs");const observationPath=join(options.stateDirectory,"native-observation.json");
 await writeFile(join(options.stateDirectory,"identity-config.json"),JSON.stringify({profileDigest:taskExecutionProfileDigest(profile),providerId:profile.providerId,modelId:profile.modelId}),{mode:0o600,flag:"wx"});
 await writeFile(nativeGuardPath,`import {readFileSync,writeFileSync} from "node:fs"; export default function(api){const config=JSON.parse(readFileSync(new URL("./identity-config.json",import.meta.url),"utf8"));api.on("session_start",(_event,ctx)=>{if(ctx.model?.provider!==config.providerId||ctx.model?.id!==config.modelId)process.exit(23);writeFileSync(new URL("./native-observation.json",import.meta.url),JSON.stringify({profileDigest:config.profileDigest,providerId:ctx.model.provider,modelId:ctx.model.id,nativeSessionId:ctx.sessionManager.getSessionId()}),{mode:0o600,flag:"wx"});});api.on("before_agent_start",(_event,ctx)=>{if(ctx.model?.provider!==config.providerId||ctx.model?.id!==config.modelId)process.exit(23);});}`,{mode:0o600,flag:"wx"});
 await spool.begin();active=(async()=>{
 const startedAt=new Date().toISOString();
 const result=await runNativeProcessV1({executablePath:profile.nativeExecutablePath,args:["--print","--mode","json","--provider",profile.providerId,"--model",profile.modelId,"--thinking","off","--session-dir",options.stateDirectory,"--no-extensions","--extension",nativeGuardPath,"--no-skills","--no-prompt-templates",...(profile.purpose==="planner"?["--no-tools"]:[])],cwd:options.workspacePath,input:options.renderedContext,timeoutMs:profile.timeoutMs,maxOutputBytes:profile.maxOutputBytes,signal:controller.signal});
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
 for(const part of content){if(part.type!=="text")continue;if(typeof part.text!=="string")throw new Error("NATIVE_OUTPUT_UNOBSERVABLE");output+=(output.length===0?"":"\n")+part.text;}
 const outcome=result.exitCode===0&&message.stopReason==="stop"?"succeeded":"failed";
 if(outcome==="succeeded"&&output.length===0)throw new Error("NATIVE_OUTPUT_UNOBSERVABLE");
 const outputDigest=outcome==="succeeded"?await spool.publish(Buffer.from(output),"text/plain"):null;
 const provenance={profileDigest:taskExecutionProfileDigest(profile),observedHostId:profile.hostId,observedHostVersion:verified.hostVersion,observedProviderId:message.provider as string,observedModelId:message.model as string,nativeSessionId:header.id,exitCode:result.exitCode};
 const evidenceBytes=Buffer.from(JSON.stringify({provenance,stderr:result.stderr,sessionHeader:header,message:{role:message.role,provider:message.provider,model:message.model,stopReason:message.stopReason,content:message.content,errorMessage:message.errorMessage}}));const evidenceDigest=await spool.publish(evidenceBytes,"application/json");const record:NativeTaskTerminalV1={providerOperationId:header.id,nativeSessionId:header.id,startedAt,finishedAt:new Date().toISOString(),outcome,outputDigest,evidence:[{digest:evidenceDigest,mediaType:"application/json",size:evidenceBytes.byteLength}],provenance};await spool.save(record);return record;
 })();return active;},async cancel(){controller.abort();return collect();},async reconcile(){return collect();},async resume(){throw new Error("NATIVE_RESUME_UNSUPPORTED");},async collect(){return collect();}}});
 const adapter:WorkerAdapterV1={
  async detectCapabilities(){const capabilities=await secure.detectCapabilities();return {...capabilities,cancel:false,reattach:"unsupported",nativeResume:"unsupported",contextInjection:"bytes",outputMediaTypes:["text/plain"]};},
  async launch(request:AdapterLaunchRequestV1){guard.assert(request);if(request.renderedContextDigest!==nativeRenderedContextDigestV1(options.renderedContext))throw new Error("NATIVE_CONTEXT_MISMATCH");return secure.launch(request);},
  async cancel(request:AdapterCancelRequestV1){guard.assert(request);throw new Error("NATIVE_CANCEL_UNSUPPORTED");},
  async reconcile(request:AdapterReconcileRequestV1){guard.assert(request);const record=await collect();if(record===null)throw new Error("UNKNOWN_OUTCOME");return secure.reconcile(request);},
  async resume(request:AdapterResumeRequestV1){guard.assert(request);throw new Error("NATIVE_RESUME_UNSUPPORTED");},
  collectReceipt:secure.collectReceipt.bind(secure),
 };
 return {adapter,publication:spool.publication,async close(){controller.abort();if(active)await active.catch(()=>{});await spool.close();}};
}
