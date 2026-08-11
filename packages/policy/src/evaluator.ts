import {
  NO_POLICY_DIGEST,
  approvalIsValid,
  canonicalJson,
  combinePolicyDecisions,
  parseObservationCursorV1,
  type AdmissionResult,
  type ApprovalBindingV1,
  type CompositeCursorV1,
  type EvaluationClockV1,
  type PolicyDecisionV1,
  type PolicyExplanationV1,
} from "@horseness/domain";
import { DomainError } from "@horseness/domain";
import { parsePolicyDocumentV1, type PolicyDocumentV1, type PolicyRuleV1 } from "./lifecycle.js";

export interface PresentedEvidenceV1 { evidenceId: string; digest: string; path: string; version: string }
export interface SnapshotExpectationV1 {
  evaluationObservationCursor: CompositeCursorV1;
  expectedGrantDigest: string;
  observedGrantDigest: string;
  expectedQuotaDigest: string;
  observedQuotaDigest: string;
  quotaAvailable: boolean;
}
export interface AdmissionEvaluationInputV1 {
  schemaVersion: "1";
  proposalDigest: string;
  baseRevision: number;
  baseStateHash: string;
  action: string;
  paths: string[];
  version: string;
  pinnedPolicy: PolicyDocumentV1 | null;
  currentPolicy: PolicyDocumentV1 | null;
  evidence: PresentedEvidenceV1[];
  snapshots: SnapshotExpectationV1;
  evaluationClock: EvaluationClockV1;
  approval: ApprovalBindingV1 | null;
  preconditionConflict: string | null;
}
export interface AdmissionExplanationV1 extends PolicyExplanationV1 { code: string }
export interface AdmissionEvaluationV1 {
  schemaVersion: "1";
  result: AdmissionResult;
  constraints: string[];
  explanations: AdmissionExplanationV1[];
  pinnedPolicyDigest: string;
  currentPolicyDigest: string;
  evaluationObservationCursor: CompositeCursorV1;
  authorityTime: string;
}

