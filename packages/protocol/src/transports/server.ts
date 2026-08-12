import {lstat,mkdir,realpath,rm,chmod} from "node:fs/promises";
import {rmSync} from "node:fs";
import {createServer,type Server,type Socket} from "node:net";
import {userInfo} from "node:os";
import {dirname,resolve} from "node:path";
import type {Readable,Writable} from "node:stream";
import {inspectAndAuthenticateTransportV1,type AuthenticatedContextV1,type LocalTransportEndpointV1} from "../wire.js";
import type {GrantLookupV1,TransportInspectionV1,TransportInspectorsV1} from "../spi.js";
import {JsonRpcFramedReader,JsonRpcFramedWriter} from "./framing.js";

export type TransportRequestHandlerV1=(context:AuthenticatedContextV1,request:unknown)=>Promise<unknown>|unknown;
export interface TransportConnectionV1{readonly endpoint:LocalTransportEndpointV1;readonly context:AuthenticatedContextV1}
export interface TransportServerV1{readonly running:boolean;start():Promise<void>;close():Promise<void>}
interface CommonOptionsV1{readonly inspectors:TransportInspectorsV1;readonly grants:GrantLookupV1;readonly authorityTime:()=>string;readonly handler:TransportRequestHandlerV1;readonly maxFrameBytes?:number}
export interface StdioTransportServerOptionsV1 extends CommonOptionsV1{readonly grantReference:string;readonly input?:Readable;readonly output?:Writable}
export interface UnixSocketTransportServerOptionsV1 extends CommonOptionsV1{readonly endpointPath:string}

async function serveStreams(endpoint:LocalTransportEndpointV1,input:Readable,output:Writable,options:CommonOptionsV1,grantReference:string,inspectors=options.inspectors):Promise<void>{
 const context=await inspectAndAuthenticateTransportV1(endpoint,grantReference,inspectors,options.grants,options.authorityTime());
 const framing=options.maxFrameBytes===undefined?{}:{maxFrameBytes:options.maxFrameBytes};
 const reader=new JsonRpcFramedReader(input,framing),writer=new JsonRpcFramedWriter(output,framing);
 for await(const request of reader)await writer.write(await options.handler(context,request));
}

