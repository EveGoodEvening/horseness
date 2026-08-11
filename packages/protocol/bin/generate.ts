#!/usr/bin/env node
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {canonicalJson,type JsonValue} from "@horseness/domain";
import {DOMAIN_MAPPING_NAMES_V1} from "../src/mappings.js";
import {COORDINATOR_BODY_SCHEMA_V1} from "../src/dto.js";
import {METHOD_REGISTRY_V1} from "../src/registry.js";
const root=resolve(import.meta.dirname,"..");
const generated=resolve(root,"generated");
const bodySchema={"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://horseness.dev/schema/protocol/coordinator-body-v1.json",title:"Horseness coordinator DTO wrapper v1",oneOf:Object.entries(COORDINATOR_BODY_SCHEMA_V1.scopeRequiredFields).map(([scope,fields])=>({title:scope,type:"object",additionalProperties:false,required:["schemaVersion","workspaceId",...fields],properties:{schemaVersion:{const:"1"},workspaceId:{type:"string",minLength:1},runId:{type:"string",minLength:1},taskId:{type:"string",minLength:1},attemptId:{type:"string",minLength:1},generation:{type:"integer",minimum:1},proposalId:{type:"string",minLength:1},adapterId:{type:"string",minLength:1},input:{}}}))};
const schema={"$schema":"https://json-schema.org/draft/2020-12/schema","$id":"https://horseness.dev/schema/protocol/json-rpc-v1.json",title:"Horseness JSON-RPC 2.0 request v1",type:"object",additionalProperties:false,required:["jsonrpc","id","method","params"],properties:{jsonrpc:{const:"2.0"},id:{type:["string","number","null"]},method:{enum:METHOD_REGISTRY_V1.map(({method})=>method)},params:{type:"object",additionalProperties:false,required:["protocolVersion","observationCursor","body"],properties:{protocolVersion:{const:"1"},observationCursor:{type:"object"},idempotencyKey:{type:"string",minLength:1},body:{"$ref":"coordinator-body-v1.schema.json"},page:{type:"object"},resume:{type:"object"}}}}};
const manifest={schemaVersion:"1",protocol:"json-rpc-2.0",unknownMethod:"deny",unknownVersion:"deny",methods:METHOD_REGISTRY_V1,mappings:DOMAIN_MAPPING_NAMES_V1,coordinatorBodyMapping:COORDINATOR_BODY_SCHEMA_V1};
const outputs=new Map([["json-rpc-v1.schema.json",canonicalJson(schema as JsonValue)+"\n"],["protocol-manifest-v1.json",canonicalJson(manifest as unknown as JsonValue)+"\n"],["coordinator-body-v1.schema.json",canonicalJson(bodySchema as JsonValue)+"\n"]]);
await mkdir(generated,{recursive:true});
let mismatch=false;
for(const [name,content] of outputs){const path=resolve(generated,name);if(process.argv.includes("--check")){let current="";try{current=await readFile(path,"utf8")}catch{}if(current!==content){console.error(`generated artifact differs: ${name}`);mismatch=true}}else await writeFile(path,content,"utf8")}
if(mismatch)process.exit(1);
