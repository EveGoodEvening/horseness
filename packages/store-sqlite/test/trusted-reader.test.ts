import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunGenesis, createWorkspaceGenesis, NO_POLICY_DIGEST } from "@horseness/domain";
import { SQLiteAuthority, StoreConflictError, StoreIntegrityError } from "../src/index.js";

function root(): string { return mkdtempSync(join(tmpdir(), "horseness-trusted-reader-")); }

function createWorkspace(authority: SQLiteAuthority, workspaceId: string, runId: string): void {
  const workspace = createWorkspaceGenesis({ workspaceId, authorityPrincipalId: "authority", initialGrantDigest: "grant", authorityConsumptionMarker: "marker", activePolicyDigest: NO_POLICY_DIGEST, commandId: `workspace:${workspaceId}` });
  authority.appendAtomic({ commandId: `workspace:${workspaceId}`, workspace: { streamKind: "workspace", workspaceId, streamId: workspaceId, expectedSequence: 0, expectedEnvelopeHash: null, events: [workspace.event] } });
  const run = createRunGenesis({ observationCursor: { ...workspace.resultCursor, kind: "absent-run-genesis", runId, expectedRunHead: "absent" }, initialDocument: {}, principalId: "authority", commandId: `run:${runId}` });
  authority.appendAtomic({ commandId: `run:${runId}`, runGenesis: { observationCursor: { ...workspace.resultCursor, kind: "absent-run-genesis", runId, expectedRunHead: "absent" }, event: run.event } });
}

const reducers = Object.freeze([{
  projectionName: "test-projection", projectionVersion: "1", match: "exact" as const,
  validate: (snapshot: Readonly<{ state: unknown }>) => {
    if (snapshot.state === null || typeof snapshot.state !== "object" || !("validated" in snapshot.state) || snapshot.state.validated !== true) throw new StoreIntegrityError("projection reducer validation failed");
  },
}]);

test("only an authenticated workspace open issues a workspace-bound reader", () => {
  const directory = root();
  const database = join(directory, "authority.sqlite");
  const artifacts = join(directory, "artifacts");
  try {
    const bootstrap = new SQLiteAuthority(database, artifacts);
    createWorkspace(bootstrap, "trusted-workspace", "run-a");
    createWorkspace(bootstrap, "other-workspace", "run-b");
    bootstrap.close();

    const opened = SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "trusted-workspace", sessionId: "coordinator-session", snapshotReducers: reducers });
    assert.equal(opened.reader.authenticatedView("trusted-workspace", "run-a").cursor.workspaceId, "trusted-workspace");
    assert.throws(() => opened.reader.authenticatedView("other-workspace", "run-b"), /workspace\/session mismatch/);
    assert.throws(() => SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "trusted-workspace", sessionId: "attacker-session", snapshotReducers: reducers }), StoreConflictError);
    opened.authority.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an attacker-created database is authoritative only for its distinct workspace", () => {
  const trustedRoot = root();
  const attackerRoot = root();
  try {
    const trusted = new SQLiteAuthority(join(trustedRoot, "authority.sqlite"), join(trustedRoot, "artifacts"));
    createWorkspace(trusted, "coordinator-workspace", "run");
    trusted.close();
    const attacker = new SQLiteAuthority(join(attackerRoot, "authority.sqlite"), join(attackerRoot, "artifacts"));
    createWorkspace(attacker, "attacker-workspace", "run");
    attacker.close();

    assert.throws(() => SQLiteAuthority.openAuthenticatedWorkspace(join(attackerRoot, "authority.sqlite"), join(attackerRoot, "artifacts"), { workspaceId: "coordinator-workspace", sessionId: "coordinator-session", snapshotReducers: reducers }), /authenticated workspace does not exist/);
    const attackerSession = SQLiteAuthority.openAuthenticatedWorkspace(join(attackerRoot, "authority.sqlite"), join(attackerRoot, "artifacts"), { workspaceId: "attacker-workspace", sessionId: "attacker-session", snapshotReducers: reducers });
    assert.equal(attackerSession.reader.authenticatedView("attacker-workspace", "run").cursor.workspaceId, "attacker-workspace");
    assert.throws(() => attackerSession.reader.authenticatedView("coordinator-workspace", "run"), /workspace\/session mismatch/);
    attackerSession.authority.close();
  } finally {
    rmSync(trustedRoot, { recursive: true, force: true });
    rmSync(attackerRoot, { recursive: true, force: true });
  }
});

test("public snapshot insertion cannot mint trusted reducer output", () => {
  const directory = root();
  const database = join(directory, "authority.sqlite");
  const artifacts = join(directory, "artifacts");
  try {
    const bootstrap = new SQLiteAuthority(database, artifacts);
    createWorkspace(bootstrap, "workspace", "run");
    assert.equal("putSnapshot" in bootstrap, false);
    const head = bootstrap.replay("workspace", "run", "run").at(-1)!;
    bootstrap.db.prepare("INSERT INTO snapshots(workspace_id,stream_kind,stream_id,sequence,envelope_hash,projection_name,projection_version,state_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run("workspace", "run", "run", head.envelope.sequence, head.envelopeHash, "test-projection", "1", '{"validated":false}', new Date().toISOString());
    bootstrap.close();

    const opened = SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "workspace", sessionId: "session", snapshotReducers: reducers });
    assert.throws(() => opened.reader.exactRunHeadSnapshot("workspace", "run", "test-projection"), /projection reducer validation failed/);
    opened.authority.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
