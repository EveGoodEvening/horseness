import assert from "node:assert/strict";
import test from "node:test";
import {METHOD_REGISTRY_V1,isAuthorizedMethod,ProtocolError} from "../src/index.js";

const ROLES=["authority","approver","operator","worker","adapter"] as const;

test("every registered method owns exact request and result parsers",()=>{
 for(const definition of METHOD_REGISTRY_V1){
  assert.equal(typeof definition.parseInput,"function",`${definition.method} input parser`);
  assert.equal(typeof definition.parseResult,"function",`${definition.method} result parser`);
  const request={schemaVersion:"1",requestType:definition.method};
  const result={schemaVersion:"1",resultType:definition.method};
  if(definition.inputMapping===null)assert.deepEqual(definition.parseInput(request),request);
  else assert.throws(()=>definition.parseInput(request),ProtocolError);
  if(definition.resultMapping===null)assert.deepEqual(definition.parseResult(result),result);
  else assert.throws(()=>definition.parseResult(result),ProtocolError);
  assert.throws(()=>definition.parseInput({...request,extra:true}),ProtocolError);
  assert.throws(()=>definition.parseResult({...result,extra:true}),ProtocolError);
  assert.throws(()=>definition.parseInput({...request,requestType:"other.v1"}),ProtocolError);
  assert.throws(()=>definition.parseResult({...result,resultType:"other.v1"}),ProtocolError);
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
