import assert from "node:assert/strict";
import test from "node:test";
import {createAuthenticatedContextV1,inspectAndAuthenticateTransportV1,isAuthenticatedContextV1,parseJsonRpcRequestV1,ProtocolError,PROTOCOL_RPC_CODES,type AuthenticatedGrantV1,type SubscriptionResumeClaimsV1,type TransportInspectionV1} from "../src/index.js";

const cursor={schemaVersion:"1",kind:"composite",workspaceId:"ws",workspaceSequence:3,workspaceEnvelopeHash:"wh",workspaceContextEpoch:1,runId:"run",runSequence:7,runEnvelopeHash:"rh",runContextEpoch:2} as const;
const inspection={transport:"unix-socket",localOnly:true,peerVerified:true,peerIdentity:"uid:1000",ownerMatchesProcess:true,mode:0o600} as const satisfies TransportInspectionV1;
const grant={schemaVersion:"1",principalId:"principal",principalRole:"worker",grantDigest:"grant",peerIdentity:"uid:1000",expiresAt:"2030-01-01T00:00:00.000Z",revoked:false,workspaceId:"ws",runId:"run",taskId:null,attemptId:null,generation:null,proposalId:"proposal",adapterId:null,allowedMethods:["admission.subscribe.v1"]} as const satisfies AuthenticatedGrantV1;
const context=createAuthenticatedContextV1(inspection,grant,"2029-01-01T00:00:00.000Z");
const body={schemaVersion:"1",workspaceId:"ws",runId:"run",proposalId:"proposal",input:{schemaVersion:"1",requestType:"admission.subscribe.v1"}} as const;
const request=(overrides:Record<string,unknown>={})=>({jsonrpc:"2.0",id:1,method:"admission.subscribe.v1",params:{protocolVersion:"1",observationCursor:cursor,body,...overrides}});
const denied=(reason:string)=>(error:unknown)=>error instanceof ProtocolError&&error.reasonCode===reason;

test("authentication context is opaque and rejects self-asserted metadata",()=>{
 assert.equal(isAuthenticatedContextV1(context),true);
 assert.equal(isAuthenticatedContextV1({...context}),false);
 assert.throws(()=>parseJsonRpcRequestV1(request(),{...context}),denied("AUTH_CONTEXT_REQUIRED"));
});

test("authenticated cursor and body scopes bind exactly",()=>{
 assert.throws(()=>parseJsonRpcRequestV1(request({body:{...body,workspaceId:"other"}}),context),denied("AUTH_SCOPE_MISMATCH"));
 assert.throws(()=>parseJsonRpcRequestV1(request({body:{...body,runId:"other"}}),context),denied("AUTH_SCOPE_MISMATCH"));
 assert.throws(()=>parseJsonRpcRequestV1(request({body:{...body,proposalId:"other"}}),context),denied("AUTH_SCOPE_MISMATCH"));
 assert.throws(()=>parseJsonRpcRequestV1(request({observationCursor:{...cursor,runId:"other"}}),context),denied("AUTH_SCOPE_MISMATCH"));
});

test("fresh and valid resumed subscriptions are distinct accepted modes",()=>{
 assert.equal(parseJsonRpcRequestV1(request(),context).params.resume,undefined);
 const resume={schemaVersion:"1",subscriptionId:"sub",afterObservationCursor:cursor,resumeToken:"token"} as const;
 const claims:SubscriptionResumeClaimsV1={subscriptionId:"sub",resumeToken:"token",expiresAt:"2029-06-01T00:00:00.000Z",afterObservationCursor:cursor,workspaceId:"ws",runId:"run",proposalId:"proposal",principalId:"principal",grantDigest:"grant"};
 assert.equal(parseJsonRpcRequestV1(request({resume}),context,{resumeVerifier:{authorityTime:"2029-01-01T00:00:00.000Z",verify:()=>claims}}).params.resume?.subscriptionId,"sub");
 assert.throws(()=>parseJsonRpcRequestV1(request({resume}),context,{resumeVerifier:{authorityTime:"2030-01-01T00:00:00.000Z",verify:()=>claims}}),denied("RESUME_TOKEN_EXPIRED"));
 assert.throws(()=>parseJsonRpcRequestV1(request({resume}),context,{resumeVerifier:{authorityTime:"2029-01-01T00:00:00.000Z",verify:()=>null}}),denied("RESUME_TOKEN_INVALID"));
});

test("transport and grant evidence fail closed",()=>{
 const make=(candidate:TransportInspectionV1)=>()=>createAuthenticatedContextV1(candidate,grant,"2029-01-01T00:00:00.000Z");
 assert.throws(make({transport:"tcp",localOnly:false,peerVerified:false,peerIdentity:null}),denied("TRANSPORT_NOT_ALLOWED"));
 assert.throws(make({...inspection,ownerMatchesProcess:false}),denied("TRANSPORT_OWNER_INVALID"));
 assert.throws(make({...inspection,mode:0o666}),denied("TRANSPORT_PERMISSIONS_INVALID"));
 assert.throws(make({...inspection,peerVerified:false}),denied("PEER_IDENTITY_INVALID"));
 assert.throws(()=>createAuthenticatedContextV1(inspection,{...grant,revoked:true},"2029-01-01T00:00:00.000Z"),denied("GRANT_INVALID"));
 assert.throws(()=>createAuthenticatedContextV1(inspection,grant,"2031-01-01T00:00:00.000Z"),denied("GRANT_EXPIRED"));
});

test("privileged inspection precedes grant lookup and rejects unsafe pipes",async()=>{
 const inspectors={
  stdio:{inspectStdio:async()=>({transport:"stdio",localOnly:true,peerVerified:true,peerIdentity:"uid:1000",processInherited:true} as const)},
  unixSocket:{inspectUnixSocket:async()=>inspection},
  windowsPipe:{inspectWindowsPipe:async()=>({transport:"windows-named-pipe",localOnly:true,peerVerified:true,peerIdentity:"sid:owner",ownerMatchesProcess:true,ownerOnlyDacl:false,daclInheriting:true} as const)}
 };
 let lookedUp=false;
 const grants={lookupActiveGrant:async(peer:string)=>{lookedUp=true;assert.equal(peer,"uid:1000");return grant}};
 assert.equal((await inspectAndAuthenticateTransportV1({transport:"stdio"},"grant-ref",inspectors,grants,"2029-01-01T00:00:00.000Z")).principalId,"principal");
 assert.equal(lookedUp,true);
 await assert.rejects(()=>inspectAndAuthenticateTransportV1({transport:"windows-named-pipe",pipeName:"pipe"},"grant-ref",inspectors,grants,"2029-01-01T00:00:00.000Z"),denied("TRANSPORT_PERMISSIONS_INVALID"));
 assert.equal(PROTOCOL_RPC_CODES.AUTH_SCOPE_MISMATCH,-32011);
});