const RESULT_RANK: Record<Exclude<AdmissionResult, "conflicted">, number> = { accepted: 0, approval_required: 1, quarantined: 2, rejected: 3 };
function fail(code: string): never { throw new DomainError(code); }
function exact(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const record = value as Record<string, unknown>; const actual = Object.keys(record).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return record;
}
function text(value: unknown, code: string): asserts value is string { if (typeof value !== "string" || value.length === 0) fail(code); }
function composite(value: unknown): CompositeCursorV1 { const cursor = parseObservationCursorV1(value); if (cursor.kind !== "composite") fail("POLICY_CURSOR_INVALID"); return cursor; }
function sameCursor(left: CompositeCursorV1, right: CompositeCursorV1): boolean { return canonicalJson(left) === canonicalJson(right); }
function sortExplanations(items: AdmissionExplanationV1[]): AdmissionExplanationV1[] {
  return items.sort((a, b) => a.policyDigest.localeCompare(b.policyDigest) || a.ruleId.localeCompare(b.ruleId) || a.subject.localeCompare(b.subject) || a.result.localeCompare(b.result) || a.code.localeCompare(b.code));
}
function subjectKey(rule: PolicyRuleV1): string { return `${rule.subject.action ?? "*"}|${rule.subject.pathPrefix ?? "*"}|${rule.subject.version ?? "*"}`; }
function applies(rule: PolicyRuleV1, input: AdmissionEvaluationInputV1): boolean {
  if (rule.subject.action !== null && rule.subject.action !== input.action) return false;
  if (rule.subject.version !== null && rule.subject.version !== input.version) return false;
  return rule.subject.pathPrefix === null || input.paths.some((path) => path === rule.subject.pathPrefix || path.startsWith(`${rule.subject.pathPrefix}/`));
}
function decision(result: Exclude<AdmissionResult, "conflicted">, constraints: string[], explanations: AdmissionExplanationV1[]): PolicyDecisionV1 {
  return { result, constraints: [...new Set(constraints)].sort(), explanations: sortExplanations(explanations) };
}
function evaluateDocument(document: PolicyDocumentV1 | null, input: AdmissionEvaluationInputV1): PolicyDecisionV1 {
  if (document === null) return decision("accepted", [], [{ policyDigest: NO_POLICY_DIGEST, ruleId: "NO_POLICY", subject: "*", result: "accepted", code: "NO_POLICY" }]);
  const parsed = parsePolicyDocumentV1(document);
  const outcomes: Exclude<AdmissionResult, "conflicted">[] = [];
  const constraints: string[] = [];
  const explanations: AdmissionExplanationV1[] = [];
  const evidenceById = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  for (const rule of parsed.core.rules) {
    if (!applies(rule, input)) continue;
    constraints.push(...rule.constraints);
    let outcome = rule.effect;
    let code = `RULE_${rule.effect.toUpperCase()}`;
    for (const requirement of rule.evidence) {
      const observed = evidenceById.get(requirement.evidenceId);
      if (observed === undefined) { outcome = "quarantined"; code = "EVIDENCE_MISSING"; break; }
      if (observed.digest !== requirement.digest) { outcome = "rejected"; code = "EVIDENCE_DIGEST_SUBSTITUTED"; break; }
      if (observed.path !== requirement.path) { outcome = "rejected"; code = "EVIDENCE_PATH_SUBSTITUTED"; break; }
      if (observed.version !== requirement.version) { outcome = "rejected"; code = "EVIDENCE_VERSION_SUBSTITUTED"; break; }
    }
    outcomes.push(outcome);
    explanations.push({ policyDigest: parsed.policyDigest, ruleId: rule.ruleId, subject: subjectKey(rule), result: outcome, code });
  }
  if (outcomes.length === 0) return decision("accepted", [], [{ policyDigest: parsed.policyDigest, ruleId: "DEFAULT_ACCEPT", subject: "*", result: "accepted", code: "NO_APPLICABLE_RULE" }]);
  const result = outcomes.reduce((most, current) => RESULT_RANK[current] > RESULT_RANK[most] ? current : most, "accepted");
  return decision(result, constraints, explanations);
}
function snapshotDecision(input: AdmissionEvaluationInputV1): PolicyDecisionV1 | null {
  const digest = input.currentPolicy?.policyDigest ?? NO_POLICY_DIGEST;
  const explanations: AdmissionExplanationV1[] = [];
  if (!sameCursor(input.snapshots.evaluationObservationCursor, input.evaluationClock.observationCursor as CompositeCursorV1)) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "cursor", result: "rejected", code: "STALE_EVALUATION_CURSOR" });
  if (input.snapshots.expectedGrantDigest !== input.snapshots.observedGrantDigest) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "grant", result: "rejected", code: "STALE_GRANT_SNAPSHOT" });
  if (input.snapshots.expectedQuotaDigest !== input.snapshots.observedQuotaDigest) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "quota", result: "rejected", code: "STALE_QUOTA_SNAPSHOT" });
  if (!input.snapshots.quotaAvailable) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "quota", result: "quarantined", code: "QUOTA_EXHAUSTED" });
  if (explanations.length === 0) return null;
  const result = explanations.some((item) => item.result === "rejected") ? "rejected" : "quarantined";
  return decision(result, [], explanations);
}
function approvalDecision(input: AdmissionEvaluationInputV1, combined: PolicyDecisionV1): PolicyDecisionV1 {
  if (combined.result !== "approval_required" || input.approval === null) return combined;
  const expected = {
    proposalDigest: input.proposalDigest, baseRevision: input.baseRevision, baseStateHash: input.baseStateHash,
    pinnedPolicyDigest: input.pinnedPolicy?.policyDigest ?? NO_POLICY_DIGEST,
    currentPolicyDigest: input.currentPolicy?.policyDigest ?? NO_POLICY_DIGEST,
    approverGrantDigest: input.snapshots.observedGrantDigest, allowedAction: input.action,
    evaluationObservationCursor: input.snapshots.evaluationObservationCursor,
  };
  if (!approvalIsValid(input.approval, input.evaluationClock.authorityTime, expected)) return combined;
  const explanations = combined.explanations.map((item) => item.result === "approval_required" ? { ...item, result: "accepted" as const, code: "APPROVAL_SATISFIED" } : item);
  return decision(explanations.some((item) => item.result === "rejected") ? "rejected" : explanations.some((item) => item.result === "quarantined") ? "quarantined" : "accepted", combined.constraints, explanations as AdmissionExplanationV1[]);
}
export function parseAdmissionEvaluationInputV1(value: unknown): AdmissionEvaluationInputV1 {
  const input = exact(value, ["schemaVersion","proposalDigest","baseRevision","baseStateHash","action","paths","version","pinnedPolicy","currentPolicy","evidence","snapshots","evaluationClock","approval","preconditionConflict"], "POLICY_INPUT_INVALID");
  if (input.schemaVersion !== "1") fail("POLICY_VERSION_UNSUPPORTED");
  [input.proposalDigest,input.baseStateHash,input.action,input.version].forEach((item) => text(item,"POLICY_INPUT_INVALID"));
  if (!Number.isSafeInteger(input.baseRevision) || (input.baseRevision as number) < 0) fail("POLICY_INPUT_INVALID");
  if (!Array.isArray(input.paths) || input.paths.some((path) => typeof path !== "string" || !path.startsWith("/")) || new Set(input.paths).size !== input.paths.length) fail("POLICY_INPUT_INVALID");
  if (input.pinnedPolicy !== null) parsePolicyDocumentV1(input.pinnedPolicy); if (input.currentPolicy !== null) parsePolicyDocumentV1(input.currentPolicy);
  if (!Array.isArray(input.evidence)) fail("POLICY_INPUT_INVALID");
  const evidenceIds = new Set<string>();
  for (const evidence of input.evidence) { const item=exact(evidence,["evidenceId","digest","path","version"],"POLICY_INPUT_INVALID"); [item.evidenceId,item.digest,item.path,item.version].forEach((part)=>text(part,"POLICY_INPUT_INVALID")); if (!(item.path as string).startsWith("/") || evidenceIds.has(item.evidenceId as string)) fail("POLICY_INPUT_INVALID"); evidenceIds.add(item.evidenceId as string); }
  const snapshots=exact(input.snapshots,["evaluationObservationCursor","expectedGrantDigest","observedGrantDigest","expectedQuotaDigest","observedQuotaDigest","quotaAvailable"],"POLICY_INPUT_INVALID"); composite(snapshots.evaluationObservationCursor); [snapshots.expectedGrantDigest,snapshots.observedGrantDigest,snapshots.expectedQuotaDigest,snapshots.observedQuotaDigest].forEach((item)=>text(item,"POLICY_INPUT_INVALID")); if(typeof snapshots.quotaAvailable!=="boolean") fail("POLICY_INPUT_INVALID");
  const clock=exact(input.evaluationClock,["schemaVersion","authorityTime","observationCursor"],"POLICY_CLOCK_INVALID"); if(clock.schemaVersion!=="1") fail("POLICY_VERSION_UNSUPPORTED"); text(clock.authorityTime,"POLICY_CLOCK_INVALID"); if(!Number.isFinite(Date.parse(clock.authorityTime))) fail("POLICY_CLOCK_INVALID"); composite(clock.observationCursor);
  if (input.approval !== null) { const approval=exact(input.approval,["schemaVersion","approvalId","proposalDigest","baseRevision","baseStateHash","pinnedPolicyDigest","currentPolicyDigest","approverPrincipalId","approverGrantDigest","allowedAction","issueObservationCursor","evaluationObservationCursor","issuedAt","expiresAt"],"POLICY_APPROVAL_INVALID"); if(approval.schemaVersion!=="1") fail("POLICY_VERSION_UNSUPPORTED"); [approval.approvalId,approval.proposalDigest,approval.baseStateHash,approval.pinnedPolicyDigest,approval.currentPolicyDigest,approval.approverPrincipalId,approval.approverGrantDigest,approval.allowedAction,approval.issuedAt,approval.expiresAt].forEach((item)=>text(item,"POLICY_APPROVAL_INVALID")); composite(approval.issueObservationCursor); composite(approval.evaluationObservationCursor); }
  if (input.preconditionConflict !== null) text(input.preconditionConflict,"POLICY_INPUT_INVALID");
  return value as AdmissionEvaluationInputV1;
}
export function evaluateAdmission(value: AdmissionEvaluationInputV1): AdmissionEvaluationV1 {
  const input = parseAdmissionEvaluationInputV1(value);
  const pinnedDigest = input.pinnedPolicy?.policyDigest ?? NO_POLICY_DIGEST; const currentDigest = input.currentPolicy?.policyDigest ?? NO_POLICY_DIGEST;
  if (input.preconditionConflict !== null) return { schemaVersion:"1",result:"conflicted",constraints:[],explanations:[{policyDigest:pinnedDigest,ruleId:"PRECONDITION",subject:"proposal",result:"rejected",code:input.preconditionConflict}],pinnedPolicyDigest:pinnedDigest,currentPolicyDigest:currentDigest,evaluationObservationCursor:input.snapshots.evaluationObservationCursor,authorityTime:input.evaluationClock.authorityTime };
  const snapshot = snapshotDecision(input);
  let combined = combinePolicyDecisions(evaluateDocument(input.pinnedPolicy,input),evaluateDocument(input.currentPolicy,input));
  if(snapshot!==null) combined=combinePolicyDecisions(combined,snapshot);
  combined=approvalDecision(input,combined);
  return { schemaVersion:"1",result:combined.result,constraints:combined.constraints,explanations:sortExplanations(combined.explanations as AdmissionExplanationV1[]),pinnedPolicyDigest:pinnedDigest,currentPolicyDigest:currentDigest,evaluationObservationCursor:input.snapshots.evaluationObservationCursor,authorityTime:input.evaluationClock.authorityTime };
}
