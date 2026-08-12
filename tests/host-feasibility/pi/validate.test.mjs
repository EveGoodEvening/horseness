import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const validator = resolve("scripts/host-feasibility/pi/validate.mjs");
const source = resolve("tests/fixtures/hosts/pi");

function run(fixture) {
  const result = spawnSync(process.execPath, [validator, "--fixture", fixture, "--mode", "hermetic"], {encoding:"utf8"});
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, result.stderr);
  return {code:result.status, value:JSON.parse(lines[0])};
}
async function fixture(change) {
  const root = await mkdtemp(join(tmpdir(), "horseness-pi-"));
  await cp(source, root, {recursive:true});
  const manifestPath = join(root, "manifest.v1.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await change({root, manifest});
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {root, manifestPath};
}

test("positive hermetic Pi native fixture passes deterministically", () => {
  const first = run(join(source, "manifest.v1.json"));
  const second = run(join(source, "manifest.v1.json"));
  assert.equal(first.code, 0);
  assert.deepEqual(first.value, second.value);
  assert.equal(first.value.status, "pass");
  assert.equal(first.value.reasonCode, "OK");
  assert.equal(first.value.nativeMinimumSatisfied, true);
  assert.equal(first.value.officialValidatorSatisfied, true);
  assert.ok(Object.values(first.value.capabilities).every(Boolean));
});

test("missing native binary fails closed", async (t) => {
  const value = await fixture(async ({root}) => rm(join(root, "artifacts/pi-native.mjs")));
  t.after(() => rm(value.root, {recursive:true, force:true}));
  const result = run(value.manifestPath);
  assert.equal(result.code, 1);
  assert.equal(result.value.reasonCode, "NATIVE_BINARY_MISSING");
});

test("tampered native binary fails closed", async (t) => {
  const value = await fixture(async ({root}) => writeFile(join(root, "artifacts/pi-native.mjs"), "tampered\n", {mode:0o755}));
  t.after(() => rm(value.root, {recursive:true, force:true}));
  const result = run(value.manifestPath);
  assert.equal(result.code, 1);
  assert.equal(result.value.reasonCode, "NATIVE_BINARY_TAMPERED");
});

test("missing official validator fails closed", async (t) => {
  const value = await fixture(async ({root}) => rm(join(root, "artifacts/pi-official-validator.mjs")));
  t.after(() => rm(value.root, {recursive:true, force:true}));
  const result = run(value.manifestPath);
  assert.equal(result.code, 1);
  assert.equal(result.value.reasonCode, "OFFICIAL_VALIDATOR_MISSING");
  assert.equal(result.value.nativeMinimumSatisfied, true);
  assert.equal(result.value.officialValidatorSatisfied, false);
});

test("incompatible Pi version fails closed", async (t) => {
  const value = await fixture(async ({manifest}) => { manifest.native.version = "0.72.0"; });
  t.after(() => rm(value.root, {recursive:true, force:true}));
  const result = run(value.manifestPath);
  assert.equal(result.code, 1);
  assert.equal(result.value.reasonCode, "NATIVE_VERSION_INCOMPATIBLE");
});

test("CLI-only fallback cannot satisfy native minimum", async (t) => {
  const value = await fixture(async ({root, manifest}) => {
    const path = join(root, "artifacts/pi-native.mjs");
    await writeFile(path, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({package:'@mariozechner/pi-coding-agent',version:'0.73.1',native:false,cliFallback:true})+'\\n');\n", {mode:0o755});
    const {createHash} = await import("node:crypto");
    manifest.native.distributionDigest = `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
  });
  t.after(() => rm(value.root, {recursive:true, force:true}));
  const result = run(value.manifestPath);
  assert.equal(result.code, 1);
  assert.equal(result.value.reasonCode, "CLI_ONLY_FALLBACK");
  assert.equal(result.value.nativeMinimumSatisfied, false);
});

test("missing required native capability fails closed", async (t) => {
  const value = await fixture(async ({manifest}) => { manifest.capabilities.supported = manifest.capabilities.supported.filter((item) => item !== "resume"); });
  t.after(() => rm(value.root, {recursive:true, force:true}));
  const result = run(value.manifestPath);
  assert.equal(result.code, 1);
  assert.equal(result.value.reasonCode, "REQUIRED_CAPABILITY_MISSING");
});

test("substituted deterministic-provider receipt fails closed", async (t) => {
  const value = await fixture(async ({root}) => {
    const path = join(root, "provider-response.json");
    const response = JSON.parse(await readFile(path, "utf8"));
    response.attemptId = "substituted-attempt";
    await writeFile(path, `${JSON.stringify(response)}\n`);
  });
  t.after(() => rm(value.root, {recursive:true, force:true}));
  const result = run(value.manifestPath);
  assert.equal(result.code, 1);
  assert.equal(result.value.reasonCode, "EVIDENCE_MISMATCH");
});
