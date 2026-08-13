import {dirname} from "node:path";
import {assertJsonValue,canonicalJson,parseObservationCursorV1,parseResultCursorV1,type JsonValue,type ObservationCursorV1,type ResultCursorV1} from "@horseness/domain";
import {isAuthorizedMethod,methodDefinition,PROTOCOL_VERSION,type MethodDefinitionV1,type PrincipalRole,type ProtocolMethodV1} from "./registry.js";
import {parseCoordinatorBodyV1,type CoordinatorBodyV1} from "./dto.js";
import {ProtocolError,protocolError} from "./errors.js";
import type {AuthenticatedGrantV1,GrantLookupV1,TransportInspectionV1,TransportInspectorsV1} from "./spi.js";

export type JsonRpcId=string|number|null;
export interface JsonRpcRequestV1{jsonrpc:"2.0";id:JsonRpcId;method:ProtocolMethodV1;params:RpcParamsV1}
export interface RpcParamsV1{protocolVersion:"1";observationCursor:ObservationCursorV1;idempotencyKey?:string;body:JsonValue;page?:PageRequestV1;resume?:SubscriptionResumeV1}
export interface JsonRpcSuccessV1{jsonrpc:"2.0";id:JsonRpcId;result:{schemaVersion:"1";method:ProtocolMethodV1;resultCursor:ResultCursorV1|null;data:JsonValue;page?:PageResultV1;subscription?:SubscriptionResultV1}}
export interface JsonRpcFailureV1{jsonrpc:"2.0";id:JsonRpcId;error:RpcErrorV1}
export type JsonRpcResponseV1=JsonRpcSuccessV1|JsonRpcFailureV1;
export interface RpcErrorV1{code:number;message:string;data:{schemaVersion:"1";reasonCode:ProtocolReasonCode;retryable:boolean;details:JsonValue|null}}
export type ProtocolReasonCode="PARSE_ERROR"|"INVALID_REQUEST"|"METHOD_NOT_FOUND"|"METHOD_NOT_AUTHORIZED"|"INVALID_PARAMS"|"UNSUPPORTED_PROTOCOL_VERSION"|"CURSOR_SCOPE_INSUFFICIENT"|"AUTH_CONTEXT_REQUIRED"|"AUTH_SCOPE_MISMATCH"|"GRANT_INVALID"|"GRANT_EXPIRED"|"TRANSPORT_NOT_ALLOWED"|"TRANSPORT_OWNER_INVALID"|"TRANSPORT_PERMISSIONS_INVALID"|"PEER_IDENTITY_INVALID"|"UNTRUSTED_SECURITY_METADATA"|"IDEMPOTENCY_REQUIRED"|"IDEMPOTENCY_FORBIDDEN"|"STALE_OBSERVATION"|"RESUME_TOKEN_INVALID"|"RESUME_TOKEN_EXPIRED"|"RESUME_CURSOR_MISMATCH"|"INTERNAL_ERROR";
export interface PageRequestV1{schemaVersion:"1";limit:number;afterObservationCursor:ObservationCursorV1|null;continuationToken:string|null}
export interface PageResultV1{schemaVersion:"1";items:JsonValue[];emittedResultCursors:ResultCursorV1[];nextAfterObservationCursor:ObservationCursorV1|null;continuationToken:string|null}
export interface SubscriptionResumeV1{schemaVersion:"1";subscriptionId:string;afterObservationCursor:ObservationCursorV1;resumeToken:string}
export interface SubscriptionResultV1{schemaVersion:"1";subscriptionId:string;resumeToken:string;afterObservationCursor:ObservationCursorV1;emittedResultCursor:ResultCursorV1|null}

/** Legacy wire-shaped metadata. It is never accepted as authentication context. */
export interface TransportSecurityMetadataV1{schemaVersion:"1";transport:"stdio"|"unix-socket"|"windows-named-pipe";localOnly:true;tcpEnabled:false;authenticatedPrincipalId:string;principalRole:PrincipalRole;workspaceId:string;grantDigest:string;osIdentity:string;endpointPermissions:"process-inherited"|"owner-only-0600"|"non-inheriting-owner-dacl"}

