import assert from "node:assert/strict";
import test from "node:test";
import {createAuthenticatedContextV1,inspectAndAuthenticateTransportV1,isAuthenticatedContextV1,parseJsonRpcRequestV1,ProtocolError,PROTOCOL_RPC_CODES,type AuthenticatedGrantV1,type SubscriptionResumeClaimsV1,type TransportInspectionV1} from "../src/index.js";

const cursor={schemaVersion:"1",kind:"composite",workspaceId:"ws",workspaceSequence:3,workspaceEnvelopeHash:"wh",workspaceContextEpoch:1,runId:"run",runSequence:7,runEnvelopeHash:"rh",runContextEpoch:2} as const;
const inspection={transport:"unix-socket",localOnly:true,peerVerified:true,peerIdentity:"uid:1000",endpointPath:"/run/user/1000/horseness.sock",realPath:"/run/user/1000/horseness.sock",endpointType:"socket",isSymbolicLink:false,ownerMatchesProcess:true,mode:0o600,parentPath:"/run/user/1000",parentRealPath:"/run/user/1000",parentType:"directory",parentIsSymbolicLink:false,parentOwnerMatchesProcess:true,parentMode:0o700} as const satisfies TransportInspectionV1;
const grant={schemaVersion:"1",principalId:"principal",principalRole:"worker",grantDigest:"grant",peerIdentity:"uid:1000",expiresAt:"2030-01-01T00:00:00.000Z",revoked:false,workspaceId:"ws",runId:"run",taskId:null,attemptId:null,generation:null,proposalId:"proposal",adapterId:null,allowedMethods:["admission.subscribe.v1"]} as const satisfies AuthenticatedGrantV1;
const context=createAuthenticatedContextV1(inspection,grant,"2029-01-01T00:00:00.000Z");
const body={schemaVersion:"1",workspaceId:"ws",runId:"run",proposalId:"proposal",input:{schemaVersion:"1",requestType:"admission.subscribe.v1",value:{operationId:"subscribe-op",proposalId:"proposal",afterSequence:0,resumeToken:"fresh"}}} as const;
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
test("under-scoped worker and adapter grants are rejected",()=>{
 const worker={...grant,proposalId:null,allowedMethods:["task.get.v1"]} as const satisfies AuthenticatedGrantV1;
 assert.throws(()=>createAuthenticatedContextV1(inspection,worker,"2029-01-01T00:00:00.000Z"),denied("GRANT_INVALID"));
 const adapter={...grant,principalRole:"adapter",taskId:"task",attemptId:"attempt",generation:1,adapterId:null,allowedMethods:["adapter.launch.v1"]} as const satisfies AuthenticatedGrantV1;
 assert.throws(()=>createAuthenticatedContextV1(inspection,adapter,"2029-01-01T00:00:00.000Z"),denied("GRANT_INVALID"));
});

test("workspace-rooted authority grants administer descendants without weakening scoped grants",()=>{
 const authorityGrant={...grant,principalRole:"authority",runId:null,proposalId:null,allowedMethods:["workspace.get.v1","run.create.v1","run.get.v1"]} as const satisfies AuthenticatedGrantV1;
 const authority=createAuthenticatedContextV1(inspection,authorityGrant,"2029-01-01T00:00:00.000Z");
 const workspaceCursor={schemaVersion:"1",kind:"workspace-only",workspaceId:"ws",workspaceSequence:3,workspaceEnvelopeHash:"wh",workspaceContextEpoch:1} as const;
 const absentRunCursor={...workspaceCursor,kind:"absent-run-genesis",runId:"new-run",expectedRunHead:"absent"} as const;
 const workspaceRequest={jsonrpc:"2.0",id:1,method:"workspace.get.v1",params:{protocolVersion:"1",observationCursor:workspaceCursor,body:{schemaVersion:"1",workspaceId:"ws",input:{schemaVersion:"1",requestType:"workspace.get.v1",value:{schemaVersion:"1",queryType:"GetWorkspaceV1",observationCursor:workspaceCursor}}}}} as const;
 const createRequest={jsonrpc:"2.0",id:2,method:"run.create.v1",params:{protocolVersion:"1",observationCursor:absentRunCursor,idempotencyKey:"create-run",body:{schemaVersion:"1",workspaceId:"ws",runId:"new-run",input:{schemaVersion:"1",requestType:"run.create.v1",value:{schemaVersion:"1",commandType:"CreateRunV1",commandId:"create-run",observationCursor:absentRunCursor,principalId:"principal",initialDocument:{}}}}}} as const;
 const getRequest={jsonrpc:"2.0",id:3,method:"run.get.v1",params:{protocolVersion:"1",observationCursor:cursor,body:{schemaVersion:"1",workspaceId:"ws",runId:"run",input:{schemaVersion:"1",requestType:"run.get.v1",value:{schemaVersion:"1",queryType:"GetRunV1",observationCursor:cursor}}}}} as const;
 assert.equal(parseJsonRpcRequestV1(workspaceRequest,authority).method,"workspace.get.v1");
 assert.equal(parseJsonRpcRequestV1(createRequest,authority).method,"run.create.v1");
 assert.equal(parseJsonRpcRequestV1(getRequest,authority).method,"run.get.v1");
 const scopedWorker=createAuthenticatedContextV1(inspection,{...grant,proposalId:null,allowedMethods:["task.get.v1"],taskId:"task"},"2029-01-01T00:00:00.000Z");
 assert.throws(()=>parseJsonRpcRequestV1({...getRequest,method:"task.get.v1",params:{...getRequest.params,body:{schemaVersion:"1",workspaceId:"ws",runId:"run",taskId:"other",input:{schemaVersion:"1",requestType:"task.get.v1",value:{operationId:"get-task",taskId:"other",includeAttempts:false}}}}},scopedWorker),denied("AUTH_SCOPE_MISMATCH"));
 const scopedAuthority=createAuthenticatedContextV1(inspection,{...authorityGrant,runId:"run",allowedMethods:["run.get.v1"]},"2029-01-01T00:00:00.000Z");
 assert.throws(()=>parseJsonRpcRequestV1({...getRequest,params:{...getRequest.params,observationCursor:{...cursor,runId:"other"},body:{...getRequest.params.body,runId:"other",input:{...getRequest.params.body.input,value:{...getRequest.params.body.input.value,observationCursor:{...cursor,runId:"other"}}}}}},scopedAuthority),denied("AUTH_SCOPE_MISMATCH"));
});

