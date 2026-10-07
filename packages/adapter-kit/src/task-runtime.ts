import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, delimiter } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { domainDigest, parseTaskExecutionProfileV1, parseTaskExecutionReceiptProvenanceV1, taskExecutionProfileDigest, type TaskExecutionProfileV1, type JsonValue } from "@horseness/domain";
import type { BoundAdapterOperationV1, WorkerAdapterV1 } from "@horseness/protocol";

export interface NativeTaskProfileOptionsV1 {
 readonly workspacePath:string;
 readonly model:string|null;
 readonly purpose:"work"|"planner";
 readonly executablePath?:string;
 readonly timeoutMs?:number;
}
export interface NativeTaskAdapterOptionsV1 extends NativeTaskProfileOptionsV1 {
 readonly binding:BoundAdapterOperationV1;
 readonly producerPrincipalId:string;
 readonly producerGrantDigest:string;
 readonly stateDirectory:string;
 readonly renderedContext:string;
 readonly profile:TaskExecutionProfileV1;
}
export interface NativeTaskPublicationV1 { readonly digest:string; readonly mediaType:string; readonly bytes:Uint8Array }
export interface NativeTaskAdapterSessionV1 {
 readonly adapter:WorkerAdapterV1;
 publication(digest:string):Promise<NativeTaskPublicationV1>;
 close():Promise<void>;
}
export interface NativeTaskTerminalV1 {
 readonly providerOperationId:string;
 readonly nativeSessionId:string;
 readonly startedAt:string;
 readonly finishedAt:string;
 readonly outcome:"succeeded"|"failed"|"cancelled";
 readonly outputDigest:string|null;
 readonly evidence:readonly {readonly digest:string;readonly mediaType:string;readonly size:number}[];
 readonly provenance:JsonValue;
}
export interface NativeTaskSpoolV1 {
 begin():Promise<void>;
 handedOff():Promise<boolean>;
 load():Promise<NativeTaskTerminalV1|null>;
 save(record:NativeTaskTerminalV1):Promise<void>;
 publish(bytes:Uint8Array,mediaType:string):Promise<string>;
 publication(digest:string):Promise<NativeTaskPublicationV1>;
 close():Promise<void>;
}
export interface NativeProcessOptionsV1 {
 readonly executablePath:string;
 readonly args:readonly string[];
 readonly cwd:string;
 readonly timeoutMs:number;
 readonly maxOutputBytes:number;
 readonly input?:string;
 readonly env?:Record<string,string>;
 readonly signal?:AbortSignal;
 readonly onLine?:(line:string,write:(input:string)=>void,end:()=>void)=>void;
}
export interface NativeProcessResultV1 { readonly stdout:string; readonly stderr:string; readonly exitCode:number|null }
const NATIVE_ENVIRONMENT_KEYS:Readonly<Record<string,true>>={HOME:true,PATH:true,USER:true,LOGNAME:true,SHELL:true,LANG:true,LC_ALL:true,LC_CTYPE:true,TZ:true,TERM:true,COLORTERM:true,NO_COLOR:true,TMPDIR:true,TMP:true,TEMP:true,APPDATA:true,LOCALAPPDATA:true,USERPROFILE:true,SYSTEMROOT:true,WINDIR:true,COMSPEC:true,PATHEXT:true,PI_CODING_AGENT_DIR:true,OMP_CONFIG_DIR:true,OMP_HOME:true,CODEX_HOME:true,CLAUDE_CONFIG_DIR:true,NODE_EXTRA_CA_CERTS:true,SSL_CERT_FILE:true,SSL_CERT_DIR:true};
export function nativeBytesDigestV1(bytes:Uint8Array):string { return createHash("sha256").update(bytes).digest("hex"); }
export function nativeRenderedContextDigestV1(text:string):string {
 return domainDigest("horseness.context-source-bytes.v1",Buffer.from(text.normalize("NFC")).toString("base64"));
}
export async function resolveNativeExecutablePathV1(command:string,configuredPath?:string):Promise<string> {
 if(configuredPath!==undefined){
  if(!isAbsolute(configuredPath))throw new Error("NATIVE_EXECUTABLE_REQUIRED");
  await access(configuredPath,constants.X_OK);
  return realpath(configuredPath);
 }
 if(!/^[a-zA-Z0-9_-]+$/.test(command))throw new Error("NATIVE_EXECUTABLE_INVALID");
 for(const directory of (process.env.PATH??"").split(delimiter)){
  if(!isAbsolute(directory))continue;
  const candidate=join(directory,command);
  try{await access(candidate,constants.X_OK);if((await stat(candidate)).isFile())return await realpath(candidate);}catch(error){
   if(!["ENOENT","ENOTDIR","EACCES"].includes((error as NodeJS.ErrnoException).code??""))throw error;
  }
 }
 throw new Error("NATIVE_RUNTIME_UNAVAILABLE: "+command);
}
export async function nativeExecutableDigestV1(path:string):Promise<string> {
 if(!isAbsolute(path))throw new Error("NATIVE_EXECUTABLE_REQUIRED");
 const resolved=await realpath(path);
 await access(resolved,constants.X_OK);
 if(!(await stat(resolved)).isFile())throw new Error("NATIVE_EXECUTABLE_INVALID");
 const hash=createHash("sha256");
 for await(const bytes of createReadStream(resolved))hash.update(bytes as Buffer);
 return hash.digest("hex");
}
export async function runNativeProcessV1(options:NativeProcessOptionsV1):Promise<NativeProcessResultV1> {
 if(!isAbsolute(options.executablePath)||!isAbsolute(options.cwd)||!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<=0||options.timeoutMs>3600000||!Number.isSafeInteger(options.maxOutputBytes)||options.maxOutputBytes<=0||options.maxOutputBytes>16777216||options.args.length>128||options.args.some(arg=>arg.includes("\0"))||options.args.reduce((size,arg)=>size+Buffer.byteLength(arg),0)>1048576||options.input!==undefined&&Buffer.byteLength(options.input)>1048576)throw new Error("NATIVE_PROCESS_OPTIONS_INVALID");
 if(options.env!==undefined&&(Object.keys(options.env).length>256||Object.entries(options.env).some(([key,value])=>key.includes("=")||key.includes("\0")||value.includes("\0")||Buffer.byteLength(key)+Buffer.byteLength(value)>32768)))throw new Error("NATIVE_PROCESS_ENV_INVALID");
 const {promise,resolve,reject}=Promise.withResolvers<NativeProcessResultV1>();
 const grouped=process.platform!=="win32";
 const env:Record<string,string>={};
 for(const [key,value] of Object.entries(options.env??process.env))if(Object.hasOwn(NATIVE_ENVIRONMENT_KEYS,key)&&typeof value==="string")env[key]=value;
 const child=spawn(options.executablePath,[...options.args],{cwd:options.cwd,env,detached:grouped,stdio:["pipe","pipe","pipe"]});
 let stdout="",stderr="",lineBuffer="",size=0,failure:Error|undefined;
 const stdoutDecoder=new StringDecoder("utf8"),stderrDecoder=new StringDecoder("utf8");
 const kill=(error:Error)=>{
  failure??=error;
  try{if(grouped&&child.pid!==undefined)process.kill(-child.pid,"SIGKILL");else child.kill("SIGKILL");}catch(killError){if((killError as NodeJS.ErrnoException).code!=="ESRCH")failure??=killError as Error;}
 };
 const abort=()=>{kill(new Error("NATIVE_CANCELLED"));};
 const timer=setTimeout(()=>{kill(new Error("NATIVE_TIMEOUT"));},options.timeoutMs);
 options.signal?.addEventListener("abort",abort,{once:true});
 if(options.signal?.aborted)abort();
 const consume=(text:string,out:boolean)=>{
  if(!out){stderr+=text;return;}
  stdout+=text;
  if(options.onLine===undefined)return;
  lineBuffer+=text;
  let index:number;
  while((index=lineBuffer.indexOf("\n"))>=0){
   const line=lineBuffer.slice(0,index);lineBuffer=lineBuffer.slice(index+1);
   if(line.trim()==="")continue;
   try{options.onLine(line,input=>{child.stdin.write(input);},()=>{child.stdin.end();});}
   catch(error){kill(error instanceof Error?error:new Error(String(error)));}
  }
 };
 const chunk=(bytes:Buffer,out:boolean)=>{
  size+=bytes.byteLength;
  if(size>options.maxOutputBytes){kill(new Error("NATIVE_OUTPUT_LIMIT"));return;}
  consume((out?stdoutDecoder:stderrDecoder).write(bytes),out);
 };
 child.stdout.on("data",(bytes:Buffer)=>{chunk(bytes,true);});
 child.stderr.on("data",(bytes:Buffer)=>{chunk(bytes,false);});
 child.stdin.on("error",()=>{/* Stdin failures do not override the native process outcome. */});
 child.on("error",error=>{failure=error;});
 child.on("close",exitCode=>{
  clearTimeout(timer);options.signal?.removeEventListener("abort",abort);
  consume(stdoutDecoder.end(),true);consume(stderrDecoder.end(),false);
  if(options.onLine&&lineBuffer.trim()!==""){
   try{options.onLine(lineBuffer,input=>{child.stdin.write(input);},()=>{child.stdin.end();});}
   catch(error){failure??=error instanceof Error?error:new Error(String(error));}
  }
  if(failure)reject(failure);else resolve({stdout,stderr,exitCode});
 });
 if(options.input!==undefined)child.stdin.write(options.input);
 if(options.onLine===undefined)child.stdin.end();
 return promise;
}

