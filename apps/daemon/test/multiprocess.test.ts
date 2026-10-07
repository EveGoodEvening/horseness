import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Daemon, discoverDaemonEndpoint } from "../src/index.js";
import { assertContainedStatePath } from "../src/bootstrap.js";

const authorityTime = (): string => "2026-08-12T00:00:00.000Z";
function fixture(identity = "owner"): { root: string; daemon: Daemon } {
  const root = mkdtempSync(join(tmpdir(), "horseness-daemon-"));
  return { root, daemon: new Daemon({ workspacePath: root, databasePath: join(root, "authority.sqlite"), artifactRoot: join(root, "artifacts"), transport: { kind: "unix-socket", endpointPath: join(root, ".horseness", "daemon.sock") }, authorityTime }, { identity: () => identity }) };
}

function bootstrap(daemon: Daemon): ReturnType<Daemon["consumeBootstrapCapability"]> {
  const capability = daemon.createBootstrapCapability("principal:owner");
  return daemon.consumeBootstrapCapability(capability.secret);
}

test("successful bootstrap is single-use and owner-only", () => {
  const { daemon } = fixture();
  const capability = daemon.createBootstrapCapability();
  if (process.platform !== "win32") {
    assert.equal(statSync(daemon.config.stateDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(daemon.config.bootstrapCapabilityPath).mode & 0o777, 0o600);
  }
  const result = daemon.consumeBootstrapCapability(capability.secret);
  assert.equal(daemon.authority.replay(result.workspaceId, "workspace", result.workspaceId).length, 1);
  assert.throws(() => daemon.consumeBootstrapCapability(capability.secret)); daemon.close();
});

test("bootstrap refuses broad native permissions before consuming authority", () => {
  const { root, daemon } = fixture();
  try {
    const capability = daemon.createBootstrapCapability();
    if (process.platform === "win32") {
      const changed = spawnSync("icacls.exe", [daemon.config.bootstrapCapabilityPath, "/grant", "*S-1-1-0:(R)"], { encoding: "utf8", windowsHide: true });
      assert.equal(changed.status, 0, changed.stderr || changed.stdout);
    } else chmodSync(daemon.config.bootstrapCapabilityPath, 0o644);
    assert.throws(() => daemon.consumeBootstrapCapability(capability.secret), /bootstrap capability permissions invalid/);
    assert.equal(daemon.authority.replay(daemon.config.workspaceId, "workspace", daemon.config.workspaceId).length, 0);
  } finally { daemon.close(); rmSync(root, { recursive: true, force: true }); }
});

test("aliased workspace bootstrap and reopen share one canonical authority", () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-daemon-alias-"));
  const physical = join(root, "physical"), alias = join(root, "alias");
  mkdirSync(physical, { mode: 0o700 });
  symlinkSync(physical, alias, process.platform === "win32" ? "junction" : "dir");
  const config = { workspacePath: alias, databasePath: join(alias, "authority.sqlite"), artifactRoot: join(alias, "artifacts"), transport: { kind: "stdio" as const }, authorityTime };
  let daemon: Daemon | undefined;
  try {
    daemon = new Daemon(config, { identity: () => "owner" });
    const result = bootstrap(daemon);
    const artifact = daemon.authority.artifacts.publishAndRegister("canonical workspace artifact");
    daemon.close(); daemon = undefined;
    daemon = new Daemon(config, { identity: () => "owner" });
    assert.equal(daemon.config.workspaceId, result.workspaceId);
    assert.equal(daemon.authority.replay(result.workspaceId, "workspace", result.workspaceId).length, 1);
    assert.equal(daemon.authority.artifacts.readReferenced(artifact.digest).toString("utf8"), "canonical workspace artifact");
  } finally { daemon?.close(); rmSync(root, { recursive: true, force: true }); }
});

test("state containment rejects the workspace itself, sibling prefixes and parent escapes", () => {
  const root = join(tmpdir(), "horseness-contained-workspace");
  for (const path of [root, join(`${root}-other`, "state"), join(root, "..", "outside-state")]) {
    assert.throws(() => assertContainedStatePath(root, path), /daemon state path escapes workspace/);
  }
});

test("concurrent bootstrap has exactly one winner", async () => {
  const { daemon } = fixture(); const capability = daemon.createBootstrapCapability();
  const outcomes = await Promise.allSettled([Promise.resolve().then(() => daemon.consumeBootstrapCapability(capability.secret)), Promise.resolve().then(() => daemon.consumeBootstrapCapability(capability.secret))]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1); assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1); daemon.close();
});

test("unauthorized OS identity cannot consume bootstrap", () => {
  const { root, daemon } = fixture("owner"); const capability = daemon.createBootstrapCapability(); daemon.close();
  const intruder = new Daemon({ workspacePath: root, databasePath: join(root, "authority.sqlite"), artifactRoot: join(root, "artifacts"), transport: { kind: "stdio" }, authorityTime }, { identity: () => "intruder" });
  assert.throws(() => intruder.consumeBootstrapCapability(capability.secret), /binding mismatch/); intruder.close();
});

