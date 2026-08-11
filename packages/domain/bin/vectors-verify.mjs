#!/usr/bin/env node
import { tsImport } from "tsx/esm/api";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { resolve } from "node:path";

const domain = await tsImport("../src/index.ts", import.meta.url);
const root = resolve(new URL("../../../docs/vectors", import.meta.url).pathname);

export const VECTOR_FAMILIES = ["events", "cursors", "proposal", "delta", "fork-pin", "dependency-join", "delta-authority", "context-binding", "receipt", "task-dispatch", "authorization"];

const cursor = { schemaVersion: "1", kind: "composite", workspaceId: "ws", workspaceSequence: 1, workspaceEnvelopeHash: "w", workspaceContextEpoch: 0, runId: "run", runSequence: 1, runEnvelopeHash: "r", runContextEpoch: 0 };
const contextVersion = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 0, runContextEpoch: 0, observationCursor: cursor };
const attemptState = (state = "planned") => ({ attemptId: "attempt", generation: 1, state, bindingDigest: "binding", idempotencyKeyDigest: "key-1", providerHandle: null, terminalEventSequence: state === "succeeded" ? 7 : null, findingCodes: [] });

export const executeVector = (vector) => {
  switch (vector.action) {
    case "canonicalJson": return domain.canonicalJson(vector.input);
    case "jsonValueDigest": return domain.jsonValueDigest(vector.input);
    case "validatePointer": return domain.validatePointer(vector.input);
    case "canonicalScope": return domain.canonicalScope(vector.input);
    case "deltaAuthorityScopeDigest": return domain.deltaAuthorityScopeDigest(vector.input);
    case "scopeContains": return domain.scopeContains(vector.input.scope, vector.input.path);
    case "intersectScopes": return domain.intersectScopes(vector.input.left, vector.input.right);
    case "applyDelta": return domain.applyDelta(vector.input.base, vector.input.operations, vector.input.scope);
    case "sealProposal": return domain.sealProposal(vector.input);
    case "verifyProposal": domain.verifyProposal(vector.input); return "verified";
    case "createWorkspaceGenesis": return domain.createWorkspaceGenesis(vector.input);
    case "createRunGenesis": return domain.createRunGenesis(vector.input);
    case "verifyEventChain": domain.verifyEventChain(vector.input); return "verified";
    case "deterministicReplay": return domain.deterministicReplay(vector.input);
    case "sealForkPin": return domain.sealForkPin(vector.input);
    case "createForkPin": return domain.createForkPin(vector.input.core, vector.input.parent);
    case "refreshForkPin": return domain.refreshForkPin(vector.input.parent, vector.input.changes);
    case "verifyForkPin": domain.verifyForkPin(vector.input); return "verified";
    case "sealDependencyJoinSnapshot": return domain.sealDependencyJoinSnapshot(vector.input);
    case "evaluateDependencies": return domain.evaluateDependencies(vector.input.edges, new Map(vector.input.outcomes));
    case "deriveSchedulability": return domain.deriveSchedulability(vector.input);
    case "assertAcyclic": domain.assertAcyclic(vector.input.tasks, vector.input.edges); return "verified";
    case "contextManifestCoreDigest": return domain.contextManifestCoreDigest(vector.input);
    case "attemptContextBindingDigest": return domain.attemptContextBindingDigest(vector.input);
    case "bindContext": return domain.bindContext(vector.input.core, vector.input.binding);
    case "sealAttemptReceipt": return domain.sealAttemptReceipt(vector.input);
    case "verifyAttemptReceipt": domain.verifyAttemptReceipt(vector.input); return "verified";
    case "checkpointCoreDigest": return domain.checkpointCoreDigest(vector.input);
    case "verifyCheckpointReceipt": domain.verifyCheckpointReceipt(vector.input.envelope, vector.input.trust, vector.input.trustedNow, vector.input.production); return "verified";
    case "reduceTaskLifecycle": return domain.reduceTaskLifecycle(vector.input.state, vector.input.transition);
    case "completionPolicySatisfied": return domain.completionPolicySatisfied(vector.input.policy, new Set(vector.input.durablePredicateIds));
    case "resolveTask": return domain.resolveTask(vector.input);
    case "reduceDispatch": return domain.reduceDispatch(vector.input.state, vector.input.transition);
    case "reduceDispatchSequence": return vector.input.transitions.reduce((state, transition) => domain.reduceDispatch(state, transition), vector.input.state);
    case "scheduleRetry": return domain.scheduleRetry(vector.input);
    case "authorizeDuplicateRiskGeneration": return domain.authorizeDuplicateRiskGeneration(vector.input);
    case "noPolicyDecision": return domain.noPolicyDecision();
    case "combinePolicyDecisions": return domain.combinePolicyDecisions(vector.input.pinned, vector.input.current);
    case "approvalIsValid": return domain.approvalIsValid(vector.input.binding, vector.input.authorityTime, vector.input.expected);
    case "authorizeCommand": return domain.authorizeCommand(vector.input);
    default: throw new Error(`unsupported vector action: ${vector.action}`);
    case "eventGenesisReplay": {
      const workspace = domain.createWorkspaceGenesis({ workspaceId: "ws", authorityPrincipalId: "authority", initialGrantDigest: "grant", authorityConsumptionMarker: "marker", activePolicyDigest: domain.NO_POLICY_DIGEST, commandId: "workspace-command" });
      const run = domain.createRunGenesis({ observationCursor: { ...workspace.resultCursor, kind: "absent-run-genesis", runId: "run", expectedRunHead: "absent" }, initialDocument: { items: [] }, principalId: "authority", commandId: "run-command" });
      return domain.deterministicReplay([run.event]);
    }
    case "eventReplayCorruption": {
      const workspace = domain.createWorkspaceGenesis({ workspaceId: "ws", authorityPrincipalId: "authority", initialGrantDigest: "grant", authorityConsumptionMarker: "marker", activePolicyDigest: domain.NO_POLICY_DIGEST, commandId: "workspace-command" });
      const run = domain.createRunGenesis({ observationCursor: { ...workspace.resultCursor, kind: "absent-run-genesis", runId: "run", expectedRunHead: "absent" }, initialDocument: {}, principalId: "authority", commandId: "run-command" });
      run.event.envelope.payloadHash = "substituted";
      return domain.deterministicReplay([run.event]);
    }
    case "forkScenario": {
      const snapshot = domain.sealDependencyJoinSnapshot({ schemaVersion: "1", runId: "run", taskId: "task", taskContractDigest: "contract", joinEvaluationId: "join", joinObservationCursor: cursor, dependencies: [], schedulability: "ready", reasonCodes: [] });
      const core = { schemaVersion: "1", forkId: "fork", pinVersion: 1, workspaceId: "ws", runId: "run", parentForkPinDigest: null, refreshesForkPinDigest: null, canonicalRevision: 0, canonicalStateHash: "state", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sourceObservationCursor: cursor, sourceContextVersion: contextVersion, dependencyJoinSnapshotDigest: snapshot.digest, deltaAuthorityScopeDigest: "scope", pinnedPolicyDigest: domain.NO_POLICY_DIGEST, createdByPrincipalId: "principal", createdByGrantDigest: "grant" };
      const pin = domain.createForkPin(core, null);
      if (vector.input === "create") return pin;
      if (vector.input === "refresh") return domain.refreshForkPin(pin, { schemaVersion: "1", canonicalRevision: 1, canonicalStateHash: "next", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sourceObservationCursor: cursor, sourceContextVersion: contextVersion, dependencyJoinSnapshotDigest: snapshot.digest, deltaAuthorityScopeDigest: "scope", pinnedPolicyDigest: domain.NO_POLICY_DIGEST, createdByPrincipalId: "principal", createdByGrantDigest: "grant" });
      return domain.createForkPin({ ...core, pinVersion: 2, parentForkPinDigest: pin.forkPinDigest, refreshesForkPinDigest: pin.forkPinDigest }, null);
    }
    case "contextScenario": {
      const core = { schemaVersion: "1", workspaceId: "ws", runId: "run", attemptId: "attempt", generation: 1, forkPinDigest: "pin", sourceObservationCursor: cursor, sourceContextVersion: contextVersion, authorizationObservationCursor: cursor, authorizationContextVersion: contextVersion, authorizationOverlayV1: { policyDigest: domain.NO_POLICY_DIGEST, grantDigest: "grant", quotaDigest: "quota", result: "allowed" }, canonicalRevision: 0, canonicalStateHash: "state", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sources: [], rendererVersion: "renderer-v1", omissions: [], selectedBytes: 0, byteBudget: 10, tokenizerMetadata: null, renderedOutputDigest: "output" };
      const binding = { schemaVersion: "1", attemptId: vector.input === "mismatch" ? "other" : "attempt", generation: 1, forkPinDigest: "pin", sourceObservationCursor: cursor, sourceContextVersion: contextVersion, authorizationObservationCursor: cursor, authorizationContextVersion: contextVersion, providerIdempotencyKey: "provider-key", expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: "adapter", allowedProducerGrantDigest: "grant" };
      return domain.bindContext(core, binding);
    }
    case "receiptScenario": {
      const core = { schemaVersion: "1", workspaceId: "ws", runId: "run", taskId: "task", attemptId: "attempt", generation: 1, attemptContextBindingDigest: "binding", contextManifestCoreDigest: "manifest", forkPinDigest: "pin", providerId: "provider", providerOperationId: "operation", providerIdempotencyKeyDigest: "key", producerPrincipalId: "adapter", producerGrantDigest: "grant", adapterId: "adapter", adapterVersion: "1", hostId: "host", hostVersion: "1", outcome: vector.input === "failed" ? "failed" : "succeeded", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", evidence: vector.input === "failed" ? [{ digest: "evidence", mediaType: "text/plain", size: 1 }] : [] };
      const receipt = domain.sealAttemptReceipt(core);
      if (vector.input === "mutated") return domain.verifyAttemptReceipt({ ...receipt, producerGrantDigest: "substituted" });
      domain.verifyAttemptReceipt(receipt);
      return receipt;
    }
    case "taskDispatchScenario": {
      switch (vector.input) {
        case "success": return domain.reduceDispatch(domain.reduceDispatch(attemptState(), { type: "commit-launch-intent" }), { type: "terminal-receipt", outcome: "succeeded", eventSequence: 7, handle: "handle" });
        case "illegal": return domain.reduceDispatch(attemptState(), { type: "acknowledge" });
        case "late": return domain.reduceDispatch(attemptState("succeeded"), { type: "terminal-receipt", outcome: "failed", eventSequence: 8 });
        case "cancel-race": return domain.reduceDispatch({ ...attemptState(), state: "cancel_requested" }, { type: "terminal-receipt", outcome: "succeeded", eventSequence: 7 });
        case "ambiguous": return domain.reduceDispatch({ ...attemptState(), state: "reconciliation_required" }, { type: "reconcile-ambiguous" });
        case "duplicate": return domain.authorizeDuplicateRiskGeneration({ prior: { ...attemptState(), state: "unknown_outcome" }, newBindingDigest: "binding-2", newIdempotencyKeyDigest: "key-2" });
        case "retry": return domain.scheduleRetry({ attemptId: "attempt", priorGeneration: 1, retryOrdinal: 1, retryPolicyDigest: "policy", notBefore: "2026-01-01T00:00:00Z", pinDecision: "reuse", forkPinDigest: "pin", reason: "failed", providerIdempotencyKeyDigest: "key-2", prior: { ...attemptState("failed"), terminalEventSequence: 7 } });
      }
      throw new Error("unknown task dispatch scenario");
    }
    case "checkpointSignatureScenario": {
      const core = { receiptVariant: "ordinary-v1", subject: "C02", attemptGeneration: 1, claimId: "claim", dependencyReceiptDigests: [], workerBaseSha: "base", workerCandidateSha: "candidate", candidateIntegrationSha: "integration", candidateTree: "tree", acceptanceContractVersion: "v1", commandResults: [], sealedAt: "2026-01-01T00:00:00Z", attestedAt: "2026-01-01T00:00:01Z", expiresAt: null, supersedesReceiptDigest: null, evidence: {}, ciIdentity: null, sideEffectHead: null };
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const coreDigest = domain.checkpointCoreDigest(core);
      const signature = sign(null, Buffer.from(`horseness.checkpoint-receipt-signature.v1\0${coreDigest}`), privateKey).toString("base64");
      const signatureRecord = { signatureVersion: "1", algorithm: "Ed25519", keyId: "key", principalId: "principal", signedDigest: coreDigest, signatureBase64: vector.input === "substitution" ? Buffer.alloc(64).toString("base64") : signature };
      const envelopeWithoutDigest = { recordType: "CheckpointReceiptEnvelopeV1", schemaVersion: "1", core, coreDigest, signature: signatureRecord };
      const envelope = { ...envelopeWithoutDigest, envelopeDigest: domain.checkpointEnvelopeDigest(envelopeWithoutDigest) };
      const spki = publicKey.export({ format: "der", type: "spki" });
      const trust = { schemaVersion: "1", keys: [{ keyId: "key", principalId: "principal", publicKeySpkiBase64: spki.toString("base64"), spkiSha256: domain.sha256Hex(spki), notBefore: "2025-01-01T00:00:00Z", notAfter: "2027-01-01T00:00:00Z", revokedAt: null, subjects: ["C02"], variants: ["ordinary-v1"], fixtureOnly: true }] };
      domain.verifyCheckpointReceipt(envelope, trust, "2026-01-01T00:00:02Z", false);
      return "verified";
    }
  }
};

export function verifyVector(vector, family, file = "<memory>") {
  if (vector.schemaVersion !== "2" || vector.familyVersion !== "1" || vector.family !== family || typeof vector.case !== "string" || typeof vector.action !== "string" || !("input" in vector) || (!("expected" in vector) && typeof vector.expectedError !== "string")) throw new Error(`invalid vector schema: ${family}/${file}`);
  try {
    const executed = executeVector(vector);
    const actual = Array.isArray(vector.select) ? vector.select.reduce((value, key) => value?.[key], executed) : executed;
    if (vector.expectedError) throw new Error(`expected ${vector.expectedError}, action succeeded`);
    if (domain.canonicalJson(actual) !== domain.canonicalJson(vector.expected)) throw new Error(`result mismatch: expected ${domain.canonicalJson(vector.expected)}, received ${domain.canonicalJson(actual)}`);
  } catch (error) {
    if (!vector.expectedError || !(error instanceof domain.DomainError) || error.code !== vector.expectedError) throw error;
  }
}

export function verifyFamilies(requested) {
  if (requested.length === 0) throw new Error("at least one vector family is required");
  let count = 0;
  for (const family of requested) {
    if (!VECTOR_FAMILIES.includes(family)) throw new Error(`invalid or uncontracted family: ${family}`);
    const directory = resolve(root, family);
    if (!directory.startsWith(`${root}/`) || !statSync(directory).isDirectory()) throw new Error(`missing vector family: ${family}`);
    const files = readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
    if (files.length === 0) throw new Error(`empty vector family: ${family}`);
    for (const file of files) {
      verifyVector(JSON.parse(readFileSync(resolve(directory, file), "utf8")), family, file);
      count += 1;
    }
  }
  return count;
}

const requested = process.argv.slice(2).filter((value) => value !== "--");
if (requested.length > 0) {
  const count = verifyFamilies(requested);
  console.log(`verified ${count} cases across ${requested.length} vector families: ${requested.join(", ")}`);
}
