import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_POLICY_DIGEST, approvalIsValid, assertEvaluationClock, authorizeCommand, authorizeDuplicateRiskGeneration, bindContext, combinePolicyDecisions, createForkPin, deriveSchedulability, evaluateDependencies, reduceDispatch, reduceTaskLifecycle, refreshForkPin, resolveTask, scheduleRetry, sealDependencyJoinSnapshot,
  type AttemptGenerationStateV1, type CapabilityV1, type CompositeCursorV1, type ContextManifestCoreV1, type DependencyEdgeV1, type ForkPinCoreV1, type PolicyDecisionV1, type TaskResolution
} from "../src/index.js";

const cursor: CompositeCursorV1 = { schemaVersion: "1", kind: "composite", workspaceId: "ws", workspaceSequence: 2, workspaceEnvelopeHash: "a".repeat(64), workspaceContextEpoch: 1, runId: "run", runSequence: 4, runEnvelopeHash: "b".repeat(64), runContextEpoch: 2 };
const version = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 1, runContextEpoch: 2, observationCursor: cursor } as const;
const generation = (number: number, state: AttemptGenerationStateV1["state"], sequence: number | null = null): AttemptGenerationStateV1 => ({ attemptId: "attempt", generation: number, state, bindingDigest: `binding-${number}`, idempotencyKeyDigest: `key-${number}`, providerHandle: null, terminalEventSequence: sequence, findingCodes: [] });

function initialPinCore(): Omit<ForkPinCoreV1, "ancestry"> {
  return { schemaVersion: "1", forkId: "fork", pinVersion: 1, workspaceId: "ws", runId: "run", parentForkPinDigest: null, refreshesForkPinDigest: null, canonicalRevision: 0, canonicalStateHash: "state-0", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sourceObservationCursor: cursor, sourceContextVersion: version, dependencyJoinSnapshotDigest: "join", deltaAuthorityScopeDigest: "scope", pinnedPolicyDigest: NO_POLICY_DIGEST, createdByPrincipalId: "authority", createdByGrantDigest: "grant" };
}

test("task lifecycle is closed and illegal or unknown transitions fail closed", () => {
  assert.equal(reduceTaskLifecycle("draft", { type: "activate" }), "active");
  assert.equal(reduceTaskLifecycle("active", { type: "resolve", resolution: "succeeded" }), "succeeded");
  assert.throws(() => reduceTaskLifecycle("draft", { type: "resolve", resolution: "failed" }), /ILLEGAL_TASK_TRANSITION/);
  assert.throws(() => reduceTaskLifecycle("active", { type: "bogus" } as never), /ILLEGAL_TASK_TRANSITION/);
});

test("typed dependency joins cover acceptance-dependent release, mixed outcomes and cancellation", () => {
  const edges: DependencyEdgeV1[] = [
    { edgeId: "accepted", sourceTaskId: "proposal", dependentTaskId: "publish", edgeType: "requires_success", releasePredicate: "canonical-change:delta-accepted", propagateCancellation: false },
    { edgeId: "cleanup", sourceTaskId: "worker", dependentTaskId: "publish", edgeType: "requires_outcome", allowedOutcomes: ["succeeded", "cancelled"], releasePredicate: "task-resolution", propagateCancellation: true }
  ];
  const outcome = (edgeId: string, sourceTaskId: string, edgeType: DependencyEdgeV1["edgeType"], resolution: TaskResolution) => ({ edgeId, sourceTaskId, edgeType, resolution, taskResolutionEventSequence: 3, taskResolutionDigest: `${edgeId}-digest`, winningGeneration: resolution === "succeeded" ? 1 : null });
  const blocked = evaluateDependencies(edges, new Map([["accepted", outcome("accepted", "proposal", "requires_success", "failed")], ["cleanup", outcome("cleanup", "worker", "requires_outcome", "cancelled")]]));
  assert.deepEqual(blocked, { satisfied: false, unknown: false, cancellationPropagated: true, reasonCodes: ["CANCELLATION_PROPAGATED", "DEPENDENCY_UNSATISFIED"] });
  const ready = evaluateDependencies(edges, new Map([["accepted", outcome("accepted", "proposal", "requires_success", "succeeded")], ["cleanup", outcome("cleanup", "worker", "requires_outcome", "succeeded")]]));
  assert.equal(ready.satisfied, true);
  assert.equal(deriveSchedulability({ lifecycle: "active", contractValid: true, dependenciesSatisfied: true, hasUnknownDependency: false, authorizationAllowed: true, quotaAllowed: true, liveAttempt: false, unknownOutcome: false }), "ready");
  assert.equal(deriveSchedulability({ lifecycle: "active", contractValid: true, dependenciesSatisfied: false, hasUnknownDependency: true, authorizationAllowed: true, quotaAllowed: true, liveAttempt: false, unknownOutcome: false }), "blocked");
  const snapshot = sealDependencyJoinSnapshot({ schemaVersion: "1", runId: "run", taskId: "publish", taskContractDigest: "contract", joinEvaluationId: "join", joinObservationCursor: cursor, dependencies: [...ready.satisfied ? [...new Map([["accepted", outcome("accepted", "proposal", "requires_success", "succeeded")], ["cleanup", outcome("cleanup", "worker", "requires_outcome", "succeeded")]]).values()] : []].map(({ resolution: _resolution, ...item }) => item), schedulability: "ready", reasonCodes: [] });
  assert.deepEqual(snapshot.core.dependencies.map((item) => item.sourceTaskId), ["proposal", "worker"]);
});

