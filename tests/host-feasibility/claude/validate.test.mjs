import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceManifest = resolve("tests/fixtures/hosts/claude/manifest.v1.json");
const validator = resolve("scripts/host-feasibility/claude/validate.mjs");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "horseness-claude-test-"));
  const manifest = JSON.parse(await readFile(sourceManifest, "utf8"));
  await writeFile(join(root, "manifest.v1.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(resolve("tests/fixtures/hosts/claude/plugin"), join(root, "plugin"), { recursive: true });
  return root;
}

function run(root, mode = "hermetic", env = {}) {
  const result = spawnSync(process.execPath, [validator, "--fixture", join(root, "manifest.v1.json"), "--mode", mode], {
    encoding: "utf8", env: { ...process.env, HORSENESS_HOST_CACHE: resolve(".cache/horseness/hosts"), ...env }, timeout: 120_000
  });
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, result.stderr);
  return { status: result.status, value: JSON.parse(lines[0]) };
}

test("credential-free hermetic gate passes on nativeArtifactLoad + officialValidatorSatisfied; 7 credential-gated capabilities deferred to C17", async () => {
  const root = await fixture();
  try {
    const result = run(root);
    assert.equal(result.status, 0);
    assert.equal(result.value.status, "pass");
    assert.equal(result.value.reasonCode, "OK");
    assert.equal(result.value.nativeMinimumSatisfied, true);
    assert.equal(result.value.officialValidatorSatisfied, true);
    assert.deepEqual(result.value.capabilities, {
      nativeArtifactLoad: true,
      contextInjection: false,
      deterministicProviderAttempt: false,
      receiptBinding: false,
      restartReconcile: false,
      resume: false,
      forkSwitch: false,
      uninstall: false
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fails closed when the upstream archive pin is changed", async () => {
  const root = await fixture();
  try {
    const path = join(root, "manifest.v1.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.artifact.archiveSha256 = `sha256:${"0".repeat(64)}`;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.equal(result.value.status, "fail");
    assert.equal(result.value.nativeMinimumSatisfied, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("live mode skips only when the opaque credential reference is absent", async () => {
  const root = await fixture();
  try {
    const result = run(root, "live", { HORSENESS_CLAUDE_CREDENTIAL_REF: "" });
    assert.equal(result.status, 0);
    assert.equal(result.value.status, "skip");
    assert.equal(result.value.reasonCode, "LIVE_CREDENTIAL_ABSENT");
  } finally { await rm(root, { recursive: true, force: true }); }
});
