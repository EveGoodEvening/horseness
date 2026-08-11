import type {DomainWireMappingV1,DomainMappingNameV1,MethodMappingNameV1} from "./mappings.js";
import {parseDomainWireMappingV1} from "./mappings.js";
import {ProtocolError} from "./errors.js";
import type {MethodDefinitionV1,ProtocolMethodV1} from "./registry.js";

export type MethodDtoValueV1=Readonly<Record<string,unknown>>|DomainWireMappingV1["value"];
export interface MethodRequestV1 {schemaVersion:"1";requestType:ProtocolMethodV1;value:MethodDtoValueV1}
export interface MethodResultV1 {schemaVersion:"1";resultType:ProtocolMethodV1;value:MethodDtoValueV1}
export type CoordinatorBodyV1={schemaVersion:"1";workspaceId:string;runId?:string;taskId?:string;attemptId?:string;generation?:number;proposalId?:string;adapterId?:string;input:MethodRequestV1};

type FieldKind="id"|"text"|"integer"|"boolean"|"object"|"array"|"status";
type Shape=Readonly<Record<string,FieldKind>>;
const shape=(fields:Record<string,FieldKind>):Shape=>Object.freeze(fields);
const request=(fields:Record<string,FieldKind>):Shape=>shape({operationId:"id",...fields});
const result=(fields:Record<string,FieldKind>):Shape=>shape({outcomeId:"id",status:"status",...fields});