test("fork refresh authenticates parent and derives complete oldest-first ancestry", () => {
  const first = createForkPin(initialPinCore(), null);
  const second = refreshForkPin(first, { ...initialPinCore(), canonicalRevision: 1, canonicalStateHash: "state-1", sourceObservationCursor: cursor, sourceContextVersion: version, dependencyJoinSnapshotDigest: "join-1", deltaAuthorityScopeDigest: "scope", pinnedPolicyDigest: NO_POLICY_DIGEST, createdByPrincipalId: "authority", createdByGrantDigest: "grant" });
  const third = refreshForkPin(second, { ...initialPinCore(), canonicalRevision: 2, canonicalStateHash: "state-2", sourceObservationCursor: cursor, sourceContextVersion: version, dependencyJoinSnapshotDigest: "join-2", deltaAuthorityScopeDigest: "scope", pinnedPolicyDigest: NO_POLICY_DIGEST, createdByPrincipalId: "authority", createdByGrantDigest: "grant" });
  assert.deepEqual(third.core.ancestry, [first.forkPinDigest, second.forkPinDigest]);
  assert.throws(() => refreshForkPin({ ...second, forkPinDigest: "substituted" }, { ...initialPinCore(), canonicalRevision: 2, canonicalStateHash: "state-2", sourceObservationCursor: cursor, sourceContextVersion: version, dependencyJoinSnapshotDigest: "join-2", deltaAuthorityScopeDigest: "scope", pinnedPolicyDigest: NO_POLICY_DIGEST, createdByPrincipalId: "authority", createdByGrantDigest: "grant" }), /FORK_PIN_AUTHENTICATION_FAILED/);
  assert.throws(() => createForkPin({ ...initialPinCore(), forkId: "fork", pinVersion: 9, parentForkPinDigest: first.forkPinDigest, refreshesForkPinDigest: first.forkPinDigest }, first), /FORK_REFRESH_CONTINUITY/);
});

