import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  canonicalJson,
  createRunGenesis,
  createWorkspaceGenesis,
  domainDigest,
  sealEventEnvelope,
  sealForkPin,
  type CompositeCursorV1,
  type ContextVersionV1,
  type DeltaAcceptedV1,
  type HashedEventEnvelopeV1,
  type JsonValue,
  type RunCreatedV1,
  type SealedForkPinV1,
  type WorkspaceCreatedV1,
} from "@horseness/domain";
import { SQLiteAuthority, createOrLoadAuthorityCredential } from "@horseness/store-sqlite";
import { authenticateContextSnapshot, contextSourceDigest, reconstructPinnedContext } from "../../src/context/index.js";

import type { AuthenticatedContextSnapshotV1 } from "../../src/context/index.js";

interface BaseSetup {
  root: string;
  database: string;
  artifactRoot: string;
  bootstrap: SQLiteAuthority;
  workspace: { event: HashedEventEnvelopeV1<WorkspaceCreatedV1> };
  run: { event: HashedEventEnvelopeV1<RunCreatedV1>; resultCursor: CompositeCursorV1 };
}

interface PinBundle {
  cursor: CompositeCursorV1;
  version: ContextVersionV1;
  pin: SealedForkPinV1;
}

interface SourceDescriptor {
  sourceId: string;
  kind: "system" | "evidence";
  priority: number;
  digest: string;
  activationEpoch: number;
  deactivationEpoch: number | null;
  artifactDigest: string;
  eventId: string;
}

function baseSetup(): BaseSetup {
  const root = mkdtempSync(join(tmpdir(), "horseness-context-visibility-"));
  const database = join(root, "db.sqlite");
  const artifactRoot = join(root, "artifacts");
  const bootstrap = SQLiteAuthority.open(database, artifactRoot);
  const workspace = createWorkspaceGenesis({
    workspaceId: "w",
    authorityPrincipalId: "authority",
    initialGrantDigest: "grant",
    authorityConsumptionMarker: "marker",
    activePolicyDigest: "policy",
    commandId: "workspace",
  });
  bootstrap.appendAtomic({
    commandId: "workspace",
    workspace: {
      streamKind: "workspace",
      workspaceId: "w",
      streamId: "w",
      expectedSequence: 0,
      expectedEnvelopeHash: null,
      events: [workspace.event],
    },
  });
  const absent = {
    schemaVersion: "1" as const,
    kind: "absent-run-genesis" as const,
    workspaceId: "w",
    workspaceSequence: 1,
    workspaceEnvelopeHash: workspace.event.envelopeHash,
    workspaceContextEpoch: 0,
    runId: "r",
    expectedRunHead: "absent" as const,
  };
  const run = createRunGenesis({
    observationCursor: absent,
    initialDocument: { objective: "ship" },
    principalId: "authority",
    commandId: "run",
  });
  bootstrap.appendAtomic({ commandId: "run", runGenesis: { observationCursor: absent, event: run.event } });
  return { root, database, artifactRoot, bootstrap, workspace, run };
}

function buildPin(run: BaseSetup["run"]): PinBundle {
  const cursor = run.resultCursor;
  const version: ContextVersionV1 = {
    schemaVersion: "1",
    kind: "composite",
    workspaceContextEpoch: 0,
    runContextEpoch: 0,
    observationCursor: cursor,
  };
  const pin = sealForkPin({
    schemaVersion: "1",
    forkId: "fork",
    pinVersion: 1,
    workspaceId: "w",
    runId: "r",
    parentForkPinDigest: null,
    refreshesForkPinDigest: null,
    canonicalRevision: 0,
    canonicalStateHash: domainDigest("horseness.canonical-document.v1", { objective: "ship" }),
    canonicalizerVersion: "jcs-v1",
    hashVersion: "sha256-v1",
    sourceObservationCursor: cursor,
    sourceContextVersion: version,
    dependencyJoinSnapshotDigest: "join",
    deltaAuthorityScopeDigest: "scope",
    pinnedPolicyDigest: "policy",
    ancestry: [],
    createdByPrincipalId: "authority",
    createdByGrantDigest: "grant",
  });
  return { cursor, version, pin };
}