const authenticatedContexts=new WeakSet<object>();
const authenticatedCapabilities=new WeakMap<object,ReadonlySet<string>>();
export interface AuthenticatedContextV1{
 readonly schemaVersion:"1";readonly principalId:string;readonly principalRole:PrincipalRole;readonly grantDigest:string;
 readonly workspaceId:string;readonly runId:string|null;readonly taskId:string|null;readonly attemptId:string|null;readonly generation:number|null;readonly proposalId:string|null;readonly adapterId:string|null;
 readonly allowedMethods:readonly ProtocolMethodV1[];readonly transport:TransportInspectionV1;
}
export interface SubscriptionResumeClaimsV1{subscriptionId:string;resumeToken:string;expiresAt:string;afterObservationCursor:ObservationCursorV1;workspaceId:string;runId:string|null;proposalId:string|null;principalId:string;grantDigest:string}
export interface SubscriptionResumeVerifierV1{verify(resume:SubscriptionResumeV1):SubscriptionResumeClaimsV1|null;authorityTime:string}

function exactRecord(value:unknown,keys:readonly string[],reason:ProtocolReasonCode):Record<string,unknown>{if(typeof value!=="object"||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw protocolError(reason);const r=value as Record<string,unknown>,actual=Object.keys(r).sort(),expected=[...keys].sort();if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw protocolError(reason);return r}
function text(value:unknown,reason:ProtocolReasonCode="INVALID_PARAMS"):string{if(typeof value!=="string"||value.length===0)throw protocolError(reason);return value}
function observationCursor(value:unknown):ObservationCursorV1{try{return parseObservationCursorV1(value)}catch{throw protocolError("INVALID_PARAMS")}}
function resultCursor(value:unknown):ResultCursorV1{try{return parseResultCursorV1(value)}catch{throw protocolError("INVALID_PARAMS")}}
function sameCursor(a:ObservationCursorV1,b:ObservationCursorV1):boolean{return canonicalJson(a as unknown as JsonValue)===canonicalJson(b as unknown as JsonValue)}
export type LocalTransportEndpointV1={transport:"stdio"}|{transport:"unix-socket";endpointPath:string}|{transport:"windows-named-pipe";pipeName:string};

function validateCursor(definition:MethodDefinitionV1,cursor:ObservationCursorV1):void{const valid=definition.cursor==="absent-workspace"?cursor.kind==="absent-workspace-genesis":definition.cursor==="workspace"?cursor.kind==="workspace-only":definition.cursor==="absent-run"?cursor.kind==="absent-run-genesis":definition.cursor==="run"?cursor.kind==="run-only"||cursor.kind==="composite":cursor.kind==="composite";if(!valid)throw protocolError("CURSOR_SCOPE_INSUFFICIENT")}

function validateInspection(inspection:TransportInspectionV1):void{
 if(inspection.transport==="tcp")throw protocolError("TRANSPORT_NOT_ALLOWED");
 if(!inspection.localOnly)throw protocolError("TRANSPORT_NOT_ALLOWED");
 if(!inspection.peerVerified||!inspection.peerIdentity)throw protocolError("PEER_IDENTITY_INVALID");
 if(inspection.transport==="unix-socket"){
  if(inspection.endpointType!=="socket"||inspection.isSymbolicLink||inspection.realPath!==inspection.endpointPath)throw protocolError("TRANSPORT_NOT_ALLOWED");
  if(inspection.parentType!=="directory"||inspection.parentIsSymbolicLink||inspection.parentPath!==dirname(inspection.endpointPath)||inspection.parentRealPath!==inspection.parentPath)throw protocolError("TRANSPORT_NOT_ALLOWED");
  if(!inspection.ownerMatchesProcess||!inspection.parentOwnerMatchesProcess)throw protocolError("TRANSPORT_OWNER_INVALID");
  if(inspection.mode!==0o600||(inspection.parentMode&0o077)!==0)throw protocolError("TRANSPORT_PERMISSIONS_INVALID");
 }else if(inspection.transport==="windows-named-pipe"){
  if(!inspection.ownerMatchesProcess)throw protocolError("TRANSPORT_OWNER_INVALID");
  if(!inspection.ownerOnlyDacl||inspection.daclInheriting)throw protocolError("TRANSPORT_PERMISSIONS_INVALID");
 }else if(!inspection.processInherited)throw protocolError("TRANSPORT_PERMISSIONS_INVALID");
}

function validateGrantBindings(grant:AuthenticatedGrantV1):void{
 const required=new Set<"runId"|"taskId"|"attemptId"|"generation"|"proposalId"|"adapterId">();
 for(const method of grant.allowedMethods){
  const definition=methodDefinition(method);if(definition===undefined)throw protocolError("GRANT_INVALID");
  if(grant.principalRole==="authority")continue;
  if(definition.scope!=="workspace")required.add("runId");
  if(definition.scope==="task"||definition.scope==="attempt"||definition.scope==="adapter")required.add("taskId");
  if(definition.scope==="attempt"||definition.scope==="adapter"){required.add("attemptId");required.add("generation")}
  if(definition.scope==="proposal")required.add("proposalId");
  if(definition.scope==="adapter")required.add("adapterId");
 }
 for(const key of required){const value=grant[key];if(value===null||(typeof value==="string"&&value.length===0))throw protocolError("GRANT_INVALID")}
 if(grant.generation!==null&&(!Number.isSafeInteger(grant.generation)||grant.generation<1))throw protocolError("GRANT_INVALID");
}

/** Only trusted inspector and grant-lookup outputs may cross this constructor boundary. */
export function createAuthenticatedContextV1(inspection:TransportInspectionV1,grant:AuthenticatedGrantV1,authorityTime:string):AuthenticatedContextV1{
 validateInspection(inspection);
 const now=Date.parse(authorityTime),expires=Date.parse(grant.expiresAt);
 if(!Number.isFinite(now)||!Number.isFinite(expires)||expires<=now)throw protocolError("GRANT_EXPIRED");
 if(grant.revoked||grant.peerIdentity!==inspection.peerIdentity)throw protocolError(grant.revoked?"GRANT_INVALID":"PEER_IDENTITY_INVALID");
 if(grant.workspaceId.length===0||grant.principalId.length===0||grant.grantDigest.length===0)throw protocolError("GRANT_INVALID");
 validateGrantBindings(grant);
 const capabilityActions=new Set(grant.allowedMethods);if(capabilityActions.size!==grant.allowedMethods.length)throw protocolError("GRANT_INVALID");
 const context:Object=Object.freeze({schemaVersion:"1",principalId:grant.principalId,principalRole:grant.principalRole,grantDigest:grant.grantDigest,workspaceId:grant.workspaceId,runId:grant.runId,taskId:grant.taskId,attemptId:grant.attemptId,generation:grant.generation,proposalId:grant.proposalId,adapterId:grant.adapterId,allowedMethods:Object.freeze([...grant.allowedMethods]),transport:Object.freeze({...inspection})});
 authenticatedContexts.add(context);authenticatedCapabilities.set(context,capabilityActions);return context as AuthenticatedContextV1;
}
export function isAuthenticatedContextV1(value:unknown):value is AuthenticatedContextV1{return typeof value==="object"&&value!==null&&authenticatedContexts.has(value as object)}
export async function inspectAndAuthenticateTransportV1(endpoint:LocalTransportEndpointV1,grantReference:string,inspectors:TransportInspectorsV1,grants:GrantLookupV1,authorityTime:string):Promise<AuthenticatedContextV1>{
 const inspection=endpoint.transport==="stdio"?await inspectors.stdio.inspectStdio():endpoint.transport==="unix-socket"?await inspectors.unixSocket.inspectUnixSocket(endpoint.endpointPath):await inspectors.windowsPipe.inspectWindowsPipe(endpoint.pipeName);
 if(endpoint.transport==="unix-socket"&&(inspection.transport!=="unix-socket"||inspection.endpointPath!==endpoint.endpointPath))throw protocolError("TRANSPORT_NOT_ALLOWED");
 validateInspection(inspection);
 if(inspection.peerIdentity===null)throw protocolError("PEER_IDENTITY_INVALID");const grant=await grants.lookupActiveGrant(inspection.peerIdentity,grantReference);
 if(grant===null)throw protocolError("GRANT_INVALID");
 return createAuthenticatedContextV1(inspection,grant,authorityTime);
}

function bindScope(context:AuthenticatedContextV1,body:CoordinatorBodyV1,cursor:ObservationCursorV1,definition:MethodDefinitionV1):void{
 if(body.workspaceId!==context.workspaceId||cursor.workspaceId!==context.workspaceId)throw protocolError("AUTH_SCOPE_MISMATCH");
 if(body.runId!==undefined&&"runId" in cursor&&body.runId!==cursor.runId)throw protocolError("AUTH_SCOPE_MISMATCH");
 const required:readonly ("runId"|"taskId"|"attemptId"|"generation"|"proposalId"|"adapterId")[]=definition.scope==="workspace"?[]:definition.scope==="run"?["runId"]:definition.scope==="task"?["runId","taskId"]:definition.scope==="attempt"?["runId","taskId","attemptId","generation"]:definition.scope==="proposal"?["runId","proposalId"]:["runId","taskId","attemptId","generation","adapterId"];
 const bindings:readonly ("runId"|"taskId"|"attemptId"|"generation"|"proposalId"|"adapterId")[]=["runId","taskId","attemptId","generation","proposalId","adapterId"];
 for(const key of bindings){const bound=context[key],actual=body[key];if(actual!==undefined||required.includes(key)){if(actual===undefined||(bound!==null&&actual!==bound))throw protocolError("AUTH_SCOPE_MISMATCH")}}
}
function validateResume(resume:SubscriptionResumeV1,cursor:ObservationCursorV1,body:CoordinatorBodyV1,context:AuthenticatedContextV1,verifier:SubscriptionResumeVerifierV1|undefined):void{
 if(!verifier)throw protocolError("RESUME_TOKEN_INVALID");const claims=verifier.verify(resume);if(!claims)throw protocolError("RESUME_TOKEN_INVALID");
 const now=Date.parse(verifier.authorityTime),expires=Date.parse(claims.expiresAt);if(!Number.isFinite(now)||!Number.isFinite(expires)||expires<=now)throw protocolError("RESUME_TOKEN_EXPIRED");
 if(claims.subscriptionId!==resume.subscriptionId||claims.resumeToken!==resume.resumeToken||!sameCursor(claims.afterObservationCursor,resume.afterObservationCursor)||!sameCursor(resume.afterObservationCursor,cursor))throw protocolError("RESUME_CURSOR_MISMATCH");
 if(claims.principalId!==context.principalId||claims.grantDigest!==context.grantDigest||claims.workspaceId!==context.workspaceId||claims.runId!==(body.runId??null)||claims.proposalId!==(body.proposalId??null))throw protocolError("AUTH_SCOPE_MISMATCH");
}

export function parseJsonRpcRequestV1(value:unknown,context:AuthenticatedContextV1,options:{resumeVerifier?:SubscriptionResumeVerifierV1}={}):JsonRpcRequestV1{
 if(!isAuthenticatedContextV1(context))throw protocolError("AUTH_CONTEXT_REQUIRED");
 const request=exactRecord(value,["jsonrpc","id","method","params"],"INVALID_REQUEST");if(request.jsonrpc!=="2.0"||(typeof request.id!=="string"&&typeof request.id!=="number"&&request.id!==null)||typeof request.method!=="string")throw protocolError("INVALID_REQUEST");
 const definition=methodDefinition(request.method);if(!definition)throw protocolError("METHOD_NOT_FOUND");const capabilityActions=authenticatedCapabilities.get(context);if(capabilityActions===undefined||!isAuthorizedMethod(context.principalRole,request.method,capabilityActions))throw protocolError("METHOD_NOT_AUTHORIZED");
 const paramsRecord=request.params as Record<string,unknown>;if(typeof paramsRecord!=="object"||paramsRecord===null||Array.isArray(paramsRecord))throw protocolError("INVALID_PARAMS");
 const allowed=["protocolVersion","observationCursor","idempotencyKey","body","page","resume"],actual=Object.keys(paramsRecord);if(actual.some((key)=>!allowed.includes(key))||!actual.includes("protocolVersion")||!actual.includes("observationCursor")||!actual.includes("body"))throw protocolError("INVALID_PARAMS");
 if(paramsRecord.protocolVersion!==PROTOCOL_VERSION)throw protocolError("UNSUPPORTED_PROTOCOL_VERSION");let cursor:ObservationCursorV1;try{cursor=parseObservationCursorV1(paramsRecord.observationCursor)}catch{throw protocolError("INVALID_PARAMS")}validateCursor(definition,cursor);
 if(definition.idempotency==="required"){if(typeof paramsRecord.idempotencyKey!=="string"||paramsRecord.idempotencyKey.length===0)throw protocolError("IDEMPOTENCY_REQUIRED")}else if(paramsRecord.idempotencyKey!==undefined)throw protocolError("IDEMPOTENCY_FORBIDDEN");
 const body=parseCoordinatorBodyV1(request.method as ProtocolMethodV1,definition,paramsRecord.body);bindScope(context,body,cursor,definition);
 const page=paramsRecord.page===undefined?undefined:parsePageRequestV1(paramsRecord.page);const resume=paramsRecord.resume===undefined?undefined:parseSubscriptionResumeV1(paramsRecord.resume);
 if(definition.kind==="query"){if(resume!==undefined)throw protocolError("INVALID_PARAMS")}else if(definition.kind==="subscription"){if(page!==undefined)throw protocolError("INVALID_PARAMS");if(resume!==undefined)validateResume(resume,cursor,body,context,options.resumeVerifier)}else if(page!==undefined||resume!==undefined)throw protocolError("INVALID_PARAMS");
 return{jsonrpc:"2.0",id:request.id as JsonRpcId,method:request.method as ProtocolMethodV1,params:{protocolVersion:"1",observationCursor:cursor,...(paramsRecord.idempotencyKey===undefined?{}:{idempotencyKey:paramsRecord.idempotencyKey as string}),body:body as unknown as JsonValue,...(page===undefined?{}:{page}),...(resume===undefined?{}:{resume})}};
}
export function parsePageRequestV1(value:unknown):PageRequestV1{const r=exactRecord(value,["schemaVersion","limit","afterObservationCursor","continuationToken"],"INVALID_PARAMS");if(r.schemaVersion!=="1"||!Number.isSafeInteger(r.limit)||(r.limit as number)<1||(r.limit as number)>1000||(r.continuationToken!==null&&(typeof r.continuationToken!=="string"||r.continuationToken.length===0)))throw protocolError("INVALID_PARAMS");return{schemaVersion:"1",limit:r.limit as number,afterObservationCursor:r.afterObservationCursor===null?null:observationCursor(r.afterObservationCursor),continuationToken:r.continuationToken as string|null}}
export function parsePageResultV1(value:unknown):PageResultV1{const r=exactRecord(value,["schemaVersion","items","emittedResultCursors","nextAfterObservationCursor","continuationToken"],"INVALID_PARAMS");if(r.schemaVersion!=="1"||!Array.isArray(r.items)||!Array.isArray(r.emittedResultCursors)||(r.continuationToken!==null&&(typeof r.continuationToken!=="string"||r.continuationToken.length===0)))throw protocolError("INVALID_PARAMS");for(const item of r.items)assertJsonValue(item);return{schemaVersion:"1",items:r.items as JsonValue[],emittedResultCursors:r.emittedResultCursors.map(resultCursor),nextAfterObservationCursor:r.nextAfterObservationCursor===null?null:observationCursor(r.nextAfterObservationCursor),continuationToken:r.continuationToken as string|null}}
export function parseSubscriptionResumeV1(value:unknown):SubscriptionResumeV1{const r=exactRecord(value,["schemaVersion","subscriptionId","afterObservationCursor","resumeToken"],"RESUME_TOKEN_INVALID");if(r.schemaVersion!=="1")throw protocolError("UNSUPPORTED_PROTOCOL_VERSION");try{return{schemaVersion:"1",subscriptionId:text(r.subscriptionId,"RESUME_TOKEN_INVALID"),afterObservationCursor:parseObservationCursorV1(r.afterObservationCursor),resumeToken:text(r.resumeToken,"RESUME_TOKEN_INVALID")}}catch(error){if(error instanceof ProtocolError)throw error;throw protocolError("RESUME_TOKEN_INVALID")}}
export function parseSubscriptionResultV1(value:unknown):SubscriptionResultV1{const r=exactRecord(value,["schemaVersion","subscriptionId","resumeToken","afterObservationCursor","emittedResultCursor"],"INVALID_PARAMS");if(r.schemaVersion!=="1")throw protocolError("INVALID_PARAMS");return{schemaVersion:"1",subscriptionId:text(r.subscriptionId),resumeToken:text(r.resumeToken),afterObservationCursor:observationCursor(r.afterObservationCursor),emittedResultCursor:r.emittedResultCursor===null?null:resultCursor(r.emittedResultCursor)}}
export function successResponse(id:JsonRpcId,method:ProtocolMethodV1,data:JsonValue,resultCursorValue:JsonValue|null=null,extra:{page?:PageResultV1;subscription?:SubscriptionResultV1}={}):JsonRpcSuccessV1{const definition=methodDefinition(method);if(definition===undefined)throw protocolError("METHOD_NOT_FOUND");const parsed=definition.parseResult(data);assertJsonValue(parsed as unknown as JsonValue);const parsedResultCursor=resultCursorValue===null?null:resultCursor(resultCursorValue);const page=extra.page===undefined?undefined:parsePageResultV1(extra.page);const subscription=extra.subscription===undefined?undefined:parseSubscriptionResultV1(extra.subscription);if(definition.kind==="query"){if(subscription!==undefined)throw protocolError("INVALID_PARAMS")}else if(definition.kind==="subscription"){if(page!==undefined||subscription===undefined)throw protocolError("INVALID_PARAMS")}else if(page!==undefined||subscription!==undefined)throw protocolError("INVALID_PARAMS");return{jsonrpc:"2.0",id,result:{schemaVersion:"1",method,resultCursor:parsedResultCursor,data:parsed as unknown as JsonValue,...(page===undefined?{}:{page}),...(subscription===undefined?{}:{subscription})}}}
export function failureResponse(id:JsonRpcId,error:unknown):JsonRpcFailureV1{const e=error instanceof ProtocolError?error:protocolErrorValue("INTERNAL_ERROR");return{jsonrpc:"2.0",id,error:{code:e.rpcCode,message:e.reasonCode,data:{schemaVersion:"1",reasonCode:e.reasonCode,retryable:e.retryable,details:e.details}}}}
function protocolErrorValue(reason:ProtocolReasonCode):ProtocolError{return new ProtocolError(reason)}
export function canonicalProtocolMessage(value:JsonRpcRequestV1|JsonRpcResponseV1):string{return canonicalJson(value as unknown as JsonValue)}
/** Syntax-only legacy helper. Its output is deliberately not an AuthenticatedContextV1. */
export function validateTransportSecurity(value:unknown):TransportSecurityMetadataV1{const r=exactRecord(value,["schemaVersion","transport","localOnly","tcpEnabled","authenticatedPrincipalId","principalRole","workspaceId","grantDigest","osIdentity","endpointPermissions"],"INVALID_PARAMS");if(r.schemaVersion!=="1"||!(["stdio","unix-socket","windows-named-pipe"] as unknown[]).includes(r.transport)||r.localOnly!==true||r.tcpEnabled!==false||!(["authority","approver","operator","worker","adapter"] as unknown[]).includes(r.principalRole))throw protocolError("INVALID_PARAMS");const expected=r.transport==="stdio"?"process-inherited":r.transport==="unix-socket"?"owner-only-0600":"non-inheriting-owner-dacl";if(r.endpointPermissions!==expected)throw protocolError("INVALID_PARAMS");for(const key of ["authenticatedPrincipalId","workspaceId","grantDigest","osIdentity"])text(r[key]);return r as unknown as TransportSecurityMetadataV1}
