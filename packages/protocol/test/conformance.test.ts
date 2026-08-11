import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import type {SpawnSyncReturns} from "node:child_process";
import {resolve} from "node:path";
import test from "node:test";

const packageRoot=resolve(import.meta.dirname,"..");
function run(script:string,...arguments_:string[]):SpawnSyncReturns<string>{return spawnSync(process.execPath,["--import","tsx",resolve(packageRoot,script),...arguments_],{cwd:packageRoot,encoding:"utf8"});}

test("executable protocol conformance covers every method and named mapping",()=>{
 const result=run("bin/conformance.ts");
 assert.equal(result.status,0,String(result.stderr||result.stdout));
 assert.match(String(result.stdout),/protocol conformance: \d+ checks, \d+ methods, \d+ named mappings/);
});

test("generated Draft 2020-12 schemas are canonical and current",()=>{
 const result=run("bin/generate.ts","--check");
 assert.equal(result.status,0,String(result.stderr||result.stdout));
});

test("generated mapping schemas are closed and contain no semantic extension placeholders",()=>{
 for(const name of ["domain-mappings-v1.schema.json","method-dtos-v1.schema.json","json-rpc-v1.schema.json","json-rpc-response-v1.schema.json","coordinator-body-v1.schema.json"]){
  const contents=String(spawnSync(process.execPath,["-e",`process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(resolve(packageRoot,"generated",name))},'utf8'))`],{encoding:"utf8"}).stdout);
  const schema=JSON.parse(contents) as {"$schema"?:unknown;oneOf?:unknown[]};
  assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
  assert.ok(Array.isArray(schema.oneOf)&&schema.oneOf.length>0,`${name}: missing closed alternatives`);
  assert.doesNotMatch(contents,/x-horseness-domain-mapping|x-semantic|placeholder/i);
 }
});
