import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { invokeValidator } from "../../../scripts/host-feasibility/lib/runner.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const executable = resolve(repositoryRoot, "scripts/host-feasibility/codex/validate.mjs");
const fixture = resolve(repositoryRoot, "tests/fixtures/hosts/codex/manifest.v1.json");

async function invoke(file, mode = "hermetic", env = {}) {
  return invokeValidator({ executable, fixture: file, mode, env });
}
async function copiedFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "horseness-codex-test-"));
  await cp(dirname(fixture), root, { recursive: true });
  return { root, manifestPath: resolve(root, "manifest.v1.json") };
}
async function mutateManifest(change) {
  const copy = await copiedFixture();
  const manifest = JSON.parse(await readFile(copy.manifestPath, "utf8"));
  change(manifest, copy.root);
  await writeFile(copy.manifestPath, JSON.stringify(manifest));
  return copy;
}

for (let run = 0; run < 2; run += 1) {
  test(`positive hermetic Codex native feasibility is deterministic ${run + 1}`, async () => {
    const { result } = await invoke(fixture);
    assert.equal(result.status, "pass");
    assert.equal(result.reasonCode, "OK");
    assert.equal(result.nativeMinimumSatisfied, true);
    assert.equal(result.officialValidatorSatisfied, true);
    assert.deepEqual(Object.values(result.capabilities), Array(8).fill(true));
    if (run === 1) {
      const previous = (await invoke(fixture)).result;
      assert.equal(result.evidenceDigest, previous.evidenceDigest);
    }
  });
}

test("CLI-only fallback fails closed", async () => {
  const copy = await mutateManifest((manifest) => { manifest.native.mode = "cli"; });
  try {
    const { result } = await invoke(copy.manifestPath);
    assert.equal(result.status, "fail");
    assert.equal(result.reasonCode, "CLI_ONLY_FALLBACK");
  } finally { await rm(copy.root, { recursive: true, force: true }); }
});

for (const contribution of ["plugin", "skill", "mcp"]) {
  test(`absent native ${contribution} contribution fails`, async () => {
    const copy = await copiedFixture();
    try {
      const nativePath = resolve(copy.root, "native/codex.mjs");
      const source = await readFile(nativePath, "utf8");
      await writeFile(nativePath, source.replace(`${contribution}: \"horseness${contribution === "skill" ? "-reconcile" : ""}\"`, `${contribution}: null`));
      const manifest = JSON.parse(await readFile(copy.manifestPath, "utf8"));
      const bytes = await readFile(nativePath);
      const { createHash } = await import("node:crypto");
      manifest.native.distributionDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      await writeFile(copy.manifestPath, JSON.stringify(manifest));
      const { result } = await invoke(copy.manifestPath);
      assert.equal(result.status, "fail");
      assert.equal(result.reasonCode, "OFFICIAL_VALIDATOR_FAILED");
      assert.equal(result.capabilities.nativeArtifactLoad, false);
    } finally { await rm(copy.root, { recursive: true, force: true }); }
  });
}

test("missing native binary fails closed", async () => {
  const copy = await mutateManifest((manifest) => { manifest.native.binary = "native/absent.mjs"; });
  try {
    const { result } = await invoke(copy.manifestPath);
    assert.equal(result.reasonCode, "NATIVE_BINARY_MISSING");
  } finally { await rm(copy.root, { recursive: true, force: true }); }
});

test("tampered official validator fails closed", async () => {
  const copy = await copiedFixture();
  try {
    await writeFile(resolve(copy.root, "native/validator.mjs"), "process.exit(0);\n");
    const { result } = await invoke(copy.manifestPath);
    assert.equal(result.reasonCode, "OFFICIAL_VALIDATOR_TAMPERED");
  } finally { await rm(copy.root, { recursive: true, force: true }); }
});

test("optional live check skips without reading credentials", async () => {
  const { result } = await invoke(fixture, "live", { HORSENESS_CODEX_CREDENTIAL_REF: "" });
  assert.equal(result.status, "skip");
  assert.equal(result.reasonCode, "LIVE_CREDENTIAL_ABSENT");
});
