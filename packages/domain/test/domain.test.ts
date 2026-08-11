import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_POLICY_DIGEST, applyDelta, approvalIsValid, assertAcyclic, authorizeCommand, bindContext, canonicalJson, combinePolicyDecisions, completionPolicySatisfied, completionPredicateIdentity, contextManifestCoreDigest, createRunGenesis, createWorkspaceGenesis, deltaAuthorityScopeDigest, deriveSchedulability, deterministicReplay, domainDigest, intersectScopes, jsonValueDigest, noPolicyDecision, reduceCanonicalDocument, reduceDispatch, reduceOperationalState, reduceWorkspaceState, resolveTask, scopeContains, sealAttemptReceipt, sealDependencyJoinSnapshot, sealEventEnvelope, sealForkPin, sealProposal, verifyAttemptReceipt, verifyEventChain, verifyProposal,
  type AttemptGenerationStateV1, type CompositeCursorV1, type ContextManifestCoreV1, type DeltaAuthorityScopeV1, type ForkPinCoreV1, type HashedEventEnvelopeV1, type PolicyDecisionV1, type ProposalEnvelopeCoreV1
} from "../src/index.js";

const composite: CompositeCursorV1 = { schemaVersion: "1", kind: "composite", workspaceId: "ws", workspaceSequence: 1, workspaceEnvelopeHash: "a".repeat(64), workspaceContextEpoch: 0, runId: "run", runSequence: 1, runEnvelopeHash: "b".repeat(64), runContextEpoch: 0 };
const scope: DeltaAuthorityScopeV1 = { schemaVersion: "1", workspaceId: "ws", runId: "run", taskId: "task", roots: ["/items", "/meta"] };