export class StdioTransportServer implements TransportServerV1{
 readonly #options:StdioTransportServerOptionsV1;#running=false;#serving:Promise<void>|null=null;
 constructor(options:StdioTransportServerOptionsV1){this.#options=options}
 get running():boolean{return this.#running}
 async start():Promise<void>{
  if(this.#running)return;
  this.#running=true;
  const input=this.#options.input??process.stdin,output=this.#options.output??process.stdout;
  this.#serving=serveStreams({transport:"stdio"},input,output,this.#options,this.#options.grantReference).finally(()=>{this.#running=false});
  await Promise.resolve();
 }
 async close():Promise<void>{
  if(!this.#running&&this.#serving===null)return;
  const input=this.#options.input??process.stdin;
  if(input!==process.stdin&&"destroy" in input)(input as Readable&{destroy():void}).destroy();
  try{await this.#serving}catch(error){if(this.#running)throw error}finally{this.#serving=null;this.#running=false}
 }
}

export class UnixSocketTransportServer implements TransportServerV1{
 readonly #options:UnixSocketTransportServerOptionsV1;readonly #endpointPath:string;#server:Server|null=null;#connections=new Set<Socket>();#exitCleanup:()=>void;
 constructor(options:UnixSocketTransportServerOptionsV1){
  this.#options=options;this.#endpointPath=resolve(options.endpointPath);
  this.#exitCleanup=()=>{try{rmSync(this.#endpointPath,{force:true})}catch{/* best effort during process exit */}};
 }
 get running():boolean{return this.#server?.listening===true}
 async start():Promise<void>{
  if(this.#server!==null)return;
  if(process.platform==="win32")throw new Error("Unix socket transport is unavailable on Windows");
  const parent=dirname(this.#endpointPath);
  await mkdir(parent,{recursive:true,mode:0o700});await chmod(parent,0o700);
  const parentLink=await lstat(parent);if(parentLink.isSymbolicLink()||!parentLink.isDirectory()||await realpath(parent)!==parent)throw new Error("Unix socket parent must be a real directory");
  if(typeof process.getuid==="function"&&parentLink.uid!==process.getuid())throw new Error("Unix socket parent owner mismatch");
  try{const existing=await lstat(this.#endpointPath);if(existing.isSymbolicLink()||!existing.isSocket())throw new Error("Refusing to replace unsafe Unix socket endpoint");if(typeof process.getuid==="function"&&existing.uid!==process.getuid())throw new Error("Unix socket endpoint owner mismatch");await rm(this.#endpointPath)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}
  const server=createServer((socket)=>{
   this.#connections.add(socket);socket.once("close",()=>this.#connections.delete(socket));
   void this.#serveConnection(socket).catch(()=>socket.destroy());
  });
  this.#server=server;
  try{
   await new Promise<void>((accept,reject)=>{server.once("error",reject);server.listen(this.#endpointPath,()=>{server.off("error",reject);accept()})});
   await chmod(this.#endpointPath,0o600);
   process.once("exit",this.#exitCleanup);
  }catch(error){this.#server=null;server.close();await rm(this.#endpointPath,{force:true});throw error}
 }
 async #serveConnection(socket:Socket):Promise<void>{
  const framing=this.#options.maxFrameBytes===undefined?{}:{maxFrameBytes:this.#options.maxFrameBytes};
  const frames=new JsonRpcFramedReader(socket,framing)[Symbol.asyncIterator](),first=await frames.next();
  if(first.done)throw new SyntaxError("Missing transport authentication handshake");
  const handshake=first.value;
  if(typeof handshake!=="object"||handshake===null||Array.isArray(handshake)||Object.getPrototypeOf(handshake)!==Object.prototype)throw new SyntaxError("Invalid transport authentication handshake");
  const record=handshake as Record<string,unknown>,keys=Object.keys(record).sort();
  if(keys.length!==2||keys[0]!=="grantReference"||keys[1]!=="schemaVersion"||record.schemaVersion!=="1"||typeof record.grantReference!=="string"||record.grantReference.length===0)throw new SyntaxError("Invalid transport authentication handshake");
  const endpointInspection=await this.#options.inspectors.unixSocket.inspectUnixSocket(this.#endpointPath);
  if(endpointInspection.endpointType!=="socket"||endpointInspection.isSymbolicLink||!endpointInspection.ownerMatchesProcess||endpointInspection.mode!==0o600||endpointInspection.parentType!=="directory"||endpointInspection.parentIsSymbolicLink||!endpointInspection.parentOwnerMatchesProcess||(endpointInspection.parentMode&0o077)!==0)throw new Error("Unix socket DAC boundary is not owner-only");
  const peerIdentity=process.env.USER?.trim()||userInfo().username;
  if(peerIdentity.length===0)throw new Error("Unable to determine Unix socket owner identity");
  const authenticatedInspection:Extract<TransportInspectionV1,{transport:"unix-socket"}>={...endpointInspection,peerVerified:true,peerIdentity};
  const inspectors:TransportInspectorsV1={...this.#options.inspectors,unixSocket:{inspectUnixSocket:async()=>authenticatedInspection}};
  const context=await inspectAndAuthenticateTransportV1({transport:"unix-socket",endpointPath:this.#endpointPath},record.grantReference,inspectors,this.#options.grants,this.#options.authorityTime());
  const writer=new JsonRpcFramedWriter(socket,framing);
  for(let frame=await frames.next();!frame.done;frame=await frames.next())await writer.write(await this.#options.handler(context,frame.value));
 }
 async close():Promise<void>{
  const server=this.#server;this.#server=null;process.off("exit",this.#exitCleanup);
  for(const connection of this.#connections)connection.destroy();this.#connections.clear();
  if(server!==null)await new Promise<void>((accept,reject)=>server.close((error)=>error===undefined?accept():reject(error)));
  await rm(this.#endpointPath,{force:true});
 }
}