test("grant lookup enforces peer identity, expiry, revocation and scopes", async () => {
  const { daemon } = fixture(); bootstrap(daemon);
  const issued = daemon.grants.issue({ peerIdentity: "worker", principalId: "principal:worker", principalRole: "worker", workspaceId: daemon.config.workspaceId, runId: "run-1", taskId: "task-1", allowedMethods: ["task.get.v1"], expiresAt: "2026-08-13T00:00:00.000Z" });
  assert.equal((await daemon.grants.lookupActiveGrant("worker", issued.grantReference))?.runId, "run-1");
  assert.equal(await daemon.grants.lookupActiveGrant("other", issued.grantReference), null);
  assert.equal(daemon.grants.revoke(issued.grantReference), true); assert.equal(await daemon.grants.lookupActiveGrant("worker", issued.grantReference), null);
  assert.throws(() => daemon.grants.issue({ peerIdentity: "worker", principalId: "stale", principalRole: "worker", workspaceId: daemon.config.workspaceId, allowedMethods: ["task.get.v1"], expiresAt: "2026-08-11T00:00:00.000Z" })); daemon.close();
});

test("restart reopens workspace and preserves isolated grants", async () => {
  const { root, daemon } = fixture(); bootstrap(daemon);
  const one = daemon.grants.issue({ peerIdentity: "user-a", principalId: "a", principalRole: "operator", workspaceId: daemon.config.workspaceId, allowedMethods: ["workspace.get.v1"], expiresAt: "2027-01-01T00:00:00.000Z" });
  const two = daemon.grants.issue({ peerIdentity: "user-b", principalId: "b", principalRole: "operator", workspaceId: daemon.config.workspaceId, allowedMethods: ["workspace.get.v1"], expiresAt: "2027-01-01T00:00:00.000Z" }); daemon.close();
  const reopened = new Daemon({ workspacePath: root, databasePath: join(root, "authority.sqlite"), artifactRoot: join(root, "artifacts"), transport: { kind: "stdio" }, authorityTime });
  assert.equal(reopened.authority.replay(reopened.config.workspaceId, "workspace", reopened.config.workspaceId).length, 1);
  assert.equal((await reopened.grants.lookupActiveGrant("user-a", one.grantReference))?.principalId, "a"); assert.equal(await reopened.grants.lookupActiveGrant("user-a", two.grantReference), null); reopened.close();
});

test("endpoint discovery accepts only the live exact process incarnation", async () => {
  if (process.platform !== "linux") return;
  const { daemon } = fixture(process.env.USER ?? "owner");
  const result = bootstrap(daemon);
  await daemon.start(result.grantReference);
  try {
    const endpoint = discoverDaemonEndpoint(daemon.config.endpointStatePath, daemon.config.workspaceId);
    assert.equal(endpoint.processId, process.pid);
    assert.match(endpoint.processIncarnation ?? "", /^linux-proc-starttime:[0-9]+$/u);
    assert.equal(statSync(daemon.config.endpointStatePath).mode & 0o777, 0o600);
    const persisted = JSON.parse(readFileSync(daemon.config.endpointStatePath, "utf8")) as Record<string, unknown>;
    const genuineIncarnation = persisted.processIncarnation;
    assert.equal(typeof genuineIncarnation, "string");
    const starttime = BigInt((genuineIncarnation as string).slice("linux-proc-starttime:".length));
    writeFileSync(daemon.config.endpointStatePath, `${JSON.stringify({ ...persisted, processIncarnation: `linux-proc-starttime:${starttime + 1n}` })}\n`, { mode: 0o600 });
    assert.throws(() => discoverDaemonEndpoint(daemon.config.endpointStatePath, daemon.config.workspaceId), /incarnation mismatch/u);
    writeFileSync(daemon.config.endpointStatePath, `${JSON.stringify(persisted)}\n`, { mode: 0o600 });
    assert.equal(discoverDaemonEndpoint(daemon.config.endpointStatePath, daemon.config.workspaceId).processIncarnation, genuineIncarnation);
  } finally {
    await daemon.stop();
    daemon.close();
  }
  const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", "process.stdout.write(JSON.stringify({ok:true,pid:process.pid}))"], { encoding: "utf8" });
  assert.equal(smoke.status, 0);
  assert.equal(JSON.parse(smoke.stdout).ok, true);
});

test("legacy endpoint state without an incarnation fails closed", async () => {
  if (process.platform !== "linux") return;
  const { daemon } = fixture(process.env.USER ?? "owner");
  const result = bootstrap(daemon);
  await daemon.start(result.grantReference);
  try {
    const persisted = JSON.parse(readFileSync(daemon.config.endpointStatePath, "utf8")) as Record<string, unknown>;
    delete persisted.processIncarnation;
    writeFileSync(daemon.config.endpointStatePath, `${JSON.stringify(persisted)}\n`, { mode: 0o600 });
    assert.throws(() => discoverDaemonEndpoint(daemon.config.endpointStatePath, daemon.config.workspaceId), /incarnation unavailable/u);
  } finally {
    await daemon.stop();
    daemon.close();
  }
});
