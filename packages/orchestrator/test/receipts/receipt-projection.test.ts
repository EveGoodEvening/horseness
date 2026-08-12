import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createRunGenesis,
  createWorkspaceGenesis,
  NO_POLICY_DIGEST,
  sealAttemptReceipt,
  sealEventEnvelope,
  type AttemptGenerationStateV1,
  type AttemptReceiptRecordedV1,
} from "@horseness/domain";
import { SQLiteAuthority } from "@horseness/store-sqlite";
import * as orchestrator from "../../src/index.js";
import {
  emptyReceiptProjection,
  applyStoredRetryDecision,
  issueStoredRetryDecision,
  issueStoredReceiptCapabilities,
  projectAuthenticatedReceipt,
  registerReceiptGeneration,
  type AttemptAuthorityInputV1,
  type ReceiptEventV1,
} from "../../src/index.js";

const generation = (number: number): AttemptGenerationStateV1 => ({
  attemptId: "attempt",
  generation: number,
  state: "acknowledged",
  bindingDigest: `binding-${number}`,
  idempotencyKeyDigest: `key-${number}`,
  providerHandle: `handle-${number}`,
  terminalEventSequence: null,
  findingCodes: [],
});

const receipt = (generationNumber = 1) => sealAttemptReceipt({
  schemaVersion: "1",
  workspaceId: "w",
  runId: "r",
  taskId: "task",
  attemptId: "attempt",
  generation: generationNumber,
  attemptContextBindingDigest: `binding-${generationNumber}`,
  contextManifestCoreDigest: `manifest-${generationNumber}`,
  forkPinDigest: `fork-${generationNumber}`,
  providerId: "provider",
  providerOperationId: `operation-${generationNumber}`,
  providerIdempotencyKeyDigest: `key-${generationNumber}`,
  producerPrincipalId: "adapter",
  producerGrantDigest: "grant",
  adapterId: "adapter",
  adapterVersion: "1",
  hostId: "host",
  hostVersion: "1",
  outcome: "succeeded",
  startedAt: "2026-08-12T00:00:00Z",
  finishedAt: "2026-08-12T00:00:01Z",
  outputDigest: "output",
  evidence: [],
  provenance: {},
  nonce: `nonce-${generationNumber}`,
});

const plainAuthority = (generationNumber = 1): AttemptAuthorityInputV1 => ({
  binding: {
    attemptId: "attempt",
    generation: generationNumber,
    digest: `binding-${generationNumber}`,
    contextManifestCoreDigest: `manifest-${generationNumber}`,
    forkPinDigest: `fork-${generationNumber}`,
    providerId: "provider",
    providerOperationId: `operation-${generationNumber}`,
    providerIdempotencyKeyDigest: `key-${generationNumber}`,
    allowedProducerPrincipalId: "adapter",
    allowedProducerGrantDigest: "grant",
  },
  providerHandle: `handle-${generationNumber}`,
  grant: { principalId: "adapter", grantDigest: "grant", revoked: false },
  dispatch: {
    attemptId: "attempt",
    generation: generationNumber,
    providerId: "provider",
    providerOperationId: `operation-${generationNumber}`,
    providerIdempotencyKeyDigest: `key-${generationNumber}`,
    providerHandle: `handle-${generationNumber}`,
  },
});

