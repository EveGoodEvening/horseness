import assert from "node:assert/strict";
import {chmod,mkdir,mkdtemp,rm,symlink} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {StdioTransportInspector,UnixSocketTransportInspector,WindowsPipeTransportInspector} from "../../src/index.js";

test("stdio inspection is inherited and peer verified",async()=>{
 const inspected=await new StdioTransportInspector().inspectStdio();
 assert.equal(inspected.transport,"stdio");assert.equal(inspected.processInherited,true);assert.equal(inspected.peerVerified,true);assert.equal(inspected.peerIdentity,process.env.USER?.trim()||userInfo().username);
});

test("Unix inspection reports owner, exact modes, parent, and symlinks",{skip:process.platform==="win32"},async()=>{
 const root=await mkdtemp(join(tmpdir(),"horseness-transport-")),parent=join(root,"private"),socketPath=join(parent,"daemon.sock");
 await mkdir(parent,{mode:0o700});
 const server=createServer();await new Promise<void>((accept,reject)=>{server.once("error",reject);server.listen(socketPath,accept)});await chmod(socketPath,0o600);
 try{
  const inspector=new UnixSocketTransportInspector(),valid=await inspector.inspectUnixSocket(socketPath);
  assert.equal(valid.endpointType,"socket");assert.equal(valid.ownerMatchesProcess,true);assert.equal(valid.peerVerified,false);assert.equal(valid.peerIdentity,null);assert.equal(valid.mode,0o600);assert.equal(valid.parentMode,0o700);assert.equal(valid.parentIsSymbolicLink,false);
  await chmod(parent,0o755);assert.equal((await inspector.inspectUnixSocket(socketPath)).parentMode,0o755);await chmod(parent,0o700);
  const link=join(parent,"link.sock");await symlink(socketPath,link);assert.equal((await inspector.inspectUnixSocket(link)).isSymbolicLink,true);
 }finally{await new Promise<void>((accept)=>server.close(()=>accept()));await rm(root,{recursive:true,force:true})}
});

test("Windows pipe inspector fails closed off Windows",{skip:process.platform==="win32"},async()=>{
 const inspected=await new WindowsPipeTransportInspector().inspectWindowsPipe("horseness-test");
 assert.equal(inspected.peerVerified,false);assert.equal(inspected.ownerOnlyDacl,false);assert.equal(inspected.peerIdentity,null);
});
