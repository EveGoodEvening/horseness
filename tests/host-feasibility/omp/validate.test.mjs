import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

const source = resolve("tests/fixtures/hosts/omp");
const validator = resolve("scripts/host-feasibility/omp/validate.mjs");
function execute(manifest, mode = "hermetic", env = {}) {
  const run = spawnSync(process.execPath, [validator, "--fixture", manifest, "--mode", mode], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  const lines = run.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, run.stderr);
  return { run, result: JSON.parse(lines[0]) };
}
async function fixture(mutator) {
  const root = await mkdtemp(resolve(tmpdir(), "omp-fixture-test-"));
  await cp(source, root, { recursive: true });
  const manifestPath = resolve(root, "manifest.v1.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await mutator({ root, manifest });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifestPath };
}
async function negative(name, expected, mutator) {
  await test(name, async () => {
    const { root, manifestPath } = await fixture(mutator);
    try {
      const { run, result } = execute(manifestPath);
      assert.notEqual(run.status, 0);
      assert.equal(result.status, "fail");
      assert.equal(result.reasonCode, expected);
      assert.equal(result.schemaVersion, "HostValidationResultV1");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("OMP native feasibility passes hermetically and deterministically", () => {
  const first = execute(resolve(source, "manifest.v1.json"));
  const second = execute(resolve(source, "manifest.v1.json"));
  assert.equal(first.run.status, 0);
  assert.deepEqual(first.result, second.result);
  assert.equal(first.result.status, "pass");
  assert.equal(first.result.reasonCode, "OK");
  assert.equal(first.result.nativeMinimumSatisfied, true);
  assert.equal(first.result.officialValidatorSatisfied, true);
  assert.ok(Object.values(first.result.capabilities).every(Boolean));
});

await negative("missing native binary fails closed", "NATIVE_BINARY_MISSING", async ({ root }) => rm(resolve(root, "native/omp.mjs")));
await negative("tampered native binary fails closed", "NATIVE_BINARY_TAMPERED", async ({ root }) => writeFile(resolve(root, "native/omp.mjs"), "tampered"));
await negative("incompatible native version fails closed", "NATIVE_VERSION_INCOMPATIBLE", async ({ manifest }) => { manifest.native.version = "99.0.0"; });
await negative("missing official validator fails closed", "OFFICIAL_VALIDATOR_MISSING", async ({ root }) => rm(resolve(root, "native/validator.mjs")));
await negative("tampered official validator fails closed", "OFFICIAL_VALIDATOR_TAMPERED", async ({ root }) => writeFile(resolve(root, "native/validator.mjs"), "tampered"));
await negative("CLI-only fallback fails closed", "FIXTURE_INVALID", async ({ manifest }) => { manifest.native.mode = "cli"; });
await negative("missing required capability fails closed", "REQUIRED_CAPABILITY_MISSING", async ({ manifest }) => { manifest.capabilities.supported = manifest.capabilities.supported.filter((item) => item !== "resume"); });
await negative("resume mismatch fails closed", "EVIDENCE_MISMATCH", async ({ manifest }) => { manifest.resume.forkSwitch = "resume-existing-binding"; });

test("live mode skips only for an absent opaque credential reference", () => {
  const { run, result } = execute(resolve(source, "manifest.v1.json"), "live");
  assert.equal(run.status, 0);
  assert.equal(result.status, "skip");
  assert.equal(result.reasonCode, "LIVE_CREDENTIAL_ABSENT");
});