function storedCapabilities(generationNumber = 1, outcome: "succeeded" | "failed" = "succeeded") {
  const root = mkdtempSync(join(tmpdir(), "horseness-receipt-projection-"));
  const reducers = ["receipt-event", "receipt-authority", "receipt-retry-decision", "receipt-cancellation"].map((projectionName) => ({ projectionName, projectionVersion: "1", match: "exact" as const, validate: () => undefined }));
  const databasePath = join(root, "authority.sqlite");
  const artifactRoot = join(root, "artifacts");
  const bootstrap = SQLiteAuthority.open(databasePath, artifactRoot);
  const workspace = createWorkspaceGenesis({
    workspaceId: "w",
    authorityPrincipalId: "authority",
    initialGrantDigest: "grant",
    authorityConsumptionMarker: "marker",
    activePolicyDigest: NO_POLICY_DIGEST,
    commandId: "workspace",
  });
  bootstrap.appendAtomic({
    commandId: "workspace",
    workspace: { streamKind: "workspace", workspaceId: "w", streamId: "w", expectedSequence: 0, expectedEnvelopeHash: null, events: [workspace.event] },
  });
  const observationCursor = { ...workspace.resultCursor, kind: "absent-run-genesis" as const, runId: "r", expectedRunHead: "absent" as const };
  const run = createRunGenesis({ observationCursor, initialDocument: {}, principalId: "coordinator", commandId: "run" });
  bootstrap.appendAtomic({ commandId: "run", runGenesis: { observationCursor, event: run.event } });
  bootstrap.close();
  const { authority, reader } = SQLiteAuthority.openAuthenticatedWorkspace(databasePath, artifactRoot, { workspaceId: "w", sessionId: `receipt-${generationNumber}-${outcome}-${root}`, snapshotReducers: reducers });

  const original = receipt(generationNumber);
  const value = outcome === "succeeded" ? original : sealAttemptReceipt({
    schemaVersion: "1", workspaceId: "w", runId: "r", taskId: "task", attemptId: "attempt", generation: generationNumber,
    attemptContextBindingDigest: `binding-${generationNumber}`, contextManifestCoreDigest: `manifest-${generationNumber}`, forkPinDigest: `fork-${generationNumber}`,
    providerId: "provider", providerOperationId: `operation-${generationNumber}`, providerIdempotencyKeyDigest: `key-${generationNumber}`,
    producerPrincipalId: "adapter", producerGrantDigest: "grant", adapterId: "adapter", adapterVersion: "1", hostId: "host", hostVersion: "1",
    outcome: "failed", startedAt: "2026-08-12T00:00:00Z", finishedAt: "2026-08-12T00:00:01Z", outputDigest: null, evidence: [], provenance: {}, nonce: `nonce-${generationNumber}`,
  });
  const payload: AttemptReceiptRecordedV1 = {
    eventType: "AttemptReceiptRecordedV1",
    workspaceId: "w",
    runId: "r",
    receiptId: value.receiptId,
    receiptDigest: value.receiptDigest,
    outcome: value.outcome,
  };
  const stored = sealEventEnvelope({
    schemaVersion: "1",
    streamKind: "run",
    workspaceId: "w",
    streamId: "r",
    sequence: 2,
    eventId: `receipt:${generationNumber}`,
    eventType: payload.eventType,
    principalId: "adapter",
    causationId: `receipt-command:${generationNumber}`,
    correlationId: "attempt",
    idempotencyKey: `receipt:${generationNumber}`,
    priorEnvelopeHash: run.event.envelopeHash,
    payload,
  });
  authority.publishAndAppendAtomic({
    commandId: `receipt-command:${generationNumber}`,
    run: { streamKind: "run", workspaceId: "w", streamId: "r", expectedSequence: 1, expectedEnvelopeHash: run.event.envelopeHash, events: [stored] },
    artifacts: [],
    snapshots: [
      { workspaceId: "w", streamKind: "run", streamId: "r", sequence: 2, envelopeHash: stored.envelopeHash, projectionName: "receipt-event", projectionVersion: "1", state: { eventSequence: 2, eventDigest: stored.envelopeHash, authenticatedPrincipalId: "adapter", receipt: value } },
      { workspaceId: "w", streamKind: "run", streamId: "r", sequence: 2, envelopeHash: stored.envelopeHash, projectionName: "receipt-authority", projectionVersion: "1", state: plainAuthority(generationNumber) },
      { workspaceId: "w", streamKind: "run", streamId: "r", sequence: 2, envelopeHash: stored.envelopeHash, projectionName: "receipt-retry-decision", projectionVersion: "1", state: { workspaceId: "w", runId: "r", taskId: "task", attemptId: "attempt", generation: generationNumber, decision: "permitted", retryPolicyDigest: "retry-policy", eventSequence: 2, eventHash: stored.envelopeHash } },
    ],
  });
  const capabilities = issueStoredReceiptCapabilities(reader, { workspaceId: "w", runId: "r", receiptEventSequence: 2 });
  return { authority, reader, capabilities, close: () => { authority.close(); rmSync(root, { recursive: true, force: true }); } };
}