/** Closed local DTO contracts. Domain-mapped methods deliberately delegate their value to the domain parser instead. */
export const METHOD_LOCAL_DTO_SHAPES_V1:Readonly<Record<string,{request:Shape;result:Shape}>>={
 "run.list.v1":{request:request({limit:"integer",continuationToken:"text"}),result:result({runs:"array",nextContinuationToken:"text"})},
 "run.status.v1":{request:request({includeAttemptSummary:"boolean"}),result:result({runStatus:"text",activeAttemptCount:"integer",observationCursor:"object"})},
 "dependency.add.v1":{request:request({edge:"object"}),result:result({edgeId:"id",observationCursor:"object"})},
 "run.close.v1":{request:request({reason:"text",expectedRunStatus:"text"}),result:result({closedRunId:"id",closedAt:"text",observationCursor:"object"})},
 "proposal.evaluate.v1":{request:request({proposal:"object"}),result:result({proposalId:"id",decision:"object",reasonCodes:"array"})},
 "task.create.v1":{request:request({taskContract:"object",dependencyTaskIds:"array"}),result:result({taskId:"id",taskContractDigest:"text",observationCursor:"object"})},
 "task.update.v1":{request:request({taskId:"id",expectedTaskVersion:"integer",patch:"object"}),result:result({taskId:"id",taskVersion:"integer",observationCursor:"object"})},
 "task.cancel.v1":{request:request({taskId:"id",reason:"text",cascade:"boolean"}),result:result({taskId:"id",resolution:"text",observationCursor:"object"})},
 "task.get.v1":{request:request({taskId:"id",includeAttempts:"boolean"}),result:result({task:"object",observationCursor:"object"})},
 "task.list.v1":{request:request({states:"array",limit:"integer",continuationToken:"text"}),result:result({tasks:"array",nextContinuationToken:"text",observationCursor:"object"})},
 "dependency.list.v1":{request:request({taskId:"id",direction:"text"}),result:result({edges:"array",observationCursor:"object"})},
 "join.get.v1":{request:request({taskId:"id",joinEvaluationId:"id"}),result:result({snapshot:"object",observationCursor:"object"})},
 "join.list.v1":{request:request({schedulability:"text",limit:"integer"}),result:result({snapshots:"array",observationCursor:"object"})},
 "fork.get.v1":{request:request({forkId:"id",pinVersion:"integer"}),result:result({forkPin:"object",observationCursor:"object"})},
 "context.get.v1":{request:request({attemptId:"id",generation:"integer",manifestDigest:"text"}),result:result({manifest:"object",renderedArtifactDigest:"text"})},
 "dispatch.launch.v1":{request:request({attemptId:"id",generation:"integer",adapterId:"id",contextBindingDigest:"text"}),result:result({dispatchId:"id",adapterHandle:"text",providerIdempotencyKey:"text"})},
 "dispatch.cancel.v1":{request:request({dispatchId:"id",reason:"text",force:"boolean"}),result:result({dispatchId:"id",cancelState:"text",adapterAcknowledged:"boolean"})},
 "dispatch.reconcile.v1":{request:request({dispatchId:"id",adapterHandle:"text",lastKnownState:"text"}),result:result({dispatchId:"id",observedState:"text",receiptAvailable:"boolean"})},
 "dispatch.resolveUnknown.v1":{request:request({dispatchId:"id",resolution:"text",evidence:"object"}),result:result({dispatchId:"id",resolvedState:"text",observationCursor:"object"})},
 "dispatch.authorizeDuplicateRisk.v1":{request:request({dispatchId:"id",riskReason:"text",expiresAt:"text"}),result:result({authorizationId:"id",dispatchId:"id",authorizedUntil:"text"})},
 "dispatch.get.v1":{request:request({dispatchId:"id",includeAdapterEvidence:"boolean"}),result:result({dispatch:"object",observationCursor:"object"})},
 "artifact.publish.v1":{request:request({artifactId:"id",mediaType:"text",contentDigest:"text",byteLength:"integer",storageReference:"text"}),result:result({artifactId:"id",publishedDigest:"text",immutableReference:"text"})},
 "artifact.get.v1":{request:request({artifactId:"id",expectedDigest:"text"}),result:result({artifactMetadata:"object",downloadReference:"text"})},
 "receipt.get.v1":{request:request({attemptId:"id",generation:"integer",receiptDigest:"text"}),result:result({receipt:"object",acceptedAt:"text"})},
 "proposal.get.v1":{request:request({proposalId:"id",proposalDigest:"text"}),result:result({proposal:"object",admissionState:"text"})},
 "proposal.approve.v1":{request:request({proposalId:"id",proposalDigest:"text",approvalReason:"text"}),result:result({proposalId:"id",decisionId:"id",admissionState:"text"})},
 "proposal.reject.v1":{request:request({proposalId:"id",proposalDigest:"text",reasonCodes:"array"}),result:result({proposalId:"id",decisionId:"id",admissionState:"text"})},
 "admission.decision.v1":{request:request({proposalId:"id",proposalDigest:"text"}),result:result({decision:"object",observationCursor:"object"})},
 "admission.subscribe.v1":{request:request({proposalId:"id",afterSequence:"integer",resumeToken:"text"}),result:result({subscriptionId:"id",events:"array",resumeToken:"text"})},
 "admission.history.v1":{request:request({proposalId:"id",limit:"integer",continuationToken:"text"}),result:result({decisions:"array",nextContinuationToken:"text"})},
 "canonical.get.v1":{request:request({revision:"integer",includeDocument:"boolean"}),result:result({canonicalRevision:"integer",canonicalStateHash:"text",document:"object"})},
 "history.list.v1":{request:request({afterSequence:"integer",limit:"integer",stream:"text"}),result:result({events:"array",nextSequence:"integer",observationCursor:"object"})},
 "history.subscribe.v1":{request:request({afterSequence:"integer",stream:"text",resumeToken:"text"}),result:result({subscriptionId:"id",events:"array",resumeToken:"text"})},
 "policy.get.v1":{request:request({policyDigest:"text",includeDocument:"boolean"}),result:result({policyReference:"object",effectivePolicyDigest:"text"})},
 "grant.issue.v1":{request:request({principalId:"id",principalRole:"text",actions:"array",resourceScope:"object",expiresAt:"text"}),result:result({grantId:"id",grantDigest:"text",issuedAt:"text"})},
 "grant.delegate.v1":{request:request({parentGrantDigest:"text",delegatePrincipalId:"id",actions:"array",resourceScope:"object",expiresAt:"text"}),result:result({grantId:"id",grantDigest:"text",delegationDepth:"integer"})},
 "grant.revoke.v1":{request:request({grantDigest:"text",reason:"text",effectiveAt:"text"}),result:result({grantDigest:"text",revokedAt:"text",observationCursor:"object"})},
 "grant.list.v1":{request:request({principalId:"id",includeRevoked:"boolean",limit:"integer"}),result:result({grants:"array",observationCursor:"object"})},
 "quota.set.v1":{request:request({quotaSubjectId:"id",limits:"object",effectiveAt:"text"}),result:result({quotaDigest:"text",quotaVersion:"integer",observationCursor:"object"})},
 "quota.get.v1":{request:request({quotaSubjectId:"id",includeUsage:"boolean"}),result:result({quota:"object",usage:"object",observationCursor:"object"})},
 "adapter.capabilities.v1":{request:request({adapterId:"id",hostKind:"text",protocolVersion:"text"}),result:result({adapterId:"id",capabilities:"array",limits:"object"})},
 "adapter.launch.v1":{request:request({dispatchId:"id",attemptId:"id",generation:"integer",contextBindingDigest:"text",providerIdempotencyKey:"text",launchOptions:"object"}),result:result({adapterHandle:"text",nativeRunId:"id",launchState:"text"})},
 "adapter.cancel.v1":{request:request({adapterHandle:"text",reason:"text",force:"boolean"}),result:result({adapterHandle:"text",cancelState:"text",terminal:"boolean"})},
 "adapter.reconcile.v1":{request:request({adapterHandle:"text",expectedProviderIdempotencyKey:"text"}),result:result({adapterHandle:"text",nativeState:"text",receiptAvailable:"boolean",evidence:"object"})},
 "adapter.resume.v1":{request:request({adapterHandle:"text",resumeToken:"text",contextBindingDigest:"text"}),result:result({adapterHandle:"text",nativeState:"text",nextResumeToken:"text"})},
 "adapter.reattach.v1":{request:request({nativeRunId:"id",providerIdempotencyKey:"text",expectedAttemptId:"id"}),result:result({adapterHandle:"text",nativeRunId:"id",verifiedIdentity:"boolean"})},
 "adapter.injectContext.v1":{request:request({adapterHandle:"text",contextManifestDigest:"text",renderedArtifactReference:"text"}),result:result({adapterHandle:"text",injectedDigest:"text",nativeContextVersion:"integer"})},
 "adapter.collectReceipt.v1":{request:request({adapterHandle:"text",expectedReceiptSchemaVersion:"text"}),result:result({receiptEnvelope:"object",producerPrincipalId:"id",producerGrantDigest:"text"})},
 "adapter.nativePackageMetadata.v1":{request:request({adapterId:"id",packageReference:"text",hostKind:"text"}),result:result({packageName:"text",packageVersion:"text",integrityDigest:"text",contributions:"array"})},
 "adapter.installContributions.v1":{request:request({adapterId:"id",packageIntegrityDigest:"text",contributions:"array",installRoot:"text"}),result:result({installedPaths:"array",rollbackToken:"text",verifiedIntegrity:"boolean"})},
 "adapter.doctor.v1":{request:request({adapterId:"id",checks:"array",includeSensitiveDetails:"boolean"}),result:result({checks:"array",healthy:"boolean",remediationCodes:"array"})},
 "adapter.workerReturn.v1":{request:request({adapterHandle:"text",attemptId:"id",generation:"integer",receiptEnvelope:"object",artifacts:"array"}),result:result({acceptedReceiptDigest:"text",acceptedArtifactIds:"array",terminalState:"text"})}
};