test("context binding separates pinned source view from current authorization view", () => {
  const authorizationCursor = { ...cursor, workspaceSequence: 3, workspaceEnvelopeHash: "c".repeat(64), workspaceContextEpoch: 2 };
  const authorizationVersion = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 2, runContextEpoch: 2, observationCursor: authorizationCursor } as const;
  const manifest: ContextManifestCoreV1 = { schemaVersion: "1", workspaceId: "ws", runId: "run", attemptId: "attempt", generation: 1, forkPinDigest: "pin", sourceObservationCursor: cursor, sourceContextVersion: version, authorizationObservationCursor: authorizationCursor, authorizationContextVersion: authorizationVersion, authorizationOverlayV1: { policyDigest: NO_POLICY_DIGEST, grantDigest: "grant", quotaDigest: "quota", result: "allowed" }, canonicalRevision: 0, canonicalStateHash: "state", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sources: [], rendererVersion: "renderer", omissions: [], selectedBytes: 0, byteBudget: 100, tokenizerMetadata: null, renderedOutputDigest: "output" };
  const record = bindContext(manifest, { schemaVersion: "1", attemptId: "attempt", generation: 1, forkPinDigest: "pin", sourceObservationCursor: cursor, sourceContextVersion: version, authorizationObservationCursor: authorizationCursor, authorizationContextVersion: authorizationVersion, providerIdempotencyKey: "operation-1", expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: "adapter", allowedProducerGrantDigest: "grant" });
  assert.notEqual(record.contextManifestCoreDigest, record.attemptContextBindingDigest);
  assert.throws(() => bindContext(manifest, { schemaVersion: "1", attemptId: "attempt", generation: 1, forkPinDigest: "other-pin", sourceObservationCursor: cursor, sourceContextVersion: version, authorizationObservationCursor: authorizationCursor, authorizationContextVersion: authorizationVersion, providerIdempotencyKey: "operation-1", expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: "adapter", allowedProducerGrantDigest: "grant" }), /RECEIPT_MISMATCH/);
});

test("dispatch, cancellation and recovery races preserve terminal truth and findings", () => {
  const intent = reduceDispatch(generation(1, "planned"), { type: "commit-launch-intent" });
  const cancel = reduceDispatch(intent, { type: "request-cancel" });
  const racedSuccess = reduceDispatch(cancel, { type: "terminal-receipt", outcome: "succeeded", eventSequence: 5, handle: "provider-1" });
  assert.equal(racedSuccess.state, "succeeded");
  const lateCancel = reduceDispatch(racedSuccess, { type: "terminal-receipt", outcome: "cancelled", eventSequence: 6 });
  assert.deepEqual(lateCancel.findingCodes, ["CONFLICTING_LATE_TERMINAL_RECEIPT"]);
  const unknown = reduceDispatch(reduceDispatch(intent, { type: "require-reconciliation" }), { type: "reconcile-ambiguous" });
  assert.equal(reduceDispatch(unknown, { type: "manual-resolution", outcome: "failed", eventSequence: 7 }).state, "failed");
  assert.throws(() => reduceDispatch(generation(1, "planned"), { type: "terminal-receipt", outcome: "succeeded", eventSequence: 1 }), /RECEIPT_PRE_HANDOFF/);
  assert.throws(() => reduceDispatch(intent, { type: "bogus" } as never), /ILLEGAL_DISPATCH_TRANSITION/);
});

test("reconcile-found validates handles and evaluation clocks are observation-bound", () => {
  const reconciling = reduceDispatch(reduceDispatch(generation(1, "planned"), { type: "commit-launch-intent" }), { type: "require-reconciliation" });
  assert.throws(() => reduceDispatch(reconciling, { type: "reconcile-found", handle: "" }), /INVALID_PROVIDER_HANDLE/);
  const withHandle = reduceDispatch(reconciling, { type: "record-handle", handle: "provider-1" });
  const conflict = reduceDispatch(reduceDispatch(withHandle, { type: "require-reconciliation" }), { type: "reconcile-found", handle: "provider-2" });
  assert.deepEqual(conflict.findingCodes, ["CONFLICTING_PROVIDER_HANDLE"]);
  assert.doesNotThrow(() => assertEvaluationClock({ schemaVersion: "1", authorityTime: "2026-01-01T00:00:00Z", observationCursor: cursor }, cursor));
  assert.throws(() => assertEvaluationClock({ schemaVersion: "1", authorityTime: "invalid", observationCursor: cursor }, cursor), /INVALID_EVALUATION_CLOCK/);
  assert.throws(() => assertEvaluationClock({ schemaVersion: "1", authorityTime: "2026-01-01T00:00:00Z", observationCursor: { ...cursor, runSequence: 5 } }, cursor), /INVALID_EVALUATION_CLOCK/);
});

