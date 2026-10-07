import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAuthenticatedContextV1, type AuthenticatedGrantV1, type JsonRpcRequestV1, type ProtocolMethodV1 } from "@horseness/protocol";
import { Daemon } from "../src/index.js";

function fixture() {
  const root=mkdtempSync(join(tmpdir(),"horseness-grant-freshness-"));
  let now="2026-10-06T12:00:00.000Z";
  const daemon=new Daemon({workspacePath:root,databasePath:join(root,"authority.sqlite"),artifactRoot:join(root,"artifacts"),transport:{kind:"stdio"},authorityTime:()=>now},{identity:()=>"owner"});
  const capability=daemon.createBootstrapCapability("owner");
  const owner=daemon.consumeBootstrapCapability(capability.secret);
  const head=daemon.authority.replay(daemon.config.workspaceId,"workspace",daemon.config.workspaceId).at(-1)!;
  const cursor={schemaVersion:"1" as const,kind:"workspace-only" as const,workspaceId:daemon.config.workspaceId,workspaceSequence:head.envelope.sequence,workspaceEnvelopeHash:head.envelopeHash,workspaceContextEpoch:head.envelope.sequence-1};
  return {root,daemon,owner,cursor,advance(value:string){now=value;},authenticate(grant:AuthenticatedGrantV1){return createAuthenticatedContextV1({transport:"stdio",localOnly:true,peerVerified:true,peerIdentity:"owner",processInherited:true},grant,now);},request(method:ProtocolMethodV1,value:Record<string,unknown>):JsonRpcRequestV1{return {jsonrpc:"2.0",id:method,method,params:{protocolVersion:"1",observationCursor:cursor,idempotencyKey:String(value.operationId),body:{schemaVersion:"1",workspaceId:cursor.workspaceId,input:{schemaVersion:"1",requestType:method,value}} as never}};},close(){daemon.close();rmSync(root,{recursive:true,force:true});}};
}

for(const disposition of ["revoked","expired"] as const)test(`a cached ${disposition} connection cannot delegate from another parent or revoke it`,async()=>{
  const f=fixture();
  try {
    const issued=f.daemon.grants.issue({peerIdentity:"owner",principalId:"limited-admin",principalRole:"authority",workspaceId:f.cursor.workspaceId,allowedMethods:["grant.delegate.v1","grant.revoke.v1"],expiresAt:"2026-10-06T12:00:01.000Z"});
    const context=f.authenticate(issued.grant);
    if(disposition==="revoked")f.daemon.grants.revoke(issued.grantReference);else f.advance("2026-10-06T12:00:01.000Z");
    const before=f.daemon.grants.list();
    const delegated=await f.daemon.server.dispatch(context,f.request("grant.delegate.v1",{operationId:"delegate-stale",parentGrantDigest:f.owner.grantDigest,delegatePrincipalId:"attacker",actions:["workspace.get.v1"],resourceScope:{workspaceId:f.cursor.workspaceId,peerIdentity:"owner"},expiresAt:"2026-10-06T12:00:01.000Z"}));
    assert.ok("error" in delegated);assert.equal(delegated.error.data.reasonCode,"GRANT_INVALID");
    const revoked=await f.daemon.server.dispatch(context,f.request("grant.revoke.v1",{operationId:"revoke-stale",grantDigest:f.owner.grantDigest,reason:"stale-session",effectiveAt:"2026-10-06T12:00:01.000Z"}));
    assert.ok("error" in revoked);assert.equal(revoked.error.data.reasonCode,"GRANT_INVALID");
    assert.deepEqual(f.daemon.grants.list(),before);assert.ok(f.daemon.grants.activeByDigest(f.owner.grantDigest));
  } finally {f.close();}
});

test("producer access is invalidated through its parent grant lineage",async()=>{
  const f=fixture();
  try {
    const parent=f.daemon.grants.issue({peerIdentity:"owner",principalId:"parent",principalRole:"authority",workspaceId:f.cursor.workspaceId,allowedMethods:["task.get.v1"],expiresAt:"2026-10-06T12:10:00.000Z"},f.owner.grantDigest);
    const child=f.daemon.grants.issue({peerIdentity:"owner",principalId:"producer",principalRole:"adapter",workspaceId:f.cursor.workspaceId,runId:"run",taskId:"task",allowedMethods:["task.get.v1"],expiresAt:"2026-10-06T12:05:00.000Z"},parent.grant.grantDigest);
    assert.ok(await f.daemon.grants.lookupActiveGrant("owner",child.grantReference));
    f.daemon.grants.revoke(parent.grantReference);
    assert.equal(f.daemon.grants.observe(child.grant.grantDigest),null);assert.equal(f.daemon.grants.activeByDigest(child.grant.grantDigest),null);
    assert.equal(await f.daemon.grants.lookupActiveGrant("owner",child.grantReference),null);
  } finally {f.close();}
});

test("a grant mutation refuses a changed authority observation",()=>{
  const f=fixture();
  try {
    const observed=f.daemon.grants.observe(f.owner.grantDigest)!;
    const target=f.daemon.grants.issue({peerIdentity:"owner",principalId:"target",principalRole:"operator",workspaceId:f.cursor.workspaceId,allowedMethods:["workspace.get.v1"],expiresAt:"2026-10-06T12:10:00.000Z"});
    assert.throws(()=>f.daemon.grants.revoke(target.grantReference,observed),/grant authority observation compare-and-swap conflict/);
    assert.ok(f.daemon.grants.activeByDigest(target.grant.grantDigest));
  } finally {f.close();}
});
