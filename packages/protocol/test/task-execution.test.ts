import assert from "node:assert/strict";
import test from "node:test";
import { methodDefinition, ProtocolError } from "../src/index.js";

test("explicit execution methods accept resolvable defaults and reject host or option injection",()=>{
  const requests = [
    ["task.dispatch.v1",{operationId:"dispatch",taskId:"task",adapterId:"pi",model:""}],
    ["task.breakdown.v1",{operationId:"breakdown",taskId:"task",adapterId:"codex",model:""}],
    ["task.adoptPlan.v1",{operationId:"adopt",taskId:"task",planDigest:"digest"}],
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