const ID_KEYS_BY_SCOPE={workspace:[] as const,run:["runId"] as const,task:["runId","taskId"] as const,attempt:["runId","taskId","attemptId","generation"] as const,proposal:["runId","proposalId"] as const,adapter:["runId","taskId","attemptId","generation","adapterId"] as const};
function invalid(method:string,key?:string):ProtocolError{return new ProtocolError("INVALID_PARAMS",-32602,false,{method,...(key?{key}:{})} as never)}
function exactRecord(value:unknown,keys:readonly string[],method:string):Record<string,unknown>{if(typeof value!=="object"||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw invalid(method);const actual=Object.keys(value).sort(),expected=[...keys].sort();if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw invalid(method);return value as Record<string,unknown>}
function validateField(value:unknown,kind:FieldKind,method:string,key:string):void{const plain=typeof value==="object"&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;switch(kind){case"id":case"text":if(typeof value!=="string"||value.length===0)throw invalid(method,key);break;case"integer":if(!Number.isSafeInteger(value)||(value as number)<0)throw invalid(method,key);break;case"boolean":if(typeof value!=="boolean")throw invalid(method,key);break;case"object":if(!plain||Object.keys(value as object).length===0)throw invalid(method,key);break;case"array":if(!Array.isArray(value)||value.length===0)throw invalid(method,key);break;case"status":if(value!=="accepted"&&value!=="rejected"&&value!=="pending"&&value!=="completed")throw invalid(method,key)}}
function parseLocal(method:ProtocolMethodV1,direction:"request"|"result",value:unknown):Readonly<Record<string,unknown>>{const contract=METHOD_LOCAL_DTO_SHAPES_V1[method]?.[direction];if(contract===undefined)throw invalid(method,"mapping");const record=exactRecord(value,Object.keys(contract),method);for(const [key,kind] of Object.entries(contract))validateField(record[key],kind,method,key);return record}
const DOMAIN_TAG_BY_METHOD:Readonly<Record<string,readonly [string,string]>>={"workspace.create.v1":["commandType","CreateWorkspaceV1"],"run.create.v1":["commandType","CreateRunV1"],"task.resolve.v1":["commandType","ResolveTaskV1"],"policy.set.v1":["commandType","ChangePolicyReferenceV1"],"workspace.get.v1":["queryType","GetWorkspaceV1"],"run.get.v1":["queryType","GetRunV1"]};
const RESULT_TAG_BY_METHOD:Readonly<Record<string,readonly string[]>>={"workspace.create.v1":["WorkspaceCommandResultV1"],"workspace.get.v1":["WorkspaceQueryResultV1"],"run.create.v1":["RunCommandResultV1"],"run.get.v1":["RunQueryResultV1"],"task.resolve.v1":["RunCommandResultV1","DualStreamCommandResultV1"],"policy.set.v1":["WorkspaceCommandResultV1"],"receipt.submit.v1":["RunCommandResultV1"],"proposal.submit.v1":["RunCommandResultV1"],"proposal.release.v1":["RunCommandResultV1","DualStreamCommandResultV1"]};
function parseMapped(method:ProtocolMethodV1,discriminator:"requestType"|"resultType",mapping:MethodMappingNameV1,value:unknown):MethodRequestV1|MethodResultV1{const record=exactRecord(value,["schemaVersion",discriminator,"value"],method);if(record.schemaVersion!=="1"||record[discriminator]!==method)throw invalid(method,discriminator);const direction=discriminator==="requestType"?"request":"result";if(mapping==="method-request"||mapping==="method-result"){if(mapping!==`method-${direction}`)throw invalid(method,"mapping");return{...record,value:parseLocal(method,direction,record.value)} as unknown as MethodRequestV1|MethodResultV1}const parsed=parseDomainWireMappingV1(mapping as DomainMappingNameV1,record.value),parsedRecord=parsed.value as unknown as Record<string,unknown>;const expectedDomainTag=DOMAIN_TAG_BY_METHOD[method];if(direction==="request"&&expectedDomainTag!==undefined&&parsedRecord[expectedDomainTag[0]]!==expectedDomainTag[1])throw invalid(method,"value");const expectedResultTags=RESULT_TAG_BY_METHOD[method];if(direction==="result"&&expectedResultTags!==undefined&&!expectedResultTags.includes(parsedRecord.resultType as string))throw invalid(method,"value");return{...record,value:parsed.value} as MethodRequestV1|MethodResultV1}
export function parseMethodRequestV1(method:ProtocolMethodV1,definition:MethodDefinitionV1,value:unknown):MethodRequestV1{return parseMapped(method,"requestType",definition.inputMapping,value) as MethodRequestV1}
export function parseMethodResultV1(method:ProtocolMethodV1,definition:MethodDefinitionV1,value:unknown):MethodResultV1{return parseMapped(method,"resultType",definition.resultMapping,value) as MethodResultV1}
export function parseCoordinatorBodyV1(method:ProtocolMethodV1,definition:MethodDefinitionV1,value:unknown):CoordinatorBodyV1{const required=["schemaVersion","workspaceId",...ID_KEYS_BY_SCOPE[definition.scope],"input"];const body=exactRecord(value,required,method);if(body.schemaVersion!=="1")throw invalid(method,"schemaVersion");for(const key of required)if(key!=="schemaVersion"&&key!=="generation"&&key!=="input"&&(typeof body[key]!=="string"||body[key]===""))throw invalid(method,key);if("generation" in body&&(!Number.isSafeInteger(body.generation)||(body.generation as number)<1))throw invalid(method,"generation");return{...body,input:parseMethodRequestV1(method,definition,body.input)} as CoordinatorBodyV1}
export const COORDINATOR_BODY_SCHEMA_V1={schemaVersion:"1",additionalProperties:false,scopeRequiredFields:ID_KEYS_BY_SCOPE,commonRequiredFields:["schemaVersion","workspaceId","input"],methodInput:{discriminator:"requestType",additionalProperties:false},methodResult:{discriminator:"resultType",additionalProperties:false}} as const;
