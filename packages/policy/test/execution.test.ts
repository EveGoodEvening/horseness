import assert from "node:assert/strict";
import test from "node:test";
import { NO_POLICY_V1, type CompositeCursorV1 } from "@horseness/domain";
import { evaluateExecutionPolicy, sealPolicyDocument, type ExecutionPolicyInputV1 } from "../src/index.js";

const cursor: CompositeCursorV1 = { schemaVersion: "1", kind: "composite", workspaceId: "workspace", workspaceSequence: 1, workspaceEnvelopeHash: "workspace-head", workspaceContextEpoch: 0, runId: "run", runSequence: 2, runEnvelopeHash: "run-head", runContextEpoch: 1 };
const base: ExecutionPolicyInputV1 = {
  schemaVersion: "1", intentDigest: "intent", action: "task.dispatch", paths: ["/tasks/task"], version: "1",
  pinnedPolicy: NO_POLICY_V1, currentPolicy: NO_POLICY_V1, evidence: [],
  evaluationClock: { schemaVersion: "1", authorityTime: "2026-10-06T00:00:00Z", observationCursor: cursor },
};

void test("execution cannot replace a pinned denial with a permissive current policy", () => {
  const pinned = sealPolicyDocument({ schemaVersion: "1", kind: "policy", policyId: "execution", revision: 0, predecessorDigest: null,
    rules: [{ ruleId: "deny-launch", subject: { action: "task.dispatch", pathPrefix: "/tasks", version: "1" }, effect: "rejected", constraints: [], evidence: [] }] });
  const result = evaluateExecutionPolicy({ ...base, pinnedPolicy: pinned });
  assert.equal(result.result, "rejected");
  assert.equal(result.pinnedPolicyDigest, pinned.policyDigest);
  assert.ok(result.explanations.some((item) => item.ruleId === "deny-launch" && item.result === "rejected"));
  assert.equal(evaluateExecutionPolicy({ ...base, currentPolicy: pinned, action: "task.breakdown" }).result, "accepted");
});

void test("execution approval requirements cannot be satisfied by a proposal-shaped bypass", () => {
  const current = sealPolicyDocument({ schemaVersion: "1", kind: "policy", policyId: "review", revision: 0, predecessorDigest: null,
    rules: [{ ruleId: "require-review", subject: { action: "task.dispatch", pathPrefix: null, version: null }, effect: "approval_required", constraints: [], evidence: [] }] });
  const input = { ...base, currentPolicy: current };
  assert.equal(evaluateExecutionPolicy(input).result, "approval_required");
  assert.throws(() => evaluateExecutionPolicy({ ...input, approval: { approved: true } } as unknown as ExecutionPolicyInputV1), /POLICY_INPUT_INVALID/);
});