test("canonical JSON sorts keys, preserves arrays, normalizes negative zero and rejects non-finite", () => {
  assert.equal(canonicalJson({ z: -0, a: [3, { y: true, x: null }] }), '{"a":[3,{"x":null,"y":true}],"z":0}');
  assert.throws(() => canonicalJson({ bad: Number.NaN }), /INVALID_JSON_VALUE/);
});
test("workspace and run genesis are deterministic and chained independently", () => {
  const workspace = createWorkspaceGenesis({ workspaceId: "ws", authorityPrincipalId: "p", initialGrantDigest: "g", authorityConsumptionMarker: "used", activePolicyDigest: NO_POLICY_DIGEST, commandId: "cmd-w" });
  const run = createRunGenesis({ observationCursor: { ...workspace.resultCursor, kind: "absent-run-genesis", runId: "run", expectedRunHead: "absent" }, initialDocument: { items: [] }, principalId: "p", commandId: "cmd-r" });
  assert.equal(workspace.event.envelope.sequence, 1); assert.equal(run.event.envelope.sequence, 1); assert.equal(run.resultCursor.workspaceEnvelopeHash, workspace.event.envelopeHash); verifyEventChain([run.event]);
});
test("delta applies object add, array insert/append and ordered preconditions", () => {
  const base = { items: ["a"], meta: {} };
  const result = applyDelta(base, [
    { op: "add", path: "/meta/name", expectedParentDigest: jsonValueDigest({}), value: "demo" },
    { op: "add", path: "/items/1", expectedParentDigest: jsonValueDigest(["a"]), value: "b" },
    { op: "replace", path: "/items/0", expectedValueDigest: jsonValueDigest("a"), value: "A" }
  ], scope);
  assert.equal(result.outcome, "accepted"); if (result.outcome === "accepted") assert.deepEqual(result.document, { items: ["A", "b"], meta: { name: "demo" } });
});
test("delta enforces conflict, overlap, root and scope reason semantics", () => {
  assert.deepEqual(applyDelta({ items: [] }, [{ op: "remove", path: "", expectedValueDigest: jsonValueDigest({ items: [] }) }], { ...scope, roots: [""] }), { outcome: "rejected", reason: "ROOT_REMOVE_FORBIDDEN" });
  assert.deepEqual(applyDelta({ items: [] }, [{ op: "replace", path: "/items", expectedValueDigest: "bad", value: [] }], scope), { outcome: "conflicted", reason: "VALUE_DIGEST_MISMATCH" });
  assert.deepEqual(applyDelta({ a: { b: 1 } }, [{ op: "replace", path: "/a", expectedValueDigest: jsonValueDigest({ b: 1 }), value: {} }, { op: "remove", path: "/a/b", expectedValueDigest: jsonValueDigest(1) }], { ...scope, roots: [""] }), { outcome: "rejected", reason: "OVERLAPPING_WRITE_TARGET" });
  assert.deepEqual(applyDelta({ private: 1 }, [{ op: "replace", path: "/private", expectedValueDigest: jsonValueDigest(1), value: 2 }], scope), { outcome: "rejected", reason: "SCOPE_ESCAPE" });
});
test("scope containment is pointer-segment aware and intersection only narrows", () => {
  assert.equal(scopeContains(scope, "/items/0"), true); assert.equal(scopeContains(scope, "/itemset"), false);
  assert.deepEqual(intersectScopes(scope, { ...scope, roots: ["/items/0"] }).roots, ["/items/0"]);
  assert.equal(deltaAuthorityScopeDigest({ ...scope, roots: ["/meta", "/items", "/items"] }), deltaAuthorityScopeDigest(scope));
});
test("proposal identity is solely digest-derived and sealed collections normalize", () => {
  const core: ProposalEnvelopeCoreV1 = { schemaVersion: "1", workspaceId: "ws", runId: "run", authorPrincipalId: "worker", authorGrantDigest: "grant", attemptId: "attempt", receiptDigests: ["r2", "r1"], forkPinDigest: "pin", deltaAuthorityScopeDigest: deltaAuthorityScopeDigest(scope), baseRevision: 0, baseStateHash: "state", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", proposalSealingObservationCursor: composite, proposalSealingContextVersion: { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 0, runContextEpoch: 0, observationCursor: composite }, operations: [{ op: "replace", path: "/items", expectedValueDigest: jsonValueDigest([]), value: [1] }], evidenceClaims: [{ digest: "z", claim: "z" }, { digest: "a", claim: "a" }], pinnedPolicyDigest: NO_POLICY_DIGEST, currentPolicyDigest: NO_POLICY_DIGEST, nonce: "n", predecessorProposalDigest: null, predecessorReason: null };
  const proposal = sealProposal(core); verifyProposal(proposal); assert.match(proposal.proposalId, /^prp_[a-z2-7]+$/); assert.throws(() => verifyProposal({ ...proposal, proposalId: "prp_bad" }), /PROPOSAL_ID_MISMATCH/);
});
test("dependency snapshots and fork pins are immutable, sorted and lineage checked", () => {
  const snapshot = sealDependencyJoinSnapshot({ schemaVersion: "1", runId: "run", taskId: "t", taskContractDigest: "tc", joinEvaluationId: "j", joinObservationCursor: composite, dependencies: [{ edgeId: "e2", edgeType: "requires_success", sourceTaskId: "b", taskResolutionEventSequence: 3, taskResolutionDigest: "d2", winningGeneration: 1 }, { edgeId: "e1", edgeType: "requires_terminal", sourceTaskId: "a", taskResolutionEventSequence: 2, taskResolutionDigest: "d1", winningGeneration: null }], schedulability: "ready", reasonCodes: [] });
  const core: ForkPinCoreV1 = { schemaVersion: "1", forkId: "fork", pinVersion: 1, workspaceId: "ws", runId: "run", parentForkPinDigest: null, refreshesForkPinDigest: null, canonicalRevision: 0, canonicalStateHash: "state", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sourceObservationCursor: composite, sourceContextVersion: { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 0, runContextEpoch: 0, observationCursor: composite }, dependencyJoinSnapshotDigest: snapshot.digest, deltaAuthorityScopeDigest: deltaAuthorityScopeDigest(scope), pinnedPolicyDigest: NO_POLICY_DIGEST, ancestry: [], createdByPrincipalId: "p", createdByGrantDigest: "g" };
  const pin = sealForkPin(core); assert.match(pin.forkPinId, /^fpk_/); assert.throws(() => sealForkPin({ ...core, pinVersion: 2, parentForkPinDigest: pin.forkPinDigest, refreshesForkPinDigest: pin.forkPinDigest, ancestry: [] }), /invalid fork ancestry/);
});
test("manifest and binding construction is acyclic and mutation-sensitive", () => {
  const version = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 0, runContextEpoch: 0, observationCursor: composite } as const;
  const manifest: ContextManifestCoreV1 = { schemaVersion: "1", workspaceId: "ws", runId: "run", attemptId: "a", generation: 1, forkPinDigest: "pin", sourceObservationCursor: composite, sourceContextVersion: version, authorizationObservationCursor: composite, authorizationContextVersion: version, authorizationOverlayV1: { policyDigest: NO_POLICY_DIGEST, grantDigest: "g", quotaDigest: "q", result: "allowed" }, canonicalRevision: 0, canonicalStateHash: "s", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sources: [], rendererVersion: "r1", omissions: [], selectedBytes: 0, byteBudget: 100, tokenizerMetadata: null, renderedOutputDigest: domainDigest("output", "") };
  const record = bindContext(manifest, { schemaVersion: "1", attemptId: "a", generation: 1, forkPinDigest: "pin", sourceObservationCursor: composite, sourceContextVersion: version, authorizationObservationCursor: composite, authorizationContextVersion: version, providerIdempotencyKey: "key", expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: "adapter", allowedProducerGrantDigest: "g" });
  assert.equal(record.contextManifestCoreDigest, contextManifestCoreDigest(manifest)); assert.notEqual(record.contextManifestCoreDigest, record.attemptContextBindingDigest);
  assert.notEqual(contextManifestCoreDigest({ ...manifest, byteBudget: 101 }), record.contextManifestCoreDigest);
});
test("no-policy is neutral and conjunctive precedence is stable", () => {
  const accepted = noPolicyDecision(); const rejected: PolicyDecisionV1 = { result: "rejected", constraints: ["x"], explanations: [{ policyDigest: "p", ruleId: "R", subject: "s", result: "rejected" }] };
  assert.equal(combinePolicyDecisions(accepted, rejected).result, "rejected"); assert.equal(NO_POLICY_DIGEST, domainDigest("horseness.policy.v1", { schemaVersion: "1", kind: "no-policy", rules: [] }));
});
test("approval expiry equality is expired and policy substitution invalidates", () => {
  const binding = { schemaVersion: "1", approvalId: "a", proposalDigest: "p", baseRevision: 0, baseStateHash: "s", pinnedPolicyDigest: "one", currentPolicyDigest: "two", approverPrincipalId: "x", approverGrantDigest: "g", allowedAction: "accept", issueObservationCursor: composite, evaluationObservationCursor: composite, issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T01:00:00Z" } as const;
  assert.equal(approvalIsValid(binding, binding.expiresAt, binding), false); assert.equal(approvalIsValid(binding, "2026-01-01T00:30:00Z", { ...binding, currentPolicyDigest: "changed" }), false);
});
test("authorization is exhaustive, scoped, stale-aware and user-presence gated", () => {
  const capability = { schemaVersion: "1", workspaceId: "ws", commands: ["dispatch", "duplicate-risk-launch"], issuer: "authority", delegatee: "operator", issuedObservationSequence: 1, expiresObservationSequence: 10, nonce: "n", revocationSequence: null } as const;
  assert.deepEqual(authorizeCommand({ role: "operator", command: "dispatch", capability: { ...capability, commands: [...capability.commands] }, workspaceId: "ws", observationSequence: 2, grantDigest: "g", expectedGrantDigest: "g" }), { allowed: true });
  assert.equal(authorizeCommand({ role: "operator", command: "duplicate-risk-launch", capability: { ...capability, commands: [...capability.commands] }, workspaceId: "ws", observationSequence: 2, grantDigest: "g", expectedGrantDigest: "g" }).allowed, false);
});
test("task graph rejects cycles and schedulability remains derived", () => {
  assert.throws(() => assertAcyclic(["a", "b"], [{ edgeId: "1", sourceTaskId: "a", dependentTaskId: "b", edgeType: "requires_success", releasePredicate: "task-resolution", propagateCancellation: false }, { edgeId: "2", sourceTaskId: "b", dependentTaskId: "a", edgeType: "requires_success", releasePredicate: "task-resolution", propagateCancellation: false }]), /DEPENDENCY_CYCLE/);
  assert.equal(deriveSchedulability({ lifecycle: "active", contractValid: true, dependenciesSatisfied: true, hasUnknownDependency: false, authorizationAllowed: true, quotaAllowed: true, liveAttempt: false, unknownOutcome: false }), "ready");
});
test("completion policies require durable predicate identities", () => {
  const predicate = { kind: "canonical-change", proposalDigest: "p", acceptedEventDigest: "e", resultingRevision: 1, resultingStateHash: "s" } as const;
  const ids = new Set([completionPredicateIdentity(predicate)]); assert.equal(completionPolicySatisfied({ schemaVersion: "1", kind: "all", predicates: [{ kind: "receipt-only" }, predicate] }, ids), false); ids.add(completionPredicateIdentity({ kind: "receipt-only" })); assert.equal(completionPolicySatisfied({ schemaVersion: "1", kind: "all", predicates: [{ kind: "receipt-only" }, predicate] }, ids), true);
});
test("dispatch accepts first post-intent receipt and handles cancellation/unknown races", () => {
  const initial: AttemptGenerationStateV1 = { attemptId: "a", generation: 1, state: "planned", bindingDigest: "b", idempotencyKeyDigest: "k", providerHandle: null, terminalEventSequence: null, findingCodes: [] };
  const intent = reduceDispatch(initial, { type: "commit-launch-intent" }); const done = reduceDispatch(intent, { type: "terminal-receipt", outcome: "succeeded", eventSequence: 4, handle: "h" }); assert.equal(done.state, "succeeded"); assert.equal(done.providerHandle, "h");
  const unknown = reduceDispatch(reduceDispatch(intent, { type: "require-reconciliation" }), { type: "reconcile-ambiguous" }); assert.equal(reduceDispatch(unknown, { type: "terminal-receipt", outcome: "failed", eventSequence: 5 }).state, "failed");
});
test("task arbitration uses earliest success event and waits for unknown/live generations", () => {
  const generation = (number: number, state: AttemptGenerationStateV1["state"], sequence: number | null): AttemptGenerationStateV1 => ({ attemptId: "a", generation: number, state, bindingDigest: "b", idempotencyKeyDigest: `k${number}`, providerHandle: null, terminalEventSequence: sequence, findingCodes: [] });
  const resolved = resolveTask({ taskId: "t", generations: [generation(1, "succeeded", 9), generation(2, "succeeded", 8)], retryPolicyDigest: "r", retryPermitted: false, cancellationRequested: false, observationCursor: composite }); assert.equal(resolved?.winningGeneration, 2);
  assert.equal(resolveTask({ taskId: "t", generations: [generation(1, "unknown_outcome", null)], retryPolicyDigest: "r", retryPermitted: false, cancellationRequested: false, observationCursor: composite }), null);
});
test("attempt receipts sort evidence, derive identity and detect substitution", () => {
  const receipt = sealAttemptReceipt({ schemaVersion: "1", workspaceId: "ws", runId: "run", taskId: "t", attemptId: "a", generation: 1, attemptContextBindingDigest: "b", contextManifestCoreDigest: "m", forkPinDigest: "f", providerId: "provider", providerOperationId: "operation", providerIdempotencyKeyDigest: "k", producerPrincipalId: "adapter", producerGrantDigest: "g", adapterId: "adapter", adapterVersion: "1", hostId: "host", hostVersion: "1", outcome: "succeeded", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", outputDigest: "o", evidence: [{ digest: "z", mediaType: "text/plain", size: 1 }, { digest: "a", mediaType: "text/plain", size: 1 }], provenance: {}, nonce: "n" });
  verifyAttemptReceipt(receipt); assert.deepEqual(receipt.evidence.map((item) => item.digest), ["a", "z"]); assert.throws(() => verifyAttemptReceipt({ ...receipt, outputDigest: "changed" }), /RECEIPT_MISMATCH/);
});
test("canonical reducer enforces identity, monotonicity and immutable documents", () => {
  const initial = { nested: { n: 0 } }; const genesis = reduceCanonicalDocument(null, { eventType: "RunCreatedV1", sequence: 1, workspaceId: "ws", runId: "run", initialDocument: initial });
  const final = { nested: { n: 1 } }; const accepted = reduceCanonicalDocument(genesis, { eventType: "DeltaAcceptedV1", sequence: 3, workspaceId: "ws", runId: "run", proposalId: "p", resultingDocument: final, priorStateHash: genesis.stateHash, resultingStateHash: domainDigest("horseness.canonical-document.v1", final) });
  assert.equal(accepted.revision, 1); assert.notEqual(genesis.document, initial); assert.notEqual(accepted, genesis); initial.nested.n = 99; final.nested.n = 99; assert.deepEqual(genesis.document, { nested: { n: 0 } }); assert.deepEqual(accepted.document, { nested: { n: 1 } });
  assert.throws(() => reduceCanonicalDocument(accepted, { eventType: "DeltaAcceptedV1", sequence: 3, workspaceId: "ws", runId: "run", proposalId: "p2", resultingDocument: final, priorStateHash: accepted.stateHash, resultingStateHash: accepted.stateHash }), /EVENT_SEQUENCE_INVALID/);
  assert.throws(() => reduceCanonicalDocument(genesis, { eventType: "DeltaAcceptedV1", sequence: 2, workspaceId: "other", runId: "run", proposalId: "p", resultingDocument: final, priorStateHash: genesis.stateHash, resultingStateHash: domainDigest("horseness.canonical-document.v1", final) }), /AGGREGATE_IDENTITY_MISMATCH/);
});
test("workspace and run operational reducers are exhaustive, monotonic and immutable", () => {
  const workspace = reduceWorkspaceState(null, { eventType: "WorkspaceCreatedV1", sequence: 1, workspaceId: "ws", authorityPrincipalId: "authority", initialGrantDigest: "grant", authorityConsumptionMarker: "used", activePolicyDigest: "policy-1" });
  const changed = reduceWorkspaceState(workspace, { eventType: "PolicyReferenceChangedV1", sequence: 2, workspaceId: "ws", activePolicyDigest: "policy-2" });
  assert.equal(workspace.activePolicyDigest, "policy-1"); assert.equal(changed.activePolicyDigest, "policy-2"); assert.throws(() => reduceWorkspaceState(changed, { eventType: "PolicyReferenceChangedV1", sequence: 2, workspaceId: "ws", activePolicyDigest: "policy-3" }), /EVENT_SEQUENCE_INVALID/);
  const run = reduceOperationalState(null, { eventType: "RunCreatedV1", sequence: 1, workspaceId: "ws", runId: "run" }); const submitted = reduceOperationalState(run, { eventType: "ProposalSubmittedV1", sequence: 2, workspaceId: "ws", runId: "run", proposalId: "p" });
  assert.deepEqual(run.proposals, {}); assert.deepEqual(submitted.proposals, { p: "submitted" }); assert.throws(() => reduceOperationalState(submitted, { eventType: "ForkCreatedV1", sequence: 3, workspaceId: "ws", runId: "other" }), /AGGREGATE_IDENTITY_MISMATCH/);
});
function replayChain(): HashedEventEnvelopeV1<unknown>[] {
  const initial = { n: 0 }; const final = { n: 1 }; const state0 = domainDigest("horseness.canonical-document.v1", initial); const state1 = domainDigest("horseness.canonical-document.v1", final);
  const payloads = [
    { eventType: "RunCreatedV1", workspaceId: "ws", runId: "run", initialDocument: initial, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1" },
    { eventType: "ProposalSubmittedV1", proposalId: "p" },
    { eventType: "DeltaAcceptedV1", proposalId: "p", priorStateHash: state0, resultingStateHash: state1, resultingDocument: final }
  ];
  const result: HashedEventEnvelopeV1<unknown>[] = []; let priorEnvelopeHash: string | null = null;
  for (let index = 0; index < payloads.length; index += 1) { const payload = payloads[index]!; const item: HashedEventEnvelopeV1<unknown> = sealEventEnvelope({ schemaVersion: "1", streamKind: "run", workspaceId: "ws", streamId: "run", sequence: index + 1, eventId: String(index + 1), eventType: payload.eventType, principalId: "p", causationId: "c", correlationId: "c", idempotencyKey: String(index + 1), priorEnvelopeHash, payload }); result.push(item); priorEnvelopeHash = item.envelopeHash; }
  return result;
}
test("authenticated replay is deterministic and rejects chain attacks", () => {
  const chain = replayChain(); const replay = deterministicReplay(chain); assert.equal(canonicalJson(replay as never), canonicalJson(deterministicReplay(chain) as never));
  const corrupt = structuredClone(chain); corrupt[1]!.envelope.payload = { eventType: "ProposalSubmittedV1", proposalId: "mutated" }; assert.throws(() => deterministicReplay(corrupt), /EVENT_PAYLOAD_HASH_INVALID/);
  assert.throws(() => deterministicReplay([chain[0]!, chain[2]!]), /EVENT_CHAIN_INVALID/);
  assert.throws(() => deterministicReplay([chain[1]!, chain[0]!, chain[2]!]), /EVENT_CHAIN_INVALID/);
  assert.throws(() => deterministicReplay([...chain, chain[2]!]), /EVENT_CHAIN_INVALID/);
  const splice = replayChain(); const { payloadHash: _splicePayloadHash, ...spliceEnvelope } = splice[1]!.envelope; splice[1] = sealEventEnvelope({ ...spliceEnvelope, workspaceId: "other" }); assert.throws(() => deterministicReplay(splice), /EVENT_IDENTITY_INVALID/);
});
test("replay rejects unsupported versions, invalid genesis and malformed events", () => {
  const chain = replayChain(); const version = structuredClone(chain); version[0]!.envelope.schemaVersion = "2" as "1"; assert.throws(() => deterministicReplay(version), /EVENT_VERSION_UNSUPPORTED/);
  const unknownPayload = { eventType: "UnknownV1" }; const { payloadHash: _unknownPayloadHash, ...unknownEnvelope } = chain[1]!.envelope; const unknown = sealEventEnvelope({ ...unknownEnvelope, eventType: "UnknownV1", payload: unknownPayload }); assert.throws(() => deterministicReplay([chain[0]!, unknown]), /UNSUPPORTED_EVENT_TYPE/);
  const malformedPayload = { eventType: "RunCreatedV1", workspaceId: "ws", runId: "run", initialDocument: {}, canonicalizerVersion: "bad", hashVersion: "sha256-v1" }; const { payloadHash: _malformedPayloadHash, ...malformedEnvelope } = chain[0]!.envelope; const malformed = sealEventEnvelope({ ...malformedEnvelope, payload: malformedPayload }); assert.throws(() => deterministicReplay([malformed]), /MALFORMED_EVENT/);
});
