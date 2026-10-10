import assert from "node:assert/strict";
import test from "node:test";
import { methodDefinition, ProtocolError } from "../src/index.js";

test("explicit execution methods accept resolvable defaults and reject host or option injection",()=>{
  const requests = [
    ["task.dispatch.v1",{operationId:"dispatch",taskId:"task",adapterId:"pi",model:""}],
    ["task.breakdown.v1",{operationId:"breakdown",taskId:"task",adapterId:"codex",model:""}],
    ["task.adoptPlan.v1",{operationId:"adopt",taskId:"task",planDigest:"digest"}],
    ["task.revisePlan.v1",{operationId:"revise",taskId:"task",basePlanDigest:"digest",plan:{tasks:[{key:"a",title:"A",instructions:"Build A",acceptanceCriteria:["A works"],dependsOn:[]}]}}],
    ["task.execute.v1",{operationId:"execute",taskId:"task",adapterId:"omp",model:"",plannerAdapterId:"claude",plannerModel:"",autoPlan:false}],
  ] as const;
  for(const [method,value] of requests){
    const definition=methodDefinition(method)!;
    assert.equal(definition.kind,"command");
    assert.equal(definition.cursor,"composite");
    assert.equal(definition.idempotency,"required");
    assert.deepEqual(definition.roles,["authority","operator"]);
    const input={schemaVersion:"1",requestType:method,value};
    assert.deepEqual(definition.parseInput(input),input);
    assert.throws(()=>definition.parseInput({...input,value:{...value,executablePath:"/untrusted"}}),ProtocolError);
    if("adapterId" in value)assert.throws(()=>definition.parseInput({...input,value:{...value,adapterId:"unknown"}}),ProtocolError);
  }
});
test("execute does not coerce opt-in automatic planning and requires the complete recoverable request",()=>{
  const definition=methodDefinition("task.execute.v1")!;
  const value={operationId:"execute",taskId:"task",adapterId:"pi",model:"model",plannerAdapterId:"pi",plannerModel:"",autoPlan:true};
  assert.throws(()=>definition.parseInput({schemaVersion:"1",requestType:"task.execute.v1",value:{...value,autoPlan:"true"}}),ProtocolError);
  const {plannerModel:_,...incomplete}=value;
  assert.throws(()=>definition.parseInput({schemaVersion:"1",requestType:"task.execute.v1",value:incomplete}),ProtocolError);
});
test("effort is optional without identity mutation and validates each supplied enum",()=>{
  for(const method of ["task.dispatch.v1","task.breakdown.v1","task.execute.v1"] as const){
    const definition=methodDefinition(method)!;
    const value={operationId:"operation",taskId:"task",adapterId:"pi",model:"",...(method==="task.execute.v1"?{plannerAdapterId:"pi",plannerModel:"",autoPlan:true}:{})};
    const input={schemaVersion:"1",requestType:method,value};
    assert.deepEqual(definition.parseInput(input),input);
    for(const field of method==="task.execute.v1"?["effort","plannerEffort"]:["effort"]){
      for(const effort of ["low","medium","high"]){
        const explicit={...input,value:{...value,[field]:effort}};
        assert.deepEqual(definition.parseInput(explicit),explicit);
      }
      for(const effort of [undefined,null,"","HIGH","max",0,true,[],{}])assert.throws(()=>definition.parseInput({...input,value:{...value,[field]:effort}}),ProtocolError);
    }
    assert.throws(()=>definition.parseInput({...input,value:{...value,effort:"medium",unknown:true}}),ProtocolError);
  }
});
