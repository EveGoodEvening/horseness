import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunGenesis, createWorkspaceGenesis, domainDigest, NO_POLICY_DIGEST, sealEventEnvelope } from "@horseness/domain";
import { createOrLoadAuthorityCredential, SQLiteAuthority, type PublishAndAppendRequest } from "../src/index.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "horseness-execution-observation-"));
  const database = join(root, "authority.sqlite"), artifacts = join(root, "artifacts");
  const credential = createOrLoadAuthorityCredential(database, artifacts, "workspace");
  const bootstrap = SQLiteAuthority.open(database, artifacts);
  const workspace = createWorkspaceGenesis({ workspaceId: "workspace", authorityPrincipalId: "authority", initialGrantDigest: "grant", authorityConsumptionMarker: "consumed", activePolicyDigest: NO_POLICY_DIGEST, commandId: "bootstrap" });
  const state = { revoked: false };
  bootstrap.bootstrapWorkspaceAuthorityAtomic({ commandId: "bootstrap", workspace: { streamKind: "workspace", workspaceId: "workspace", streamId: "workspace", expectedSequence: 0, expectedEnvelopeHash: null, events: [workspace.event] }, authorityState: { schemaVersion: "1", workspaceId: "workspace", stateKind: "grants", revision: 1, stateDigest: domainDigest("horseness.workspace-authority-state.v1", state), state } });
  const absent = { ...workspace.resultCursor, kind: "absent-run-genesis" as const, runId: "run", expectedRunHead: "absent" as const };
  const run = createRunGenesis({ observationCursor: absent, initialDocument: {}, principalId: "authority", commandId: "run" });
  bootstrap.appendAtomic({ commandId: "run", runGenesis: { observationCursor: absent, event: run.event } });
  bootstrap.close();
  const { authority } = SQLiteAuthority.openAuthenticatedWorkspace(database, artifacts, { workspaceId: "workspace", sessionId: root, credential });
  const observed = authority.authenticatedAuthorityState("workspace", "grants");
  const bytes = "bound execution context";
  const digest = createHash("sha256").update(bytes).digest("hex");
  const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "run", workspaceId: "workspace", streamId: "run", sequence: 2, priorEnvelopeHash: run.event.envelopeHash, eventId: "context", eventType: "ContextManifestPublishedV1", principalId: "authority", causationId: "context", correlationId: "context", idempotencyKey: "context", payload: { eventType: "ContextManifestPublishedV1" as const, workspaceId: "workspace", runId: "run", contextManifestCoreDigest: digest } });
  const request: PublishAndAppendRequest = { commandId: "context", run: { streamKind: "run", workspaceId: "workspace", streamId: "run", expectedSequence: 1, expectedEnvelopeHash: run.event.envelopeHash, events: [event] }, workspaceObservationCursor: run.resultCursor, authorityStateExpectations: [{ stateKind: "grants", revision: observed.revision, stateDigest: observed.stateDigest }], artifacts: [{ data: bytes, references: [{ ownerKind: "event", ownerId: "context" }] }], requiredArtifactDigests: [digest] };
  return { root, authority, observed, request, digest };
}

test("revocation without a stream-head change prevents an execution artifact/event commit", () => {
  const f = fixture();
  try {
    f.authority.compareAndSwapAuthorityState({ commandId: "revoke", workspaceId: "workspace", stateKind: "grants", expectedRevision: f.observed.revision, expectedStateDigest: f.observed.stateDigest, nextState: { revoked: true } });
    assert.throws(() => f.authority.publishAndAppendAtomic(f.request), /authority state observation compare-and-swap conflict/);
    assert.deepEqual(f.authority.replay("workspace", "run", "run").map(item => item.envelope.eventType), ["RunCreatedV1"]);
    assert.throws(() => f.authority.artifacts.readReferenced(f.digest), /unknown artifact reference/);
  } finally { f.authority.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("an exact committed retry survives later revocation without creating another effect", () => {
  const f = fixture();
  try {
    const original = f.authority.publishAndAppendAtomic(f.request);
    f.authority.compareAndSwapAuthorityState({ commandId: "revoke", workspaceId: "workspace", stateKind: "grants", expectedRevision: f.observed.revision, expectedStateDigest: f.observed.stateDigest, nextState: { revoked: true } });
    const recovered = f.authority.publishAndAppendAtomic(f.request);
    assert.equal(recovered.deduplicated, true);
    assert.deepEqual(recovered.runHead, original.runHead);
    assert.deepEqual(f.authority.replay("workspace", "run", "run").map(item => item.envelope.eventId), ["run:1", "context"]);
    assert.throws(() => f.authority.publishAndAppendAtomic({ ...f.request, authorityStateExpectations: [] }), /command id reused with different request/);
  } finally { f.authority.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test("artifact publication refuses a stale workspace policy observation", () => {
  const f = fixture();
  try {
    const prior = f.authority.replay("workspace", "workspace", "workspace").at(-1)!;
    const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "workspace", workspaceId: "workspace", streamId: "workspace", sequence: 2, priorEnvelopeHash: prior.envelopeHash, eventId: "policy", eventType: "PolicyReferenceChangedV1", principalId: "authority", causationId: "policy", correlationId: "policy", idempotencyKey: "policy", payload: { eventType: "PolicyReferenceChangedV1" as const, workspaceId: "workspace", activePolicyDigest: "new-policy" } });
    f.authority.appendAtomic({ commandId: "policy", workspace: { streamKind: "workspace", workspaceId: "workspace", streamId: "workspace", expectedSequence: 1, expectedEnvelopeHash: prior.envelopeHash, events: [event] } });
    assert.throws(() => f.authority.publishAndAppendAtomic(f.request), /workspace observation compare-and-swap conflict/);
    assert.deepEqual(f.authority.replay("workspace", "run", "run").map(item => item.envelope.eventType), ["RunCreatedV1"]);
  } finally { f.authority.close(); rmSync(f.root, { recursive: true, force: true }); }
});
