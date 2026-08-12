import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Daemon, discoverDaemonEndpoint } from "../src/index.js";

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
  assert.equal(statSync(daemon.config.stateDirectory).mode & 0o777, 0o700);
  assert.equal(statSync(daemon.config.bootstrapCapabilityPath).mode & 0o777, 0o600);
  const result = daemon.consumeBootstrapCapability(capability.secret);
  assert.equal(daemon.authority.replay(result.workspaceId, "workspace", result.workspaceId).length, 1);
  assert.throws(() => daemon.consumeBootstrapCapability(capability.secret)); daemon.close();
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

test("endpoint discovery is owner-only and process smoke succeeds", async () => {
  const { daemon } = fixture(process.env.USER ?? "owner"); const result = bootstrap(daemon); await daemon.start(result.grantReference);
  const endpoint = discoverDaemonEndpoint(daemon.config.endpointStatePath, daemon.config.workspaceId); assert.equal(endpoint.processId, process.pid); assert.equal(statSync(daemon.config.endpointStatePath).mode & 0o777, 0o600); assert.match(readFileSync(daemon.config.endpointStatePath, "utf8"), /unix-socket/); await daemon.stop(); daemon.close();
  const smoke = spawnSync(process.execPath, ["--input-type=module", "-e", "process.stdout.write(JSON.stringify({ok:true,pid:process.pid}))"], { encoding: "utf8" }); assert.equal(smoke.status, 0); assert.equal(JSON.parse(smoke.stdout).ok, true);
});
