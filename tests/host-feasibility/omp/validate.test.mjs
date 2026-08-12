import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const source = resolve("tests/fixtures/hosts/omp");
const validator = resolve("scripts/host-feasibility/omp/validate.mjs");
function execute(manifest, mode = "hermetic", env = {}) {
  const cache = env.HORSENESS_HOST_CACHE ?? resolve(".cache/horseness/hosts");
  const run = spawnSync(process.execPath, [validator, "--fixture", manifest, "--mode", mode], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", HORSENESS_HOST_CACHE: cache, ...env } });
  const lines = run.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, run.stderr);
  return { run, result: JSON.parse(lines[0]) };
}
async function fixture(mutator) {
  const root = await mkdtemp(join(tmpdir(), "omp-fixture-test-"));
  await cp(source, root, { recursive: true });
  const manifestPath = join(root, "manifest.v1.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await mutator({ root, manifest });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, manifestPath };
}
async function negative(name, expected, mutator, env = {}) {
  await test(name, async () => {
    const { root, manifestPath } = await fixture(mutator);
    try {
      const { run, result } = execute(manifestPath, "hermetic", env);
      assert.notEqual(run.status, 0);
      assert.equal(result.status, "fail");
      assert.equal(result.reasonCode, expected);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("OMP real npm distribution and native extension interface pass deterministically", () => {
  const manifest = resolve(source, "manifest.v1.json");
  const first = execute(manifest);
  const second = execute(manifest);
  assert.equal(first.run.status, 0);
  assert.deepEqual(first.result, second.result);
  assert.equal(first.result.status, "pass");
  assert.equal(first.result.nativeMinimumSatisfied, true);
  assert.equal(first.result.officialValidatorSatisfied, true);
  assert.ok(Object.values(first.result.capabilities).every(Boolean));
});

await negative("tampered archive pin fails closed", "ARCHIVE_TAMPERED", async ({ manifest }) => { manifest.artifact.archiveSha256 = `sha256:${"0".repeat(64)}`; }, { HORSENESS_HOST_CACHE: resolve(tmpdir(), `omp-bad-archive-${process.pid}`) });
await negative("tampered executable pin fails closed", "ARTIFACT_MEMBER_TAMPERED", async ({ manifest }) => { manifest.artifact.executable.sha256 = `sha256:${"0".repeat(64)}`; }, { HORSENESS_HOST_CACHE: resolve(tmpdir(), `omp-bad-member-${process.pid}`) });
await negative("substituted registry integrity fails closed", "UPSTREAM_PROVENANCE_MISMATCH", async ({ manifest }) => { manifest.artifact.packageIntegrity = `sha512-${Buffer.alloc(64).toString("base64")}`; }, { HORSENESS_HOST_CACHE: resolve(tmpdir(), `omp-bad-sri-${process.pid}`) });
await negative("tampered official interface pin fails closed", "ARTIFACT_MEMBER_TAMPERED", async ({ manifest }) => { manifest.officialValidation.provenance.interfaceSha256 = `sha256:${"0".repeat(64)}`; });
await negative("incompatible OMP version fails closed", "SANDBOX_PROTOCOL_FAILED", async ({ manifest }) => { manifest.artifact.version = "99.0.0"; manifest.artifact.identity = "npm:@oh-my-pi/pi-coding-agent@99.0.0"; manifest.officialValidation.provenance.artifactIdentity = manifest.artifact.identity; });
await negative("missing observed capability fails closed before execution", "FIXTURE_INVALID", async ({ manifest }) => { manifest.requiredCapabilities.push("fabricatedCapability"); });
await negative("repository host impersonator is rejected", "SANDBOX_PROTOCOL_FAILED", async ({ manifest }) => { manifest.officialValidation.provenance.interfacePath = "tests/fixtures/hosts/omp/native/validator.mjs"; });

test("live mode skips only for absent opaque credential reference", () => {
  const { run, result } = execute(resolve(source, "manifest.v1.json"), "live");
  assert.equal(run.status, 0);
  assert.equal(result.status, "skip");
  assert.equal(result.reasonCode, "LIVE_CREDENTIAL_ABSENT");
});

test("concurrent OMP validation passes despite shared schema/cache contention", async () => {
  const manifest = resolve(source, "manifest.v1.json");
  const cache = resolve(tmpdir(), `omp-concurrent-cache-${process.pid}-${Date.now()}`);
  const work = resolve(tmpdir(), `omp-concurrent-work-${process.pid}-${Date.now()}`);
  const sandbox = resolve(tmpdir(), `omp-concurrent-sandbox-${process.pid}-${Date.now()}`);
  const concurrency = 3;
  const children = [];
  for (let i = 0; i < concurrency; i++) {
    children.push(new Promise((resolvePromise, reject) => {
      const child = spawnSync(process.execPath, [validator, "--fixture", manifest, "--mode", "hermetic"], {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", HORSENESS_HOST_CACHE: cache, HORSENESS_HOST_WORK_ROOT: work, HORSENESS_HOST_SANDBOX: sandbox },
      });
      try {
        const lines = child.stdout.trim().split("\n").filter(Boolean);
        assert.equal(lines.length, 1, child.stderr);
        const result = JSON.parse(lines[0]);
        assert.equal(result.status, "pass", `child ${i} failed: ${JSON.stringify(result)}`);
        assert.equal(result.reasonCode, "OK");
        assert.equal(Object.values(result.capabilities).every(Boolean), true);
        resolvePromise();
      } catch (error) { reject(error); }
    }));
  }
  await Promise.all(children);
  await rm(cache, { recursive: true, force: true }).catch(() => {});
  await rm(work, { recursive: true, force: true }).catch(() => {});
  await rm(sandbox, { recursive: true, force: true }).catch(() => {});
});
