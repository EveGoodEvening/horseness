import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CoordinatorCallV1 } from "@horseness/sdk";
import type { CliInvocationV1 } from "../src/registry.js";
import { withCliWorkspaceV1, type CliWorkspaceV1 } from "../src/workspace.js";

function fixture(root: string): { state: CliWorkspaceV1; invocation: CliInvocationV1; directory: string } {
  const directory = join(root, ".horseness");
  mkdirSync(directory, { mode: 0o700 });
  const workspaceId = "workspace:regression";
  const state: CliWorkspaceV1 = {
    schemaVersion: "1", workspacePath: root, workspaceId, principalId: "authority:regression",
    endpointPath: join(directory, "daemon.sock"), databasePath: join(directory, "authority.sqlite"), artifactRoot: join(directory, "artifacts"),
    daemonExecutable: "/usr/bin/false", grantReferenceFile: join(directory, "cli-grant-reference.v1"),
    workspaceCursor: { schemaVersion: "1", kind: "workspace-only", workspaceId, workspaceSequence: 1, workspaceEnvelopeHash: "genesis-hash", workspaceContextEpoch: 0 },
    currentRunId: null, runs: {}, pending: null,
  };
  writeFileSync(join(directory, "cli-workspace.v1.json"), JSON.stringify(state), { mode: 0o600 });
  writeFileSync(state.grantReferenceFile, "grant:regression\n", { mode: 0o600 });
  const invocation: CliInvocationV1 = { command: "status", args: [], options: { workspace: root }, outputMode: "json" };
  return { state, invocation, directory };
}

test("workspace persistence keeps pending intent across sessions and excludes grant from metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-state-"));
  try {
    const { state, invocation, directory } = fixture(root);
    const absent = { ...state.workspaceCursor, kind: "absent-run-genesis" as const, runId: "run:one", expectedRunHead: "absent" as const };
    const call: CoordinatorCallV1<"run.create.v1"> = { method: "run.create.v1", workspaceId: state.workspaceId, runId: "run:one", observationCursor: absent, idempotencyKey: "operation:one", input: { schemaVersion: "1", commandType: "CreateRunV1", commandId: "operation:one", observationCursor: absent, principalId: state.principalId, initialDocument: { title: "Durable intent" } } };
    await withCliWorkspaceV1(invocation, async (session) => {
      session.save({ ...session.state, pending: { command: "run create", title: "Durable intent", runId: "run:one", call } });
      assert.equal(session.state.pending?.title, "Durable intent");
    });
    await withCliWorkspaceV1(invocation, async (session) => { assert.equal(session.state.pending?.call.idempotencyKey, "operation:one"); });
    assert.doesNotMatch(readFileSync(join(directory, "cli-workspace.v1.json"), "utf8"), /grant:regression/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workspace rejects a symlinked state file without reading or overwriting its target", async () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-symlink-"));
  try {
    const { invocation, directory } = fixture(root);
    const stateFile = join(directory, "cli-workspace.v1.json");
    const target = join(root, "user-project-file");
    writeFileSync(target, "unchanged");
    rmSync(stateFile);
    symlinkSync(target, stateFile);
    await assert.rejects(withCliWorkspaceV1(invocation, async () => {}), { code: "WORKSPACE_STATE_INVALID" });
    assert.equal(readFileSync(target, "utf8"), "unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