function insertSourceSnapshot(
  bootstrap: SQLiteAuthority,
  cursor: CompositeCursorV1,
  version: ContextVersionV1,
  pin: SealedForkPinV1,
  descriptors: readonly SourceDescriptor[],
): void {
  const insert = bootstrap.db.prepare(
    "INSERT INTO snapshots(workspace_id,stream_kind,stream_id,sequence,envelope_hash,projection_name,projection_version,state_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  insert.run(
    "w",
    "run",
    "r",
    cursor.runSequence,
    cursor.runEnvelopeHash,
    "context-sources",
    "1",
    canonicalJson({
      schemaVersion: "1",
      workspaceId: "w",
      runId: "r",
      observationCursor: cursor,
      contextVersion: version,
      forkPinDigest: pin.forkPinDigest,
      sources: descriptors,
    } as unknown as JsonValue),
    new Date().toISOString(),
  );
}

function insertAuthSnapshot(
  bootstrap: SQLiteAuthority,
  cursor: CompositeCursorV1,
  version: ContextVersionV1,
): void {
  const insert = bootstrap.db.prepare(
    "INSERT INTO snapshots(workspace_id,stream_kind,stream_id,sequence,envelope_hash,projection_name,projection_version,state_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  insert.run(
    "w",
    "run",
    "r",
    cursor.runSequence,
    cursor.runEnvelopeHash,
    "context-authorization",
    "1",
    canonicalJson({
      schemaVersion: "1",
      workspaceId: "w",
      runId: "r",
      observationCursor: cursor,
      contextVersion: version,
      policyDigest: "policy",
      grantDigest: "grant",
      quotaDigest: "quota",
      grantRevoked: false,
      quotaAvailable: true,
    } as unknown as JsonValue),
    new Date().toISOString(),
  );
}

function openReader(database: string, artifactRoot: string, root: string) {
  return SQLiteAuthority.openAuthenticatedWorkspace(database, artifactRoot, {
    workspaceId: "w",
    sessionId: `visibility-${root}`,
    credential: createOrLoadAuthorityCredential(database, artifactRoot, "w"),
  });
}

function reconstructRequest(snapshot: AuthenticatedContextSnapshotV1) {
  return {
    snapshot,
    attemptId: "attempt",
    generation: 1,
    byteBudget: 1000,
    rendererVersion: "renderer-v1",
    providerIdempotencyKey: "provider-key",
    allowedProducerPrincipalId: "worker",
    allowedProducerGrantDigest: "worker-grant",
  };
}

