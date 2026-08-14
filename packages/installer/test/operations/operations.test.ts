import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installNeutralBundleV1, installerSha256, neutralCatalogDigestV1, operateNeutralBundleV1, type InstallDaemonClientV1, type InstallHostIdV1, type NeutralInstallBundleV1 } from "../../src/index.js";

class Daemon implements InstallDaemonClientV1 {
  grants = new Map<string, string>();
  async ensureWorkspace() { return { workspaceId: "workspace:test", created: true }; }
  async ensureRunning() {}
  async provisionOpaqueCredential(input: { workspaceId: string; hostId: InstallHostIdV1 }) { const grantDigest = installerSha256(`${input.workspaceId}:${input.hostId}:${this.grants.size}`); this.grants.set(input.hostId, grantDigest); return { reference: `grant:${input.hostId}`, grantDigest }; }
  async revokeOpaqueCredential(input: { hostId: InstallHostIdV1 }) { this.grants.delete(input.hostId); }
  async status() { return { running: true, bootstrapped: true }; }
}

function bundle(version = "1.0.0", marker = "one", platform: NodeJS.Platform = process.platform): NeutralInstallBundleV1 {
  const contributions = (["pi", "omp", "claude", "codex"] as const).map((hostId) => {
    const bytes = Buffer.from(`export default ${JSON.stringify(`${marker}:${hostId}`)};\n`);
    const digest = installerSha256(bytes);
    const files = [{ path: "entry.mjs", kind: "plugin" as const, mode: 0o600, size: bytes.length, contentDigest: digest, archiveDigest: digest, memberDigest: digest, bytesBase64: bytes.toString("base64") }];
    return { hostId, pinnedHostVersion: "1.0.0", support: "supported" as const, platforms: [{ platform, arch: process.arch }], discoveryRootId: hostId, targetRelativePath: `plugins/${hostId}`, packageDigest: installerSha256(`entry.mjs:${digest}\n`), sourceArtifactDigest: installerSha256(bytes), files };
  });
  const base = { schema: "horseness.neutral-install-bundle.v1" as const, releaseVersion: version, releaseManifestDigest: installerSha256(`release:${version}:${marker}`), authenticatedManifestKeyId: "fixture-release-ed25519-v1", authenticatedManifestSequence: Number(version.split(".")[0]) + 1, contributions };
  return { ...base, catalogDigest: neutralCatalogDigestV1(base) };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "horseness-operations-"));
  const discoveryRoots = Object.fromEntries((["pi", "omp", "claude", "codex"] as const).map((hostId) => [hostId, join(root, hostId)])) as Record<InstallHostIdV1, string>;
  for (const path of Object.values(discoveryRoots)) await mkdir(path, { recursive: true, mode: 0o700 });
  const workspacePath = join(root, "workspace");
  await mkdir(workspacePath);
  return { root, discoveryRoots, workspacePath, daemon: new Daemon() };
}

function request(fixtureValue: Awaited<ReturnType<typeof fixture>>, release: NeutralInstallBundleV1, crash?: (point: string) => void) {
  return { bundle: release, roots: { stateRoot: join(fixtureValue.root, "state"), dataRoot: join(fixtureValue.root, "data"), discoveryRoots: fixtureValue.discoveryRoots }, scope: "user" as const, workspacePath: fixtureValue.workspacePath, createWorkspace: true, hosts: ["pi"] as const, acceptedReleaseDigest: release.releaseManifestDigest, daemon: fixtureValue.daemon, accountId: "account-test", authorityTime: () => "2026-08-14T00:00:00.000Z", ...(crash === undefined ? {} : { crash }) };
}

test("installs exact neutral bytes with markers and is idempotent", async () => {
  const f = await fixture(); const release = bundle(); const input = { ...request(f, release), hosts: "all" as const };
  assert.equal((await installNeutralBundleV1(input)).exitCode, 0);
  assert.equal((await installNeutralBundleV1(input)).exitCode, 0);
  for (const hostId of ["pi", "omp", "claude", "codex"] as const) assert.match(await readFile(join(f.discoveryRoots[hostId], "plugins", hostId, "entry.mjs"), "utf8"), /one/);
});

test("reports unsupported hosts as partial and never writes them", async () => {
  const f = await fixture(); const unsupported = bundle("1.0.0", "unsupported", "aix");
  const result = await installNeutralBundleV1({ ...request(f, unsupported), hosts: "all" });
  assert.equal(result.exitCode, 1); assert.ok(result.hosts.every((host) => host.detection === "unsupported"));
});

test("installer core rejects catalog substitution without trusting a bundle key", async () => {
  const f = await fixture(); const release = bundle(); const tampered = { ...release, contributions: release.contributions.map((entry, index) => index === 0 ? { ...entry, pinnedHostVersion: "9.9.9" } : entry) };
  await assert.rejects(() => installNeutralBundleV1(request(f, tampered)), /NEUTRAL_CATALOG_DIGEST_MISMATCH/);
});

test("upgrade, downgrade, rollback, retry, and compensation transition real generations", async () => {
  const f = await fixture(); const v1 = bundle("1.0.0", "one"); const v2 = bundle("2.0.0", "two");
  assert.equal((await installNeutralBundleV1(request(f, v1))).exitCode, 0);
  assert.equal((await operateNeutralBundleV1("upgrade", request(f, v2))).exitCode, 0);
  assert.match(await readFile(join(f.discoveryRoots.pi, "plugins/pi/entry.mjs"), "utf8"), /two/);
  assert.equal((await operateNeutralBundleV1("downgrade", request(f, v1))).exitCode, 0);
  assert.match(await readFile(join(f.discoveryRoots.pi, "plugins/pi/entry.mjs"), "utf8"), /one/);
  assert.equal((await operateNeutralBundleV1("rollback", request(f, v2))).exitCode, 0);
  assert.match(await readFile(join(f.discoveryRoots.pi, "plugins/pi/entry.mjs"), "utf8"), /two/);
  let injected = false;
  const v3 = bundle("3.0.0", "three");
  const crashed = await operateNeutralBundleV1("upgrade", request(f, v3, (point) => { if (!injected && point === "lifecycle-after-retain:pi") { injected = true; throw new Error("crash"); } }));
  assert.equal(crashed.exitCode, 1);
  assert.equal((await operateNeutralBundleV1("retry-install", request(f, v3))).exitCode, 0);
  assert.match(await readFile(join(f.discoveryRoots.pi, "plugins/pi/entry.mjs"), "utf8"), /three/);
  const v4 = bundle("4.0.0", "four");
  const compensated = await operateNeutralBundleV1("upgrade", request(f, v4, (point) => { if (point === "lifecycle-after-activate:pi") throw new Error("health-failure"); }));
  assert.equal(compensated.exitCode, 1);
  assert.match(await readFile(join(f.discoveryRoots.pi, "plugins/pi/entry.mjs"), "utf8"), /three/);
  const journal = await readFile(join(f.root, "state/journal/generation-1.jsonl"), "utf8");
  assert.match(journal, /migration-begun/); assert.match(journal, /backup-created/); assert.match(journal, /compensated/); assert.match(journal, /activated/);
});