export async function createNativeTaskSpoolV1(input:NativeTaskAdapterOptionsV1):Promise<NativeTaskSpoolV1>{
 const options=structuredClone(input);
 const profile=parseTaskExecutionProfileV1(options.profile);
 if(Buffer.byteLength(options.renderedContext)>1048576)throw new Error("NATIVE_CONTEXT_LIMIT");
 if(!isAbsolute(options.stateDirectory))throw new Error("PRIVATE_STATE_DIRECTORY_REQUIRED");
 await mkdir(options.stateDirectory,{recursive:true,mode:0o700});
 const directory=await lstat(options.stateDirectory);
 if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o077)!==0||directory.uid!==process.getuid?.())throw new Error("PRIVATE_STATE_DIRECTORY_INVALID");
 const profileDigest=taskExecutionProfileDigest(profile);
 const identity=JSON.stringify({binding:options.binding,profileDigest,workspacePath:options.workspacePath,renderedContextDigest:nativeRenderedContextDigestV1(options.renderedContext),producerPrincipalId:options.producerPrincipalId,producerGrantDigest:options.producerGrantDigest});
 const marker=join(options.stateDirectory,"handoff.json"),terminal=join(options.stateDirectory,"terminal.json");
 async function exclusive(path:string,bytes:string|Uint8Array){
  const file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  const directoryFile=await open(options.stateDirectory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{await directoryFile.sync();}finally{await directoryFile.close();}
 }
 async function privateRead(path:string){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const info=await file.stat();
   if(!info.isFile()||(info.mode&0o077)!==0||info.uid!==process.getuid?.()||info.size>Math.max(profile.maxOutputBytes,65536)+65536)throw new Error("PRIVATE_RECORD_INVALID");
   return await file.readFile();
  }finally{await file.close();}
 }
 async function exists(path:string){
  try{return await privateRead(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
 }
 async function check(){
  const bytes=await exists(marker);
  if(bytes!==null&&bytes.toString()!==identity)throw new Error("NATIVE_BINDING_MISMATCH");
  return bytes!==null;
 }
 function validate(record:NativeTaskTerminalV1){
  const provenance=parseTaskExecutionReceiptProvenanceV1(record.provenance);
  if(provenance.profileDigest!==profileDigest)throw new Error("NATIVE_PROFILE_MISMATCH");
  if(record.outcome==="succeeded"&&(provenance.observedHostId!==profile.hostId||provenance.observedHostVersion!==profile.hostVersion||provenance.observedProviderId!==profile.providerId||provenance.observedModelId!==profile.modelId))throw new Error("NATIVE_MODEL_MISMATCH");
  if(record.outcome==="succeeded"&&(provenance.nativeSessionId!==record.nativeSessionId||provenance.exitCode!==0))throw new Error("NATIVE_TERMINAL_UNOBSERVABLE");
  if(!["succeeded","failed","cancelled"].includes(record.outcome)||typeof record.providerOperationId!=="string"||record.providerOperationId.length===0||typeof record.nativeSessionId!=="string"||record.nativeSessionId.length===0||!Number.isFinite(Date.parse(record.startedAt))||!Number.isFinite(Date.parse(record.finishedAt))||!Array.isArray(record.evidence)||record.evidence.some((item:NativeTaskTerminalV1["evidence"][number])=>!/^[a-f0-9]{64}$/.test(item.digest)||!Number.isSafeInteger(item.size)||item.size<0)||record.outputDigest!==null&&!/^[a-f0-9]{64}$/.test(record.outputDigest))throw new Error("NATIVE_TERMINAL_INVALID");
  if((record.outcome==="succeeded")!==(record.outputDigest!==null))throw new Error("NATIVE_TERMINAL_OUTPUT_INVALID");
 }
 async function validatePublications(record:NativeTaskTerminalV1){
  if(record.outputDigest!==null)await publication(record.outputDigest);
  for(const item of record.evidence){const published=await publication(item.digest);if(published.mediaType!==item.mediaType||published.bytes.byteLength!==item.size)throw new Error("NATIVE_EVIDENCE_INVALID");}
 }
 async function publication(digest:string):Promise<NativeTaskPublicationV1>{
  if(!/^[a-f0-9]{64}$/.test(digest))throw new Error("PUBLICATION_DIGEST_INVALID");
  if(!await check())throw new Error("NATIVE_HANDOFF_REQUIRED");
  const bytes=await privateRead(join(options.stateDirectory,digest+".bytes"));
  if(nativeBytesDigestV1(bytes)!==digest)throw new Error("PUBLICATION_DIGEST_MISMATCH");
  const mediaType=(await privateRead(join(options.stateDirectory,digest+".media"))).toString();
  if(!["text/plain","application/json"].includes(mediaType))throw new Error("NATIVE_MEDIA_TYPE_UNSUPPORTED");
  return {digest,mediaType,bytes};
 }
 return {
  async begin(){await exclusive(marker,identity);},
  async handedOff(){return check();},
  async load():Promise<NativeTaskTerminalV1|null>{
   const handed=await check(),bytes=await exists(terminal);
   if(bytes===null){if(handed)throw new Error("UNKNOWN_OUTCOME: native handoff has no retained terminal record");return null;}
   const envelope=JSON.parse(bytes.toString()) as {identity:string;record:NativeTaskTerminalV1;recordDigest:string};
   if(!handed||envelope.identity!==identity)throw new Error("NATIVE_BINDING_MISMATCH");
   if(envelope.recordDigest!==nativeBytesDigestV1(Buffer.from(JSON.stringify(envelope.record))))throw new Error("NATIVE_TERMINAL_TAMPERED");
   validate(envelope.record);
   await validatePublications(envelope.record);
   return envelope.record;
  },
  async save(record:NativeTaskTerminalV1){
   if(!await check())throw new Error("NATIVE_HANDOFF_REQUIRED");
   validate(record);
   await validatePublications(record);
   await exclusive(terminal,JSON.stringify({identity,record,recordDigest:nativeBytesDigestV1(Buffer.from(JSON.stringify(record)))}));
  },
  async publish(bytes:Uint8Array,mediaType:string){
   if(!await check())throw new Error("NATIVE_HANDOFF_REQUIRED");
   if(bytes.byteLength>profile.maxOutputBytes)throw new Error("NATIVE_OUTPUT_LIMIT");
   if(!["text/plain","application/json"].includes(mediaType))throw new Error("NATIVE_MEDIA_TYPE_UNSUPPORTED");
   const digest=nativeBytesDigestV1(bytes);
   await exclusive(join(options.stateDirectory,digest+".bytes"),bytes);
   await exclusive(join(options.stateDirectory,digest+".media"),mediaType);
   return digest;
  },
  publication,
  async close(){ /* The spool retains no open handles; records intentionally survive close. */ },
 };
}