test("post-pin run-event artifact bytes cannot enter a manifest", () => {
  const { root, database, artifactRoot, bootstrap, run } = baseSetup();
  try {
    const { cursor, version, pin } = buildPin(run);

    const priorStateHash = domainDigest("horseness.canonical-document.v1", { objective: "ship" });
    const resultingDocument = { objective: "shipped" };
    const resultingStateHash = domainDigest("horseness.canonical-document.v1", resultingDocument);
    const deltaPayload: DeltaAcceptedV1 = {
      eventType: "DeltaAcceptedV1",
      workspaceId: "w",
      runId: "r",
      proposalId: "p1",
      proposalDigest: "proposal",
      priorStateHash,
      resultingStateHash,
      resultingDocument,
    };
    const deltaEvent = sealEventEnvelope({
      schemaVersion: "1",
      streamKind: "run",
      workspaceId: "w",
      streamId: "r",
      sequence: 2,
      eventId: "delta:2",
      eventType: "DeltaAcceptedV1",
      principalId: "authority",
      causationId: "delta",
      correlationId: "delta",
      idempotencyKey: "delta",
      priorEnvelopeHash: run.event.envelopeHash,
      payload: deltaPayload,
    });
    bootstrap.appendAtomic({
      commandId: "delta",
      run: {
        streamKind: "run",
        workspaceId: "w",
        streamId: "r",
        expectedSequence: 1,
        expectedEnvelopeHash: run.event.envelopeHash,
        events: [deltaEvent],
      },
    });

    const postRecord = bootstrap.artifacts.publish("post-pin\n".normalize("NFC"));
    bootstrap.artifacts.register(postRecord);
    bootstrap.artifacts.addReference("w", "event", deltaEvent.envelope.eventId, postRecord.digest);

    const descriptors: SourceDescriptor[] = [
      {
        sourceId: "post",
        kind: "system",
        priority: 1,
        digest: contextSourceDigest("post-pin\n"),
        activationEpoch: 0,
        deactivationEpoch: null,
        artifactDigest: postRecord.digest,
        eventId: deltaEvent.envelope.eventId,
      },
    ];
    insertSourceSnapshot(bootstrap, cursor, version, pin, descriptors);
    const postPinCursor = { ...cursor, runSequence: 2, runEnvelopeHash: deltaEvent.envelopeHash, runContextEpoch: 1 };
    insertAuthSnapshot(bootstrap, postPinCursor, { ...version, runContextEpoch: 1, observationCursor: postPinCursor });
    bootstrap.close();

    const opened = openReader(database, artifactRoot, root);
    const snapshot = authenticateContextSnapshot(opened.reader, { pin });
    assert.throws(
      () => reconstructPinnedContext(reconstructRequest(snapshot)),
      /artifact is not bound to an authenticated source-run event at or before the pin/,
    );
    opened.authority.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("other-run artifact owner cannot enter a manifest", () => {
  const { root, database, artifactRoot, bootstrap, run } = baseSetup();
  try {
    const { cursor, version, pin } = buildPin(run);

    const absent2 = {
      schemaVersion: "1" as const,
      kind: "absent-run-genesis" as const,
      workspaceId: "w",
      workspaceSequence: 1,
      workspaceEnvelopeHash: run.resultCursor.workspaceEnvelopeHash,
      workspaceContextEpoch: 0,
      runId: "r2",
      expectedRunHead: "absent" as const,
    };
    const run2 = createRunGenesis({
      observationCursor: absent2,
      initialDocument: { objective: "other" },
      principalId: "authority",
      commandId: "run2",
    });
    bootstrap.appendAtomic({ commandId: "run2", runGenesis: { observationCursor: absent2, event: run2.event } });

    const otherRecord = bootstrap.artifacts.publish("other-run\n".normalize("NFC"));
    bootstrap.artifacts.register(otherRecord);
    bootstrap.artifacts.addReference("w", "event", run2.event.envelope.eventId, otherRecord.digest);

    const descriptors: SourceDescriptor[] = [
      {
        sourceId: "other",
        kind: "evidence",
        priority: 1,
        digest: contextSourceDigest("other-run\n"),
        activationEpoch: 0,
        deactivationEpoch: null,
        artifactDigest: otherRecord.digest,
        eventId: run2.event.envelope.eventId,
      },
    ];
    insertSourceSnapshot(bootstrap, cursor, version, pin, descriptors);
    insertAuthSnapshot(bootstrap, cursor, version);
    bootstrap.close();

    const opened = openReader(database, artifactRoot, root);
    const snapshot = authenticateContextSnapshot(opened.reader, { pin });
    assert.throws(
      () => reconstructPinnedContext(reconstructRequest(snapshot)),
      /artifact is not bound to an authenticated source-run event at or before the pin/,
    );
    opened.authority.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace-event artifact owner cannot enter a manifest", () => {
  const { root, database, artifactRoot, bootstrap, workspace, run } = baseSetup();
  try {
    const { cursor, version, pin } = buildPin(run);

    const wsRecord = bootstrap.artifacts.publish("workspace-owned\n".normalize("NFC"));
    bootstrap.artifacts.register(wsRecord);
    bootstrap.artifacts.addReference("w", "event", workspace.event.envelope.eventId, wsRecord.digest);

    const descriptors: SourceDescriptor[] = [
      {
        sourceId: "ws",
        kind: "system",
        priority: 1,
        digest: contextSourceDigest("workspace-owned\n"),
        activationEpoch: 0,
        deactivationEpoch: null,
        artifactDigest: wsRecord.digest,
        eventId: workspace.event.envelope.eventId,
      },
    ];
    insertSourceSnapshot(bootstrap, cursor, version, pin, descriptors);
    insertAuthSnapshot(bootstrap, cursor, version);
    bootstrap.close();

    const opened = openReader(database, artifactRoot, root);
    const snapshot = authenticateContextSnapshot(opened.reader, { pin });
    assert.throws(
      () => reconstructPinnedContext(reconstructRequest(snapshot)),
      /artifact is not bound to an authenticated source-run event at or before the pin/,
    );
    opened.authority.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
