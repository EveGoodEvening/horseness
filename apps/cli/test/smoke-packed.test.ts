import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Daemon } from "../../daemon/src/index.js";

const entry = resolve(import.meta.dirname, "../bin/horseness.mjs");
const daemonExecutable = resolve(import.meta.dirname, "../../daemon/bin/horseness-daemon.mjs");
const authorityTime = "2026-08-13T00:00:00.000Z";

function packed(args: readonly string[], env: NodeJS.ProcessEnv = {}): { status: number; stdout: string; stderr: string; json: Record<string, unknown> } {
  const result = spawnSync(entry, args, { encoding: "utf8", env: { ...process.env, ...env, HORSENESS_AUTHORITY_TIME: authorityTime } });
  const line = result.stdout.trim();
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, json: line.length === 0 ? {} : JSON.parse(line) as Record<string, unknown> };
}

function protectedFile(path: string, value: string): void { writeFileSync(path, value, { mode: 0o600 }); chmodSync(path, 0o600); }

test("packed CLI drives a fresh daemon without internal state access", { timeout: 30_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-cli-packed-"));
  const databasePath = join(root, ".horseness", "authority.sqlite");
  const artifactRoot = join(root, ".horseness", "artifacts");
  const endpointPath = join(root, ".horseness", "daemon.sock");
  const grantFile = join(root, "authority-grant.ref");
  let started = false;
  try {
    const provisioning = new Daemon({ workspacePath: root, databasePath, artifactRoot, transport: { kind: "unix-socket", endpointPath }, authorityTime: () => authorityTime });
    const capability = provisioning.createBootstrapCapability("principal:smoke-authority");
    const workspaceId = provisioning.config.workspaceId;
    provisioning.close();

    const paths = ["--workspace-path", root, "--database-path", databasePath, "--artifact-root", artifactRoot, "--endpoint-path", endpointPath, "--workspace-id", workspaceId, "--daemon-executable", daemonExecutable];
    const boot = packed(["bootstrap", ...paths, "--bootstrap-capability-file", join(root, ".horseness", "bootstrap-capability.v1.json"), "--grant-reference-file", grantFile, "--json"]);
    assert.equal(boot.status, 0, boot.stderr || boot.stdout);
    const bootData = boot.json.data as Record<string, unknown>;
    assert.equal(bootData.workspaceId, workspaceId);
    const authorityGrant = readFileSync(grantFile, "utf8").trim();
    assert.match(authorityGrant, /^grant:/u);

    const start = packed(["start", ...paths, "--grant-reference-file", grantFile, "--json"]);
    assert.equal(start.status, 0, start.stderr || start.stdout); started = true;
    const env = { HORSENESS_ENDPOINT_PATH: endpointPath, HORSENESS_WORKSPACE_ID: workspaceId, HORSENESS_GRANT_REFERENCE: authorityGrant };
    const workspaceCursor = { schemaVersion: "1", kind: "workspace-only", workspaceId, workspaceSequence: 1, workspaceEnvelopeHash: "0".repeat(64), workspaceContextEpoch: 0 };
    const workspace = packed(["workspace-get", "--workspace-id", workspaceId, "--cursor", JSON.stringify(workspaceCursor), "--input", JSON.stringify({ schemaVersion: "1", queryType: "GetWorkspaceV1", observationCursor: workspaceCursor }), "--json"], env);
    assert.equal(workspace.status, 0, workspace.stderr || workspace.stdout);
    assert.equal(workspace.stdout.trim().split("\n").length, 1);
    const workspaceData = workspace.json.data as Record<string, unknown>;
    const cursor = (workspaceData.value as Record<string, unknown>).observationCursor as Record<string, unknown>;

    const runId = "run:packed-smoke";
    const absentRun = { schemaVersion: "1", kind: "absent-run-genesis", workspaceId, workspaceSequence: cursor.workspaceSequence, workspaceEnvelopeHash: cursor.workspaceEnvelopeHash, workspaceContextEpoch: cursor.workspaceContextEpoch, runId, expectedRunHead: "absent" };
    const run = packed(["run-create", "--workspace-id", workspaceId, "--run-id", runId, "--cursor", JSON.stringify(absentRun), "--idempotency-key", "smoke-run-create", "--input", JSON.stringify({ schemaVersion: "1", commandType: "CreateRunV1", commandId: "smoke-run-create", observationCursor: absentRun, principalId: "principal:smoke-authority", initialDocument: { schemaVersion: "1", title: "packed" } }), "--json"], env);
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const grant = packed(["grant-issue", "--workspace-id", workspaceId, "--cursor", JSON.stringify(cursor), "--idempotency-key", "smoke-grant", "--input", JSON.stringify({ operationId: "smoke-grant", principalId: process.env.USER ?? "smoke", principalRole: "operator", actions: ["workspace.get.v1"], resourceScope: { peerIdentity: process.env.USER ?? "smoke" }, expiresAt: "2027-08-13T00:00:00.000Z" }), "--json"], env);
    assert.equal(grant.status, 0, grant.stderr || grant.stdout);
    const grantData = grant.json.data as Record<string, unknown>;
    const issued = grantData.value as Record<string, unknown>;

    const revoke = packed(["credential-revoke", "--workspace-id", workspaceId, "--cursor", JSON.stringify(cursor), "--idempotency-key", "smoke-revoke", "--grant-digest", String(issued.grantDigest), "--reason", "smoke", "--json"], env);
    assert.equal(revoke.status, 0, revoke.stderr || revoke.stdout);
    const staleEnv = { ...env, HORSENESS_GRANT_REFERENCE: String(issued.grantId) };
    const stale = packed(["workspace-get", "--workspace-id", workspaceId, "--cursor", JSON.stringify(cursor), "--input", JSON.stringify({ schemaVersion: "1", queryType: "GetWorkspaceV1", observationCursor: cursor }), "--json"], staleEnv);
    assert.equal(stale.status, 1);

    const recoveryFile = join(root, "recovery.json");
    protectedFile(recoveryFile, JSON.stringify({ schemaVersion: "1", workspaceId, grantReference: authorityGrant, recoveryToken: "must-not-leak" }));
    const recovery = packed(["credential-recover", "--workspace-id", workspaceId, "--recovery-file", recoveryFile, "--json"], env);
    assert.equal(recovery.status, 0, recovery.stderr || recovery.stdout);
    assert.doesNotMatch(recovery.stdout + recovery.stderr, /must-not-leak|recoveryToken/u);

    const stop = packed(["stop", "--workspace-path", root, "--json"], env);
    assert.equal(stop.status, 0, stop.stderr || stop.stdout); started = false;
    const rebind = packed(["restore-rebind", ...paths, "--json"], env);
    assert.equal(rebind.status, 0, rebind.stderr || rebind.stdout);
    assert.doesNotMatch(`${boot.stdout}${start.stdout}${workspace.stdout}${run.stdout}${grant.stdout}${revoke.stdout}${recovery.stdout}${stop.stdout}${rebind.stdout}`, new RegExp(capability.secret.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  } finally {
    if (started) packed(["stop", "--workspace-path", root, "--json"]);
    rmSync(root, { recursive: true, force: true });
  }
});
