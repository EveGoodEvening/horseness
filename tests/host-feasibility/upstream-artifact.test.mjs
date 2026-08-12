import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertOfficialValidation, assertUpstreamArtifact, acquireUpstreamArtifact } from "../../scripts/host-feasibility/lib/upstream-artifact.mjs";
import { runSandboxLifecycle, LIFECYCLE } from "../../scripts/host-feasibility/lib/sandbox.mjs";

const bytes = Buffer.from("upstream archive bytes");
const member = Buffer.from("real upstream executable");
const pin = { identity:"npm:@upstream/host@1.2.3",version:"1.2.3",registryUrl:"https://registry.example/",packageIntegrity:`sha512-${createHash("sha512").update(bytes).digest("base64")}`,archiveSha256:`sha256:${createHash("sha256").update(bytes).digest("hex")}`,cacheKey:"upstream-host-1.2.3",executable:{path:"bin/host",sha256:`sha256:${createHash("sha256").update(member).digest("hex")}`} };

test("artifact identity cannot be replaced by coordinated manifest and matrix theater",()=>{
  const local={...pin,identity:"file:tests/fixtures/hosts/native.mjs"};
  assert.throws(()=>assertUpstreamArtifact(local),/canonical identity/);
  assert.throws(()=>assertOfficialValidation({kind:"same-distribution-interface",provenance:{artifactIdentity:local.identity,interfacePath:"native.mjs",interfaceSha256:pin.executable.sha256},command:["native.mjs"]}),/distribution identity/);
});

test("artifact contract rejects path traversal and unpinned provenance",()=>{
  assert.throws(()=>assertUpstreamArtifact({...pin,executable:{...pin.executable,path:"../host"}}),/unsafe member path/);
  assert.throws(()=>assertUpstreamArtifact({...pin,packageIntegrity:"sha512-not-integrity"}),/package integrity/);
  assert.throws(()=>assertOfficialValidation({kind:"separate-ish",provenance:pin,command:["validate"]}),/invalid kind/);
});

test("acquisition independently rejects registry, archive, and member tamper",async()=>{
  const root=await mkdtemp(join(tmpdir(),"horseness-acquire-"));
  try {
    const metadata=(integrity=pin.packageIntegrity)=>new Response(JSON.stringify({dist:{integrity,tarball:"https://registry.example/pkg.tgz"}}));
    await assert.rejects(acquireUpstreamArtifact(pin,{cacheRoot:root,fetchImpl:async url=>String(url).endsWith("pkg.tgz")?new Response(Buffer.from("tampered")):metadata()}),/archive sha256 mismatch/);
    await assert.rejects(acquireUpstreamArtifact(pin,{cacheRoot:root,fetchImpl:async()=>metadata("sha512-bad")}),/registry provenance mismatch/);
    const leaf=join(root,pin.cacheKey); await mkdir(join(leaf,"package/bin"),{recursive:true}); await writeFile(join(leaf,"package/bin/host"),"tampered"); await writeFile(join(leaf,"READY.json"),JSON.stringify({identity:pin.identity,archiveSha256:pin.archiveSha256,executableSha256:pin.executable.sha256}));
    await assert.rejects(acquireUpstreamArtifact(pin,{cacheRoot:root,fetchImpl:async()=>{throw new Error("member tamper must be rejected before reuse")}}),/artifact member sha256 mismatch|member tamper/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("cache path symlinks fail closed",async()=>{
  const root=await mkdtemp(join(tmpdir(),"horseness-symlink-")); const outside=await mkdtemp(join(tmpdir(),"horseness-outside-"));
  try { await symlink(outside,join(root,pin.cacheKey)); await assert.rejects(acquireUpstreamArtifact(pin,{cacheRoot:root,fetchImpl:async()=>{throw new Error("network must not run")}}),/symlink/); }
  finally { await rm(root,{recursive:true,force:true}); await rm(outside,{recursive:true,force:true}); }
});

test("sandbox derives capabilities from observations and rejects fixture impersonation/extra output",async()=>{
  const base=await mkdtemp(join(tmpdir(),"horseness-sandbox-"));
  const manifest={host:"pi",artifact:pin,requiredCapabilities:["nativeArtifactLoad"],sandbox:{workRoot:"run",allowedOutputs:[]}};
  const operations=Object.fromEntries(LIFECYCLE.slice(0,-1).map(phase=>[phase,async()=>({ok:true,observedCapabilities:phase==="load"?["nativeArtifactLoad"]:[]})]));
  try {
    const good=await runSandboxLifecycle({manifest,root:join(base,"good"),operations}); assert.equal(good.capabilities.nativeArtifactLoad,true);
    await assert.rejects(runSandboxLifecycle({manifest,root:join(base,"fake"),operations:{...operations,load:async()=>({ok:true,sourcePath:"tests/fixtures/hosts/pi/native/pi.mjs",observedCapabilities:["nativeArtifactLoad"]})}}),/impersonation/);
    await assert.rejects(runSandboxLifecycle({manifest,root:join(base,"extra"),operations:{...operations,uninstall:async({root})=>{await writeFile(join(root,"unexpected"),"x");return {ok:true}}}}),/unexpected output/);
  } finally { await rm(base,{recursive:true,force:true}); }
});
