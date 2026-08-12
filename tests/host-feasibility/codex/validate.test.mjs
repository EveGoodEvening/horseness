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
const cache = resolve(tmpdir(), "horseness-codex-authenticated-cache");
async function invoke(file, mode = "hermetic", env = {}) { return invokeValidator({ executable, fixture: file, mode, env: { HORSENESS_HOST_CACHE: cache, HORSENESS_HOST_WORK_ROOT: resolve(tmpdir(), "horseness-codex-work"), ...env } }); }
async function copiedFixture() { const root = await mkdtemp(resolve(tmpdir(), "horseness-codex-test-")); await cp(dirname(fixture), root, { recursive: true }); return { root, manifestPath: resolve(root, "manifest.v1.json") }; }
async function mutateManifest(change) { const copy = await copiedFixture(); const manifest = JSON.parse(await readFile(copy.manifestPath, "utf8")); change(manifest); await writeFile(copy.manifestPath, JSON.stringify(manifest)); return copy; }

for (let run = 1; run <= 2; run += 1) test(`authenticated real Codex lifecycle is deterministic ${run}`, async () => {
  const { result } = await invoke(fixture);
  assert.equal(result.status, "pass"); assert.equal(result.reasonCode, "OK");
  assert.equal(result.nativeMinimumSatisfied, true); assert.equal(result.officialValidatorSatisfied, true);
  assert.deepEqual(Object.values(result.capabilities), Array(8).fill(true));
});

test("tampered archive identity fails closed", async () => { const copy = await mutateManifest(manifest => { manifest.artifact.archiveSha256 = `sha256:${"0".repeat(64)}`; }); try { const { result } = await invoke(copy.manifestPath); assert.equal(result.status, "fail"); assert.equal(result.reasonCode, "NATIVE_BINARY_TAMPERED"); } finally { await rm(copy.root, { recursive: true, force: true }); } });
test("repository path cannot replace real executable", async () => { const copy = await mutateManifest(manifest => { manifest.artifact.executable.path = "../../../../scripts/host-feasibility/codex/validate.mjs"; }); try { const { result } = await invoke(copy.manifestPath); assert.equal(result.status, "fail"); } finally { await rm(copy.root, { recursive: true, force: true }); } });

for (const target of [
  ["plugin", "marketplace/plugins/horseness-c11"],
  ["skill", "marketplace/plugins/horseness-c11/skills/horseness-c11/SKILL.md"],
  ["MCP", "marketplace/plugins/horseness-c11/.mcp.json"]
]) test(`missing ${target[0]} contribution fails`, async () => { const copy = await copiedFixture(); try { await rm(resolve(copy.root, target[1]), { recursive: true, force: true }); const { result } = await invoke(copy.manifestPath); assert.equal(result.status, "fail"); assert.equal(result.capabilities.nativeArtifactLoad, false); } finally { await rm(copy.root, { recursive: true, force: true }); } });

test("tampered official interface digest fails closed", async () => { const copy = await mutateManifest(manifest => { manifest.officialValidation.provenance.interfaceSha256 = `sha256:${"f".repeat(64)}`; }); try { const { result } = await invoke(copy.manifestPath); assert.equal(result.status, "fail"); assert.equal(result.reasonCode, "NATIVE_BINARY_TAMPERED"); } finally { await rm(copy.root, { recursive: true, force: true }); } });
test("optional live check skips without reading credentials", async () => { const { result } = await invoke(fixture, "live", { HORSENESS_CODEX_CREDENTIAL_REF: "" }); assert.equal(result.status, "skip"); assert.equal(result.reasonCode, "LIVE_CREDENTIAL_ABSENT"); });