test("unix socket inspection proves endpoint and private parent",()=>{
 const make=(candidate:TransportInspectionV1)=>()=>createAuthenticatedContextV1(candidate,grant,"2029-01-01T00:00:00.000Z");
 assert.throws(make({...inspection,isSymbolicLink:true}),denied("TRANSPORT_NOT_ALLOWED"));
 assert.throws(make({...inspection,realPath:"/tmp/redirect.sock"}),denied("TRANSPORT_NOT_ALLOWED"));
 assert.throws(make({...inspection,endpointType:"other"}),denied("TRANSPORT_NOT_ALLOWED"));
 assert.throws(make({...inspection,parentPath:"/tmp"}),denied("TRANSPORT_NOT_ALLOWED"));
 assert.throws(make({...inspection,parentRealPath:"/tmp/substitute"}),denied("TRANSPORT_NOT_ALLOWED"));
 assert.throws(make({...inspection,parentType:"other"}),denied("TRANSPORT_NOT_ALLOWED"));
 assert.throws(make({...inspection,parentIsSymbolicLink:true}),denied("TRANSPORT_NOT_ALLOWED"));
 assert.throws(make({...inspection,parentOwnerMatchesProcess:false}),denied("TRANSPORT_OWNER_INVALID"));
 assert.throws(make({...inspection,parentMode:0o755}),denied("TRANSPORT_PERMISSIONS_INVALID"));
 assert.doesNotThrow(make({...inspection,parentMode:0o700}));
});

test("privileged inspection precedes grant lookup and rejects unsafe pipes",async()=>{
 const inspectors={
  stdio:{inspectStdio:async()=>({transport:"stdio",localOnly:true,peerVerified:true,peerIdentity:"uid:1000",processInherited:true} as const)},
  unixSocket:{inspectUnixSocket:async()=>inspection},
  windowsPipe:{inspectWindowsPipe:async()=>({transport:"windows-named-pipe",localOnly:true,peerVerified:true,peerIdentity:"sid:owner",ownerMatchesProcess:true,ownerOnlyDacl:false,daclInheriting:true} as const)}
 };
 let lookedUp=false;
 const grants={lookupActiveGrant:async(peer:string)=>{lookedUp=true;assert.equal(peer,"uid:1000");return grant}};
 assert.equal((await inspectAndAuthenticateTransportV1({transport:"unix-socket",endpointPath:inspection.endpointPath},"grant-ref",inspectors,grants,"2029-01-01T00:00:00.000Z")).principalId,"principal");
 assert.equal(lookedUp,true);
 await assert.rejects(()=>inspectAndAuthenticateTransportV1({transport:"windows-named-pipe",pipeName:"pipe"},"grant-ref",inspectors,grants,"2029-01-01T00:00:00.000Z"),denied("TRANSPORT_PERMISSIONS_INVALID"));
 assert.equal(PROTOCOL_RPC_CODES.AUTH_SCOPE_MISMATCH,-32011);
});
