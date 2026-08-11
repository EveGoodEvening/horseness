import {assertJsonValue,type JsonValue} from "@horseness/domain";
import {ProtocolError} from "./errors.js";
import type {MethodDefinitionV1,ProtocolMethodV1} from "./registry.js";
export type CoordinatorBodyV1={schemaVersion:"1";workspaceId:string;runId?:string;taskId?:string;attemptId?:string;generation?:number;proposalId?:string;adapterId?:string;input?:JsonValue};
const ID_KEYS_BY_SCOPE={workspace:[] as const,run:["runId"] as const,task:["runId","taskId"] as const,attempt:["runId","taskId","attemptId","generation"] as const,proposal:["runId","proposalId"] as const,adapter:["runId","taskId","attemptId","generation","adapterId"] as const};
export function parseCoordinatorBodyV1(method:ProtocolMethodV1,definition:MethodDefinitionV1,value:unknown):CoordinatorBodyV1{
 if(typeof value!=="object"||value===null||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new ProtocolError("INVALID_PARAMS",-32602);
 const body=value as Record<string,unknown>,required=["schemaVersion","workspaceId",...ID_KEYS_BY_SCOPE[definition.scope]],allowed=[...required,"input"];
 if(body.schemaVersion!=="1"||Object.keys(body).some((key)=>!allowed.includes(key))||required.some((key)=>!(key in body)))throw new ProtocolError("INVALID_PARAMS",-32602,false,{method} as never);
 for(const key of required)if(key!=="schemaVersion"&&key!=="generation"&&(typeof body[key]!=="string"||body[key]===""))throw new ProtocolError("INVALID_PARAMS",-32602,false,{method,key} as never);
 if("generation" in body&&(!Number.isSafeInteger(body.generation)||(body.generation as number)<1))throw new ProtocolError("INVALID_PARAMS",-32602,false,{method,key:"generation"} as never);
 if(body.input!==undefined)try{assertJsonValue(body.input)}catch{throw new ProtocolError("INVALID_PARAMS",-32602,false,{method,key:"input"} as never)}
 return body as CoordinatorBodyV1;
}
export const COORDINATOR_BODY_SCHEMA_V1={schemaVersion:"1",additionalProperties:false,scopeRequiredFields:ID_KEYS_BY_SCOPE,commonRequiredFields:["schemaVersion","workspaceId"],optionalFields:["input"]} as const;
