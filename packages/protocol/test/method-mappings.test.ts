import assert from "node:assert/strict";
import test from "node:test";
import {METHOD_LOCAL_DTO_SHAPES_V1,METHOD_REGISTRY_V1,isAuthorizedMethod,ProtocolError} from "../src/index.js";

const ROLES=["authority","approver","operator","worker","adapter"] as const;

test("every registered method owns exact non-empty request and result parsers",()=>{
 const sample=(contract:Readonly<Record<string,string>>):Record<string,unknown>=>Object.fromEntries(Object.entries(contract).map(([key,kind])=>[key,kind==="integer"?1:kind==="boolean"?true:kind==="object"?{digest:"value"}:kind==="array"?["value"]:kind==="status"?"completed":`${key}-value`]));
 const substitute=(kind:string):unknown=>kind==="integer"?"1":kind==="boolean"?"true":kind==="object"?["wrong"]:kind==="array"?{wrong:true}:kind==="status"?"unknown":0;
 for(const definition of METHOD_REGISTRY_V1){
  assert.notEqual(definition.inputMapping,null,`${definition.method} input mapping`);
  assert.notEqual(definition.resultMapping,null,`${definition.method} result mapping`);
  for(const [direction,mapping,parse,discriminator] of [["request",definition.inputMapping,definition.parseInput,"requestType"],["result",definition.resultMapping,definition.parseResult,"resultType"]] as const){
   const shell={schemaVersion:"1",[discriminator]:definition.method};
   assert.throws(()=>parse(shell),ProtocolError,`${definition.method} rejects empty ${direction}`);
   if(mapping!==`method-${direction}`)continue;
   const contract=METHOD_LOCAL_DTO_SHAPES_V1[definition.method]?.[direction];
   assert.ok(contract,`${definition.method} ${direction} shape`);
   assert.ok(Object.keys(contract).length>=2,`${definition.method} ${direction} is meaningful`);
   const value=sample(contract),valid={...shell,value};
   assert.deepEqual(parse(valid),valid,`${definition.method} valid ${direction}`);
   for(const key of Object.keys(contract)){
    const {[key]:_missing,...missing}=value;
    assert.throws(()=>parse({...shell,value:missing}),ProtocolError,`${definition.method} ${direction} requires ${key}`);
    assert.throws(()=>parse({...shell,value:{...value,[key]:substitute(contract[key]!)}}),ProtocolError,`${definition.method} ${direction} types ${key}`);
   }
   assert.throws(()=>parse({...shell,value:{...value,extra:true}}),ProtocolError);
  }
 }
});

test("domain mappings delegate to closed domain validators",()=>{
 const definition=METHOD_REGISTRY_V1.find(({method})=>method==="dependency.add.v1");
 assert.ok(definition);
 const edge={edgeId:"edge-1",sourceTaskId:"source",dependentTaskId:"dependent",edgeType:"requires_success",releasePredicate:"task-resolution",propagateCancellation:false} as const;
 assert.deepEqual(definition.parseInput({schemaVersion:"1",requestType:definition.method,value:edge}),{schemaVersion:"1",requestType:definition.method,value:edge});
 assert.throws(()=>definition.parseInput({schemaVersion:"1",requestType:definition.method,value:{...edge,extra:true}}),ProtocolError);
});

test("method parsers reject a different member of the same domain union",()=>{
 const definition=METHOD_REGISTRY_V1.find(({method})=>method==="workspace.create.v1");assert.ok(definition);
 const absentRun={schemaVersion:"1",kind:"absent-run-genesis",workspaceId:"ws",workspaceSequence:1,workspaceEnvelopeHash:"wh",workspaceContextEpoch:0,runId:"run",expectedRunHead:"absent"} as const;
 assert.throws(()=>definition.parseInput({schemaVersion:"1",requestType:definition.method,value:{schemaVersion:"1",commandType:"CreateRunV1",commandId:"c",observationCursor:absentRun,principalId:"p",initialDocument:{}}}),ProtocolError);
});

test("role and capability policy is conjunctive and omissions deny",()=>{
 for(const definition of METHOD_REGISTRY_V1){
  assert.equal(definition.capability.required,true);
  assert.equal(definition.capability.action,definition.method);
  for(const role of ROLES){
   const roleAllowed=definition.roles.includes(role);
   assert.equal(isAuthorizedMethod(role,definition.method,new Set([definition.method])),roleAllowed,`${definition.method}:${role}:matching capability`);
   assert.equal(isAuthorizedMethod(role,definition.method,new Set()),false,`${definition.method}:${role}:missing capability`);
  }
 }
 assert.equal(isAuthorizedMethod("authority","omitted.v1",new Set(["omitted.v1"])),false);
});

test("least privilege roles cannot read broad run or canonical state",()=>{
 for(const method of ["workspace.get.v1","run.get.v1","run.status.v1","canonical.get.v1","history.list.v1","history.subscribe.v1"]){
  for(const role of ["worker","adapter","approver"] as const)assert.equal(isAuthorizedMethod(role,method,new Set([method])),false,`${role} must not read ${method}`);
 }
});