const state = (generationNumber = 1) => registerReceiptGeneration(emptyReceiptProjection("attempt"), generation(generationNumber));

test("trusted SQLite receipt event and authority snapshots mutate the projection", () => {
  const fixture = storedCapabilities();
  try {
    const projected = projectAuthenticatedReceipt(state(), fixture.capabilities.event, fixture.capabilities.authority);
    assert.equal(projected.resolution?.resolution, "succeeded");
    assert.equal(projected.resolution?.winningGeneration, 1);
  } finally { fixture.close(); }
});

test("fully populated self-consistent plain objects cannot self-assert receipt authority", () => {
  const fixture = storedCapabilities();
  try {
    const plainEvent: ReceiptEventV1 = {
      eventSequence: fixture.capabilities.event.eventSequence,
      eventDigest: fixture.capabilities.event.eventDigest,
      authenticatedPrincipalId: fixture.capabilities.event.authenticatedPrincipalId,
      receipt: fixture.capabilities.event.receipt,
    };
    assert.throws(
      () => projectAuthenticatedReceipt(state(), plainEvent as Parameters<typeof projectAuthenticatedReceipt>[1], plainAuthority() as Parameters<typeof projectAuthenticatedReceipt>[2]),
      /UNAUTHENTICATED_RECEIPT_EVENT/,
    );
    assert.equal("authenticated" in plainEvent, false);
  } finally { fixture.close(); }
});

test("trusted capabilities must share the same attempt-generation identity", () => {
  const first = storedCapabilities(1);
  const second = storedCapabilities(2);
  try {
    assert.throws(() => projectAuthenticatedReceipt(state(1), first.capabilities.event, second.capabilities.authority), /UNAUTHENTICATED_RECEIPT_EVENT/);
  } finally { first.close(); second.close(); }
});

test("package root exposes only capability consumers and trusted issuers", () => {
  assert.equal(orchestrator.projectAuthenticatedReceipt, projectAuthenticatedReceipt);
  assert.equal("verifyReceiptEvent" in orchestrator, false);
  assert.equal("verifyAttemptAuthority" in orchestrator, false);
  assert.equal(orchestrator.issueStoredReceiptCapabilities, issueStoredReceiptCapabilities);
  assert.equal("projectReceipt" in orchestrator, false);
  assert.equal("setRetryPermitted" in orchestrator, false);
  assert.equal("recordExplicitTaskCancellation" in orchestrator, false);
});

test("only an exact-head stored retry decision can keep failed arbitration open", () => {
  const fixture = storedCapabilities(1, "failed");
  try {
    const retry = issueStoredRetryDecision(fixture.reader, { workspaceId: "w", runId: "r", taskId: "task", attemptId: "attempt", generation: 1 });
    const projected = projectAuthenticatedReceipt(state(), fixture.capabilities.event, fixture.capabilities.authority);
    assert.equal(projected.resolution?.resolution, "failed");
    const prepared = applyStoredRetryDecision(state(), fixture.reader, retry);
    assert.equal(projectAuthenticatedReceipt(prepared, fixture.capabilities.event, fixture.capabilities.authority).resolution, null);
    assert.throws(() => applyStoredRetryDecision(state(), fixture.reader, { ...retry } as typeof retry), /ARBITRATION_AUTHORITY_UNAUTHENTICATED/);
    assert.equal("setRetryPermitted" in orchestrator, false);
  } finally { fixture.close(); }
});
