import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunGenesis, createWorkspaceGenesis, NO_POLICY_DIGEST } from "@horseness/domain";
import { SQLiteAuthority, StoreConflictError, createOrLoadAuthorityCredential } from "../src/index.js";

function root(): string { return mkdtempSync(join(tmpdir(), "horseness-trusted-reader-")); }

function createWorkspace(authority: SQLiteAuthority, workspaceId: string, runId: string): void {
  const workspace = createWorkspaceGenesis({ workspaceId, authorityPrincipalId: "authority", initialGrantDigest: "grant", authorityConsumptionMarker: "marker", activePolicyDigest: NO_POLICY_DIGEST, commandId: `workspace:${workspaceId}` });
  authority.appendAtomic({ commandId: `workspace:${workspaceId}`, workspace: { streamKind: "workspace", workspaceId, streamId: workspaceId, expectedSequence: 0, expectedEnvelopeHash: null, events: [workspace.event] } });
  const run = createRunGenesis({ observationCursor: { ...workspace.resultCursor, kind: "absent-run-genesis", runId, expectedRunHead: "absent" }, initialDocument: {}, principalId: "authority", commandId: `run:${runId}` });
  authority.appendAtomic({ commandId: `run:${runId}`, runGenesis: { observationCursor: { ...workspace.resultCursor, kind: "absent-run-genesis", runId, expectedRunHead: "absent" }, event: run.event } });
}

test("only an authenticated workspace open issues a workspace-bound reader", () => {
  const directory = root();
  const database = join(directory, "authority.sqlite");
  const artifacts = join(directory, "artifacts");
  try {
    const bootstrap = new SQLiteAuthority(database, artifacts);
    createWorkspace(bootstrap, "trusted-workspace", "run-a");
    createWorkspace(bootstrap, "other-workspace", "run-b");
    bootstrap.close();

    const credential = createOrLoadAuthorityCredential(database, artifacts, "trusted-workspace");
    const opened = SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "trusted-workspace", sessionId: "coordinator-session", credential });
    assert.equal(opened.reader.authenticatedView("trusted-workspace", "run-a").cursor.workspaceId, "trusted-workspace");
    assert.throws(() => opened.reader.authenticatedView("other-workspace", "run-b"), /workspace\/session mismatch/);
    assert.throws(() => SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "trusted-workspace", sessionId: "attacker-session", credential }), StoreConflictError);
    opened.authority.close();
    const reopenedCredential = createOrLoadAuthorityCredential(database, artifacts, "trusted-workspace");
    const reopened = SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "trusted-workspace", sessionId: "coordinator-session-2", credential: reopenedCredential });
    assert.equal(reopened.reader.authenticatedView("trusted-workspace", "run-a").cursor.runId, "run-a");
    reopened.authority.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a same-ID alternate database cannot use the pinned authority credential", () => {
  const trustedRoot = root();
  const attackerRoot = root();
  try {
    const trusted = new SQLiteAuthority(join(trustedRoot, "authority.sqlite"), join(trustedRoot, "artifacts"));
    createWorkspace(trusted, "coordinator-workspace", "run");
    trusted.close();
    const credential = createOrLoadAuthorityCredential(join(trustedRoot, "authority.sqlite"), join(trustedRoot, "artifacts"), "coordinator-workspace");
    const attacker = new SQLiteAuthority(join(attackerRoot, "authority.sqlite"), join(attackerRoot, "artifacts"));
    createWorkspace(attacker, "coordinator-workspace", "run");
    attacker.close();
    assert.throws(() => SQLiteAuthority.openAuthenticatedWorkspace(join(attackerRoot, "authority.sqlite"), join(attackerRoot, "artifacts"), { workspaceId: "coordinator-workspace", sessionId: "attacker-session", credential }), /credential is not valid/);
  } finally {
    rmSync(trustedRoot, { recursive: true, force: true });
    rmSync(attackerRoot, { recursive: true, force: true });
  }
});

test("unknown snapshots cannot mint trusted reducer output", () => {
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

    const credential = createOrLoadAuthorityCredential(database, artifacts, "workspace");
    const opened = SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "workspace", sessionId: "session", credential });
    assert.throws(() => opened.reader.exactRunHeadSnapshot("workspace", "run", "test-projection"), /projection family is not registered/);
    opened.authority.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