test("retry and duplicate-risk generations require terminal or explicitly unknown predecessors", () => {
  const retry = scheduleRetry({ attemptId: "attempt", priorGeneration: 1, prior: generation(1, "failed", 3), retryOrdinal: 1, retryPolicyDigest: "policy", notBefore: "2026-01-01T00:00:00Z", pinDecision: "reuse", forkPinDigest: "pin", reason: "transient", providerIdempotencyKeyDigest: "key-2" });
  assert.equal(retry.generation, 2);
  assert.throws(() => scheduleRetry({ attemptId: "attempt", priorGeneration: 1, prior: generation(1, "acknowledged"), retryOrdinal: 1, retryPolicyDigest: "policy", notBefore: "2026-01-01T00:00:00Z", pinDecision: "reuse", forkPinDigest: "pin", reason: "transient", providerIdempotencyKeyDigest: "key-2" }), /RETRY_NOT_PERMITTED/);
  const duplicate = authorizeDuplicateRiskGeneration({ prior: generation(1, "unknown_outcome"), newBindingDigest: "binding-2", newIdempotencyKeyDigest: "key-2" });
  assert.equal(duplicate.generation, 2); assert.deepEqual(duplicate.findingCodes, ["DUPLICATE_RISK_AUTHORIZED"]);
});

test("task arbitration handles duplicate successes, unknown outcomes and cancellation deterministically", () => {
  const success = resolveTask({ taskId: "task", generations: [generation(1, "succeeded", 8), generation(2, "succeeded", 7)], retryPolicyDigest: "retry", retryPermitted: false, cancellationRequested: true, observationCursor: cursor });
  assert.equal(success?.winningGeneration, 2); assert.equal(success?.resolution, "succeeded");
  assert.equal(resolveTask({ taskId: "task", generations: [generation(1, "failed", 3), generation(2, "unknown_outcome")], retryPolicyDigest: "retry", retryPermitted: false, cancellationRequested: true, observationCursor: cursor }), null);
  assert.equal(resolveTask({ taskId: "task", generations: [generation(1, "failed", 3), generation(2, "cancelled", 4)], retryPolicyDigest: "retry", retryPermitted: false, cancellationRequested: true, observationCursor: cursor })?.resolution, "cancelled");
});

test("policy conjunction, approval replacement and fully scoped capabilities fail closed", () => {
  const accepted: PolicyDecisionV1 = { result: "accepted", constraints: [], explanations: [] };
  const approval: PolicyDecisionV1 = { result: "approval_required", constraints: ["review"], explanations: [] };
  assert.equal(combinePolicyDecisions(accepted, approval).result, "approval_required");
  const binding = { schemaVersion: "1", approvalId: "approval", proposalDigest: "proposal", baseRevision: 1, baseStateHash: "state", pinnedPolicyDigest: "pinned", currentPolicyDigest: "current", approverPrincipalId: "approver", approverGrantDigest: "grant", allowedAction: "accept", issueObservationCursor: cursor, evaluationObservationCursor: cursor, issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T00:00:00Z" } as const;
  assert.equal(approvalIsValid(binding, "2026-01-01T12:00:00Z", binding), true);
  assert.equal(approvalIsValid(binding, "2026-01-01T12:00:00Z", { ...binding, currentPolicyDigest: "replacement" }), false);
  const capability: CapabilityV1 = { schemaVersion: "1", workspaceId: "ws", runId: "run", taskId: "task", attemptId: "attempt", generation: 1, commands: ["submit-receipt"], issuer: "authority", delegatee: "adapter", issuedObservationSequence: 2, expiresObservationSequence: 10, nonce: "nonce", revocationSequence: null };
  assert.deepEqual(authorizeCommand({ role: "adapter", command: "submit-receipt", capability: { ...capability, commands: [...capability.commands] }, workspaceId: "ws", runId: "run", taskId: "task", attemptId: "attempt", generation: 1, observationSequence: 3, grantDigest: "grant", expectedGrantDigest: "grant" }), { allowed: true });
  assert.deepEqual(authorizeCommand({ role: "adapter", command: "submit-receipt", capability: { ...capability, commands: [...capability.commands] }, workspaceId: "ws", runId: "run", taskId: "task", attemptId: "attempt", generation: 2, observationSequence: 3, grantDigest: "grant", expectedGrantDigest: "grant" }), { allowed: false, reason: "CAPABILITY_SCOPE_MISMATCH" });
});

