import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source = resolve("tests/fixtures/hosts/claude");
const validator = resolve("scripts/host-feasibility/claude/validate.mjs");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "horseness-claude-"));
  await cp(source, root, { recursive: true });
  return root;
}
function run(root, mode = "hermetic") {
  const result = spawnSync(process.execPath, [validator, "--fixture", join(root, "manifest.v1.json"), "--mode", mode], { encoding: "utf8" });
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  return { status: result.status, value: JSON.parse(lines[0]), stderr: result.stderr };
}
async function mutate(root, fn) {
  const path = join(root, "manifest.v1.json");
  const value = JSON.parse(await readFile(path, "utf8"));
  fn(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

for (const [name, change, reasonCode] of [
  ["missing binary", async (root) => rm(join(root, "native/claude.mjs")), "NATIVE_BINARY_MISSING"],
  ["tampered binary", async (root) => writeFile(join(root, "native/claude.mjs"), "tampered\n"), "NATIVE_BINARY_TAMPERED"],
  ["incompatible version", (root) => mutate(root, (value) => { value.native.version = "99.0.0"; }), "NATIVE_VERSION_INCOMPATIBLE"],
  ["missing official validator", async (root) => rm(join(root, "native/claude-plugin-validator.mjs")), "OFFICIAL_VALIDATOR_MISSING"],
  ["tampered official validator", (root) => mutate(root, (value) => { value.officialValidator.distributionDigest = `sha256:${"0".repeat(64)}`; }), "OFFICIAL_VALIDATOR_TAMPERED"],
  ["CLI-only fallback", (root) => mutate(root, (value) => { value.native.mode = "cli"; }), "FIXTURE_INVALID"],
  ["missing capability", (root) => mutate(root, (value) => { value.capabilities.supported = value.capabilities.supported.filter((item) => item !== "resume"); }), "REQUIRED_CAPABILITY_MISSING"],
  ["invalid resume matrix", (root) => mutate(root, (value) => { delete value.resume.sessionResume; }), "REQUIRED_CAPABILITY_MISSING"],
  ["receipt substitution", async (root) => { const path = join(root, "provider/response.json"); const value = JSON.parse(await readFile(path, "utf8")); value.receiptBindingDigest = `sha256:${"1".repeat(64)}`; await writeFile(path, JSON.stringify(value)); }, "EVIDENCE_MISMATCH"]
]) test(`fails closed: ${name}`, async () => {
  const root = await fixture();
  try { await change(root); const result = run(root); assert.equal(result.status, 1); assert.equal(result.value.status, "fail"); assert.equal(result.value.reasonCode, reasonCode); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("passes deterministic native Claude feasibility and is byte-stable", async () => {
  const root = await fixture();
  try {
    const first = run(root); const second = run(root);
    assert.equal(first.status, 0); assert.equal(first.value.status, "pass"); assert.equal(first.value.reasonCode, "OK");
    assert.equal(first.value.nativeMinimumSatisfied, true); assert.equal(first.value.officialValidatorSatisfied, true);
    assert.deepEqual(first.value, second.value);
    assert.equal(first.value.capabilities.resume, true); assert.equal(first.value.capabilities.uninstall, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("live mode skips only when the opaque credential reference is absent", async () => {
  const root = await fixture();
  try { const result = run(root, "live"); assert.equal(result.status, 0); assert.equal(result.value.status, "skip"); assert.equal(result.value.reasonCode, "LIVE_CREDENTIAL_ABSENT"); }
  finally { await rm(root, { recursive: true, force: true }); }
});
