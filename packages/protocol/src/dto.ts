import type {DomainWireMappingV1,DomainMappingNameV1} from "./mappings.js";
import {parseDomainWireMappingV1} from "./mappings.js";
import {ProtocolError} from "./errors.js";
import type {MethodDefinitionV1,ProtocolMethodV1} from "./registry.js";

export interface EmptyMethodRequestV1 {schemaVersion:"1";requestType:ProtocolMethodV1}
export interface EmptyMethodResultV1 {schemaVersion:"1";resultType:ProtocolMethodV1}
export interface MappedMethodRequestV1 {schemaVersion:"1";requestType:ProtocolMethodV1;value:DomainWireMappingV1["value"]}
export interface MappedMethodResultV1 {schemaVersion:"1";resultType:ProtocolMethodV1;value:DomainWireMappingV1["value"]}
export type MethodRequestV1=EmptyMethodRequestV1|MappedMethodRequestV1;
export type MethodResultV1=EmptyMethodResultV1|MappedMethodResultV1;
export type CoordinatorBodyV1={schemaVersion:"1";workspaceId:string;runId?:string;taskId?:string;attemptId?:string;generation?:number;proposalId?:string;adapterId?:string;input:MethodRequestV1};

const ID_KEYS_BY_SCOPE={workspace:[] as const,run:["runId"] as const,task:["runId","taskId"] as const,attempt:["runId","taskId","attemptId","generation"] as const,proposal:["runId","proposalId"] as const,adapter:["runId","taskId","attemptId","generation","adapterId"] as const};
function exactRecord(value:unknown,keys:readonly string[],method:string):Record<string,unknown>{
 if(typeof value!=="object"||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw invalid(method);
 const actual=Object.keys(value).sort(),expected=[...keys].sort();
 if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))throw invalid(method);
 return value as Record<string,unknown>;
}
const DOMAIN_TAG_BY_METHOD:Readonly<Record<string,readonly [string,string]>>={
 "workspace.create.v1":["commandType","CreateWorkspaceV1"],"run.create.v1":["commandType","CreateRunV1"],"task.resolve.v1":["commandType","ResolveTaskV1"],"policy.set.v1":["commandType","ChangePolicyReferenceV1"],
 "workspace.get.v1":["queryType","GetWorkspaceV1"],"run.get.v1":["queryType","GetRunV1"],
};
const RESULT_TAG_BY_METHOD:Readonly<Record<string,readonly string[]>>={"workspace.create.v1":["WorkspaceCommandResultV1"],"workspace.get.v1":["WorkspaceQueryResultV1"],"run.create.v1":["RunCommandResultV1"],"run.get.v1":["RunQueryResultV1"],"task.resolve.v1":["RunCommandResultV1","DualStreamCommandResultV1"],"policy.set.v1":["WorkspaceCommandResultV1"],"receipt.submit.v1":["RunCommandResultV1"],"proposal.submit.v1":["RunCommandResultV1"],"proposal.release.v1":["RunCommandResultV1","DualStreamCommandResultV1"]};
function invalid(method:string,key?:string):ProtocolError{return new ProtocolError("INVALID_PARAMS",-32602,false,{method,...(key?{key}:{})} as never)}
function parseMapped(method:ProtocolMethodV1,discriminator:"requestType"|"resultType",mapping:DomainMappingNameV1|null,value:unknown):MethodRequestV1|MethodResultV1{
 const record=exactRecord(value,mapping===null?["schemaVersion",discriminator]:["schemaVersion",discriminator,"value"],method);
 if(record.schemaVersion!=="1"||record[discriminator]!==method)throw invalid(method,discriminator);
 if(mapping===null)return record as unknown as MethodRequestV1|MethodResultV1;
 const parsed=parseDomainWireMappingV1(mapping,record.value),parsedRecord=parsed.value as unknown as Record<string,unknown>;
 const expectedDomainTag=DOMAIN_TAG_BY_METHOD[method];if(discriminator==="requestType"&&expectedDomainTag!==undefined&&parsedRecord[expectedDomainTag[0]]!==expectedDomainTag[1])throw invalid(method,"value");
 const expectedResultTags=RESULT_TAG_BY_METHOD[method];if(discriminator==="resultType"&&expectedResultTags!==undefined&&!expectedResultTags.includes(parsedRecord.resultType as string))throw invalid(method,"value");
 return {...record,value:parsed.value} as MethodRequestV1|MethodResultV1;
}
export function parseMethodRequestV1(method:ProtocolMethodV1,definition:MethodDefinitionV1,value:unknown):MethodRequestV1{return parseMapped(method,"requestType",definition.inputMapping,value) as MethodRequestV1}
export function parseMethodResultV1(method:ProtocolMethodV1,definition:MethodDefinitionV1,value:unknown):MethodResultV1{return parseMapped(method,"resultType",definition.resultMapping,value) as MethodResultV1}
export function parseCoordinatorBodyV1(method:ProtocolMethodV1,definition:MethodDefinitionV1,value:unknown):CoordinatorBodyV1{
 const required=["schemaVersion","workspaceId",...ID_KEYS_BY_SCOPE[definition.scope],"input"];
 const body=exactRecord(value,required,method);
 if(body.schemaVersion!=="1")throw invalid(method,"schemaVersion");
 for(const key of required)if(key!=="schemaVersion"&&key!=="generation"&&key!=="input"&&(typeof body[key]!=="string"||body[key]===""))throw invalid(method,key);
 if("generation" in body&&(!Number.isSafeInteger(body.generation)||(body.generation as number)<1))throw invalid(method,"generation");
 return {...body,input:parseMethodRequestV1(method,definition,body.input)} as CoordinatorBodyV1;
}
export const COORDINATOR_BODY_SCHEMA_V1={schemaVersion:"1",additionalProperties:false,scopeRequiredFields:ID_KEYS_BY_SCOPE,commonRequiredFields:["schemaVersion","workspaceId","input"],methodInput:{discriminator:"requestType",additionalProperties:false},methodResult:{discriminator:"resultType",additionalProperties:false}} as const;
