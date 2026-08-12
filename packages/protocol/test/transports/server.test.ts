import assert from "node:assert/strict";
import {access,chmod,mkdir,mkdtemp,rm,stat,writeFile} from "node:fs/promises";
import {connect} from "node:net";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
import {PassThrough} from "node:stream";
import test from "node:test";
import type {AuthenticatedGrantV1,GrantLookupV1,TransportInspectorsV1} from "../../src/index.js";
import {StdioTransportInspector,StdioTransportServer,UnixSocketTransportInspector,UnixSocketTransportServer,WindowsPipeTransportInspector} from "../../src/index.js";

const expiresAt="2099-01-01T00:00:00.000Z";
function grant(peerIdentity:string):AuthenticatedGrantV1{return{schemaVersion:"1",principalId:"principal",principalRole:"authority",grantDigest:"grant",peerIdentity,expiresAt,revoked:false,workspaceId:"workspace",runId:null,taskId:null,attemptId:null,generation:null,proposalId:null,adapterId:null,allowedMethods:[]}}
function dependencies():{inspectors:TransportInspectorsV1;grants:GrantLookupV1}{
 const stdio=new StdioTransportInspector(),unixSocket=new UnixSocketTransportInspector();
 return{inspectors:{stdio,unixSocket,windowsPipe:new WindowsPipeTransportInspector()},grants:{async lookupActiveGrant(peerIdentity,reference){return reference==="valid"?grant(peerIdentity):null}}};
}

test("stdio server authenticates then dispatches framed requests",async()=>{
 const input=new PassThrough(),output=new PassThrough(),chunks:Buffer[]=[],deps=dependencies();output.on("data",(chunk:Buffer)=>chunks.push(chunk));
 const server=new StdioTransportServer({...deps,grantReference:"valid",authorityTime:()=>"2026-01-01T00:00:00.000Z",input,output,handler(context,request){assert.equal(context.principalId,"principal");return{request}}});
 await server.start();input.end('{"id":1}\n');while(server.running)await new Promise((accept)=>setImmediate(accept));
 assert.equal(Buffer.concat(chunks).toString("utf8"),'{"request":{"id":1}}\n');await server.close();
});

test("Unix owner-only DAC authenticates each opaque grant handshake and close cleans up",{skip:process.platform==="win32"},async()=>{
 const root=await mkdtemp(join(tmpdir(),"horseness-server-")),endpointPath=join(root,"private","daemon.sock"),deps=dependencies();
 const server=new UnixSocketTransportServer({...deps,endpointPath,authorityTime:()=>"2026-01-01T00:00:00.000Z",handler(context,request){return{peer:context.transport.peerIdentity,request}}});
 try{
  await server.start();assert.equal((await stat(join(root,"private"))).mode&0o777,0o700);assert.equal((await stat(endpointPath)).mode&0o777,0o600);
  const socket=connect(endpointPath);const chunks:Buffer[]=[];socket.on("data",(chunk:Buffer)=>chunks.push(chunk));await new Promise<void>((accept)=>socket.once("connect",accept));socket.write('{"schemaVersion":"1","grantReference":"valid"}\n{"hello":"world"}\n');await new Promise<void>((accept)=>socket.once("data",()=>accept()));socket.destroy();await new Promise<void>((accept)=>socket.once("close",accept));
  const response=JSON.parse(Buffer.concat(chunks).toString("utf8")) as {peer:string;request:unknown};assert.equal(response.peer,process.env.USER?.trim()||userInfo().username);assert.deepEqual(response.request,{hello:"world"});
 }finally{await server.close();await assert.rejects(access(endpointPath));await rm(root,{recursive:true,force:true})}
});

test("Unix server refuses unsafe pre-existing endpoint",{skip:process.platform==="win32"},async()=>{
 const root=await mkdtemp(join(tmpdir(),"horseness-server-")),parent=join(root,"private"),endpointPath=join(parent,"daemon.sock"),deps=dependencies();
 await mkdir(parent,{mode:0o700});await writeFile(endpointPath,"unsafe");await chmod(parent,0o700);
 const server=new UnixSocketTransportServer({...deps,endpointPath,authorityTime:()=>"2026-01-01T00:00:00.000Z",handler:()=>({})});
 await assert.rejects(server.start(),/unsafe/);await rm(root,{recursive:true,force:true});
});

test("Unix server uses each connection's opaque grant and never a listener-wide authority grant",{skip:process.platform==="win32"},async()=>{
 const root=await mkdtemp(join(tmpdir(),"horseness-server-")),endpointPath=join(root,"private","daemon.sock"),deps=dependencies(),references:string[]=[];
 const server=new UnixSocketTransportServer({inspectors:deps.inspectors,grants:{async lookupActiveGrant(peerIdentity,reference){references.push(reference);return reference==="client-two"?grant(peerIdentity):null}},endpointPath,authorityTime:()=>"2026-01-01T00:00:00.000Z",handler:()=>({ok:true})});
 try{await server.start();const socket=connect(endpointPath);await new Promise<void>((accept)=>socket.once("connect",accept));socket.write('{"schemaVersion":"1","grantReference":"client-two"}\n{"id":1}\n');await new Promise<void>((accept)=>socket.once("data",()=>accept()));socket.destroy();await new Promise<void>((accept)=>socket.once("close",accept));assert.deepEqual(references,["client-two"])}finally{await server.close();await rm(root,{recursive:true,force:true})}
});
