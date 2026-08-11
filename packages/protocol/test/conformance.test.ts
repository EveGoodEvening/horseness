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
