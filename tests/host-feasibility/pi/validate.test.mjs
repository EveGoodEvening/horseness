import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const validator = resolve("scripts/host-feasibility/pi/validate.mjs");
const source = resolve("tests/fixtures/hosts/pi");
function run(fixture, env={}) { const result=spawnSync(process.execPath,[validator,"--fixture",fixture,"--mode","hermetic"],{encoding:"utf8",env:{...process.env,...env}}); return {code:result.status,value:JSON.parse(result.stdout.trim())}; }
async function fixture(change) { const root=await mkdtemp(join(tmpdir(),"horseness-pi-")); await cp(source,root,{recursive:true}); const path=join(root,"manifest.v1.json"); const manifest=JSON.parse(await readFile(path,"utf8")); await change({root,manifest}); await writeFile(path,`${JSON.stringify(manifest,null,2)}\n`); return {root,path}; }

test("real Pi distribution and official extension interface pass deterministically",()=>{ const a=run(join(source,"manifest.v1.json")); const b=run(join(source,"manifest.v1.json")); assert.equal(a.code,0); assert.deepEqual(a.value,b.value); assert.equal(a.value.nativeMinimumSatisfied,true); assert.equal(a.value.officialValidatorSatisfied,true); assert.ok(Object.values(a.value.capabilities).every(Boolean)); });
test("offline validated cache passes",()=>{ const first=run(join(source,"manifest.v1.json")); assert.equal(first.code,0); const second=run(join(source,"manifest.v1.json"),{HORSENESS_NETWORK:"disabled"}); assert.equal(second.code,0); assert.deepEqual(first.value,second.value); });
test("tampered archive provenance fails closed",async t=>{ const x=await fixture(({manifest})=>manifest.artifact.archiveSha256="sha256:"+"0".repeat(64)); t.after(()=>rm(x.root,{recursive:true,force:true})); const r=run(x.path,{HORSENESS_HOST_CACHE:join(x.root,"cache")}); assert.equal(r.code,1); assert.equal(r.value.reasonCode,"NATIVE_BINARY_TAMPERED"); });
test("tampered executable member fails closed",async t=>{ const x=await fixture(({manifest})=>manifest.artifact.executable.sha256="sha256:"+"0".repeat(64)); t.after(()=>rm(x.root,{recursive:true,force:true})); const r=run(x.path,{HORSENESS_HOST_CACHE:join(x.root,"cache")}); assert.equal(r.code,1); assert.equal(r.value.reasonCode,"NATIVE_BINARY_TAMPERED"); });
test("tampered official interface member fails closed",async t=>{ const x=await fixture(({manifest})=>manifest.officialValidation.provenance.interfaceSha256="sha256:"+"0".repeat(64)); t.after(()=>rm(x.root,{recursive:true,force:true})); const r=run(x.path); assert.equal(r.code,1); assert.equal(r.value.reasonCode,"NATIVE_BINARY_TAMPERED"); });
test("CLI-only substitution cannot satisfy native minimum",async t=>{ const x=await fixture(({manifest})=>{manifest.artifact.identity="npm:fake-cli-only@0.73.1"; manifest.artifact.cacheKey="fake-cli-only-0.73.1";}); t.after(()=>rm(x.root,{recursive:true,force:true})); const r=run(x.path,{HORSENESS_HOST_CACHE:join(x.root,"cache")}); assert.equal(r.code,1); assert.equal(r.value.nativeMinimumSatisfied,false); });
test("local fixture is never accepted as host executable provenance",async t=>{ const x=await fixture(({manifest})=>{manifest.artifact.executable.path="extension.mjs"; manifest.artifact.executable.sha256="sha256:"+"0".repeat(64);}); t.after(()=>rm(x.root,{recursive:true,force:true})); const r=run(x.path,{HORSENESS_HOST_CACHE:join(x.root,"cache")}); assert.equal(r.code,1); assert.equal(r.value.nativeMinimumSatisfied,false); });
