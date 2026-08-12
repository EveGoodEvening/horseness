import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createRunGenesis,
  createWorkspaceGenesis,
  domainDigest,
  NO_POLICY_DIGEST,
  sealEventEnvelope,
  type DeltaAcceptedV1,
  type JsonValue,
  type WorkspaceCreatedV1,
} from "@horseness/domain";
import { verifyAuthority } from "../../src/recovery/index.js";
import { SQLiteAuthority } from "../../src/sqlite-authority.js";

function authorityWithRun(root: string): {
  store: SQLiteAuthority;
  workspaceId: string;
  runId: string;
} {
  const workspaceId = "workspace-a";
  const runId = "run-a";
  const store = new SQLiteAuthority(join(root, "authority.sqlite"), join(root, "artifacts"));
  const workspace = createWorkspaceGenesis({
    workspaceId,
    authorityPrincipalId: "authority",
    initialGrantDigest: "grant",
    authorityConsumptionMarker: "marker",
    activePolicyDigest: NO_POLICY_DIGEST,
    commandId: "create-workspace",
  });
  store.appendAtomic({
    commandId: "create-workspace",
    workspace: {
      streamKind: "workspace",
      workspaceId,
      streamId: workspaceId,
      expectedSequence: 0,
      expectedEnvelopeHash: null,
      events: [workspace.event],
    },
  });
  const run = createRunGenesis({
    observationCursor: {
      ...workspace.resultCursor,
      kind: "absent-run-genesis",
      runId,
      expectedRunHead: "absent",
    },
    initialDocument: { items: [] },
    principalId: "authority",
    commandId: "create-run",
  });
  store.appendAtomic({ commandId: "create-run", runGenesis: { observationCursor: {
    ...workspace.resultCursor,
    kind: "absent-run-genesis",
    runId,
    expectedRunHead: "absent",
  }, event: run.event } });
  return { store, workspaceId, runId };
}

test("authority verification rejects DeltaAccepted before its proposal was submitted", () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-recovery-semantic-run-"));
  try {
    const { store, workspaceId, runId } = authorityWithRun(root);
    const genesis = store.replay(workspaceId, "run", runId)[0];
    assert.ok(genesis);
    const initialDocument: JsonValue = { items: [] };
    const resultingDocument: JsonValue = { items: ["accepted-without-submission"] };
    const payload: DeltaAcceptedV1 = {
      eventType: "DeltaAcceptedV1",
      workspaceId,
      runId,
      proposalId: "proposal-a",
      proposalDigest: "proposal-digest",
      priorStateHash: domainDigest("horseness.canonical-document.v1", initialDocument),
      resultingStateHash: domainDigest("horseness.canonical-document.v1", resultingDocument),
      resultingDocument,
    };
    const accepted = sealEventEnvelope({
      schemaVersion: "1",
      streamKind: "run",
      workspaceId,
      streamId: runId,
      sequence: 2,
      eventId: "accept-delta:1",
      eventType: payload.eventType,
      principalId: "authority",
      causationId: "accept-delta",
      correlationId: "accept-delta",
      idempotencyKey: "accept-delta",
      priorEnvelopeHash: genesis.envelopeHash,
      payload,
    });
    store.appendAtomic({
      commandId: "accept-delta",
      run: {
        streamKind: "run",
        workspaceId,
        streamId: runId,
        expectedSequence: 1,
        expectedEnvelopeHash: genesis.envelopeHash,
        events: [accepted],
      },
    });

    assert.throws(
      () => verifyAuthority(store.db, join(root, "artifacts")),
      /semantic event replay failed: PROPOSAL_NOT_SUBMITTED/,
    );
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("authority verification rejects a valid-hash illegal workspace transition", () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-recovery-semantic-workspace-"));
  try {
    const { store, workspaceId } = authorityWithRun(root);
    const genesis = store.replay(workspaceId, "workspace", workspaceId)[0];
    assert.ok(genesis);
    const payload: WorkspaceCreatedV1 = {
      eventType: "WorkspaceCreatedV1",
      workspaceId,
      authorityPrincipalId: "replacement-authority",
      initialGrantDigest: "replacement-grant",
      authorityConsumptionMarker: "replacement-marker",
      activePolicyDigest: NO_POLICY_DIGEST,
    };
    const duplicateGenesis = sealEventEnvelope({
      schemaVersion: "1",
      streamKind: "workspace",
      workspaceId,
      streamId: workspaceId,
      sequence: 2,
      eventId: "illegal-workspace-transition:1",
      eventType: payload.eventType,
      principalId: "replacement-authority",
      causationId: "illegal-workspace-transition",
      correlationId: "illegal-workspace-transition",
      idempotencyKey: "illegal-workspace-transition",
      priorEnvelopeHash: genesis.envelopeHash,
      payload,
    });
    store.appendAtomic({
      commandId: "illegal-workspace-transition",
      workspace: {
        streamKind: "workspace",
        workspaceId,
        streamId: workspaceId,
        expectedSequence: 1,
        expectedEnvelopeHash: genesis.envelopeHash,
        events: [duplicateGenesis],
      },
    });

    assert.throws(
      () => verifyAuthority(store.db, join(root, "artifacts")),
      /semantic event replay failed: INVALID_GENESIS/,
    );
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("authority verification accepts authenticated workspace and run authorities", () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-recovery-authority-positive-"));
  try {
    const { store } = authorityWithRun(root);
    assert.deepEqual(verifyAuthority(store.db, join(root, "artifacts")), {
      streams: 2,
      events: 2,
      artifacts: 0,
    });
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("authority verification rejects a valid-hash orphan run authority", () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-recovery-orphan-run-"));
  try {
    const { store, workspaceId } = authorityWithRun(root);
    store.db.exec("PRAGMA foreign_keys = OFF");
    store.db.prepare("DELETE FROM events WHERE workspace_id=? AND stream_kind='workspace'").run(workspaceId);
    store.db.prepare("DELETE FROM streams WHERE workspace_id=? AND stream_kind='workspace'").run(workspaceId);
    store.db.exec("PRAGMA foreign_keys = ON");

    assert.throws(
      () => verifyAuthority(store.db, join(root, "artifacts")),
      /orphan run authority workspace-a\/run-a/,
    );
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const streamKind of ["workspace", "run"] as const) {
  test(`authority verification rejects an empty ${streamKind} stream row`, () => {
    const root = mkdtempSync(join(tmpdir(), `horseness-recovery-empty-${streamKind}-`));
    try {
      const store = new SQLiteAuthority(join(root, "authority.sqlite"), join(root, "artifacts"));
      const workspaceId = "workspace-empty";
      const streamId = streamKind === "workspace" ? workspaceId : "run-empty";
      store.db.prepare(
        "INSERT INTO streams(stream_kind,workspace_id,stream_id,head_sequence,head_hash) VALUES(?,?,?,0,NULL)",
      ).run(streamKind, workspaceId, streamId);

      assert.throws(
        () => verifyAuthority(store.db, join(root, "artifacts")),
        new RegExp(`empty ${streamKind} stream row`),
      );
      store.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
