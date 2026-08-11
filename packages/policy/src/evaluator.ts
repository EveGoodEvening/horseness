import {
  NO_POLICY_DIGEST,
  canonicalJson,
  combinePolicyDecisions,
  parseObservationCursorV1,
  scopeContains,
  validatePointer,
  type AdmissionResult,
  type ApprovalBindingV1,
  type CompositeCursorV1,
  type EvaluationClockV1,
  type PolicyDecisionV1,
  type PolicyExplanationV1,
} from "@horseness/domain";
import { DomainError } from "@horseness/domain";
import { compareUtf8, parsePolicySlotV1, policySlotDigest, type PolicyRuleV1, type PolicySlotV1 } from "./lifecycle.js";

export interface PresentedEvidenceV1 { evidenceId: string; digest: string; path: string; version: string }
export interface SnapshotExpectationV1 {
  issueObservationCursor: CompositeCursorV1;
  evaluationObservationCursor: CompositeCursorV1;
  expectedGrantDigest: string;
  observedGrantDigest: string;
  expectedQuotaDigest: string;
  observedQuotaDigest: string;
  quotaAvailable: boolean;
  authenticatedApproverPrincipalId: string;
}
export interface AdmissionEvaluationInputV1 {
  schemaVersion: "1";
  proposalDigest: string;
  proposalAuthorPrincipalId: string;
  baseRevision: number;
  baseStateHash: string;
  action: string;
  paths: string[];
  version: string;
  pinnedPolicy: PolicySlotV1;
  currentPolicy: PolicySlotV1;
  evidence: PresentedEvidenceV1[];
  snapshots: SnapshotExpectationV1;
  evaluationClock: EvaluationClockV1;
  approval: ApprovalBindingV1 | null;
  preconditionConflict: string | null;
}
export interface AdmissionExplanationV1 extends PolicyExplanationV1 { code: string }
export interface AdmissionEvaluationV1 {
  schemaVersion: "1"; result: AdmissionResult; constraints: string[]; explanations: AdmissionExplanationV1[];
  pinnedPolicyDigest: string; currentPolicyDigest: string; evaluationObservationCursor: CompositeCursorV1; authorityTime: string;
}

const RESULT_RANK: Record<Exclude<AdmissionResult, "conflicted">, number> = { accepted: 0, approval_required: 1, quarantined: 2, rejected: 3 };
function fail(code: string): never { throw new DomainError(code); }
function exact(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const item = value as Record<string, unknown>; const actual = Object.keys(item).sort(compareUtf8); const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code); return item;
}
function text(value: unknown, code: string): asserts value is string { if (typeof value !== "string" || value.length === 0) fail(code); }
function natural(value: unknown, code: string): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code); }
function canonicalSecond(value: unknown, code: string): asserts value is string {
  text(value, code); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) fail(code);
  const parsed = Date.parse(value); if (!Number.isFinite(parsed) || new Date(parsed).toISOString().replace(".000Z", "Z") !== value) fail(code);
}
function composite(value: unknown): CompositeCursorV1 { const cursor = parseObservationCursorV1(value); if (cursor.kind !== "composite") fail("POLICY_CURSOR_INVALID"); return cursor; }
function sameCursor(left: CompositeCursorV1, right: CompositeCursorV1): boolean { return canonicalJson(left) === canonicalJson(right); }
function cursorComponentNotAfter(leftSequence: number, leftEnvelopeHash: string, leftEpoch: number, rightSequence: number, rightEnvelopeHash: string, rightEpoch: number): boolean {
  if (leftSequence > rightSequence) return false;
  if (leftSequence === rightSequence) return leftEnvelopeHash === rightEnvelopeHash && leftEpoch === rightEpoch;
  return leftEpoch <= rightEpoch;
}
function cursorNotAfter(left: CompositeCursorV1, right: CompositeCursorV1): boolean {
  return left.workspaceId === right.workspaceId && left.runId === right.runId
    && cursorComponentNotAfter(left.workspaceSequence, left.workspaceEnvelopeHash, left.workspaceContextEpoch, right.workspaceSequence, right.workspaceEnvelopeHash, right.workspaceContextEpoch)
    && cursorComponentNotAfter(left.runSequence, left.runEnvelopeHash, left.runContextEpoch, right.runSequence, right.runEnvelopeHash, right.runContextEpoch);
}
function sortExplanations(items: AdmissionExplanationV1[]): AdmissionExplanationV1[] {
  return items.sort((a, b) => compareUtf8(a.policyDigest, b.policyDigest) || compareUtf8(a.ruleId, b.ruleId) || compareUtf8(a.subject, b.subject) || compareUtf8(a.result, b.result) || compareUtf8(a.code, b.code));
}
function normalizeDecision(value: PolicyDecisionV1): PolicyDecisionV1 {
  return { result: value.result, constraints: [...new Set(value.constraints)].sort(compareUtf8), explanations: sortExplanations(value.explanations as AdmissionExplanationV1[]) };
}
function subjectKey(rule: PolicyRuleV1): string { return `${rule.subject.action ?? "*"}|${rule.subject.pathPrefix ?? "*"}|${rule.subject.version ?? "*"}`; }
function applies(rule: PolicyRuleV1, input: AdmissionEvaluationInputV1): boolean {
  if (rule.subject.action !== null && rule.subject.action !== input.action) return false;
  if (rule.subject.version !== null && rule.subject.version !== input.version) return false;
  if (rule.subject.pathPrefix === null) return true;
  const scope = { schemaVersion: "1" as const, workspaceId: "policy", runId: "policy", taskId: "policy", roots: [rule.subject.pathPrefix] };
  return input.paths.some((path) => scopeContains(scope, path));
}
function decision(result: Exclude<AdmissionResult, "conflicted">, constraints: string[], explanations: AdmissionExplanationV1[]): PolicyDecisionV1 {
  return normalizeDecision({ result, constraints, explanations });
}
function evaluateDocument(document: PolicySlotV1, input: AdmissionEvaluationInputV1): PolicyDecisionV1 {
  const parsed = parsePolicySlotV1(document); const digest = policySlotDigest(parsed);
  if ("kind" in parsed) return decision("accepted", [], [{ policyDigest: NO_POLICY_DIGEST, ruleId: "NO_POLICY", subject: "*", result: "accepted", code: "NO_POLICY" }]);
  const outcomes: Exclude<AdmissionResult, "conflicted">[] = []; const constraints: string[] = []; const explanations: AdmissionExplanationV1[] = [];
  const evidenceById = new Map(input.evidence.map((item) => [item.evidenceId, item]));
  for (const rule of parsed.core.rules) {
    if (!applies(rule, input)) continue; constraints.push(...rule.constraints); let outcome = rule.effect; let code = `RULE_${rule.effect.toUpperCase()}`;
    for (const requirement of rule.evidence) {
      const observed = evidenceById.get(requirement.evidenceId);
      if (observed === undefined) { outcome = "quarantined"; code = "EVIDENCE_MISSING"; break; }
      if (observed.digest !== requirement.digest) { outcome = "rejected"; code = "EVIDENCE_DIGEST_SUBSTITUTED"; break; }
      if (observed.path !== requirement.path) { outcome = "rejected"; code = "EVIDENCE_PATH_SUBSTITUTED"; break; }
      if (observed.version !== requirement.version) { outcome = "rejected"; code = "EVIDENCE_VERSION_SUBSTITUTED"; break; }
    }
    outcomes.push(outcome); explanations.push({ policyDigest: digest, ruleId: rule.ruleId, subject: subjectKey(rule), result: outcome, code });
  }
  if (outcomes.length === 0) return decision("accepted", [], [{ policyDigest: digest, ruleId: "DEFAULT_ACCEPT", subject: "*", result: "accepted", code: "NO_APPLICABLE_RULE" }]);
  return decision(outcomes.reduce((most, current) => RESULT_RANK[current] > RESULT_RANK[most] ? current : most, "accepted"), constraints, explanations);
}
function snapshotDecision(input: AdmissionEvaluationInputV1): PolicyDecisionV1 | null {
  const digest = policySlotDigest(input.currentPolicy); const explanations: AdmissionExplanationV1[] = [];
  if (!sameCursor(input.snapshots.evaluationObservationCursor, input.evaluationClock.observationCursor as CompositeCursorV1)) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "cursor", result: "rejected", code: "STALE_EVALUATION_CURSOR" });
  if (!cursorNotAfter(input.snapshots.issueObservationCursor, input.snapshots.evaluationObservationCursor)) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "issue-cursor", result: "rejected", code: "ISSUE_CURSOR_AFTER_EVALUATION" });
  if (input.snapshots.expectedGrantDigest !== input.snapshots.observedGrantDigest) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "grant", result: "rejected", code: "STALE_GRANT_SNAPSHOT" });
  if (input.snapshots.expectedQuotaDigest !== input.snapshots.observedQuotaDigest) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "quota", result: "rejected", code: "STALE_QUOTA_SNAPSHOT" });
  if (!input.snapshots.quotaAvailable) explanations.push({ policyDigest: digest, ruleId: "AUTHORITY_SNAPSHOT", subject: "quota", result: "quarantined", code: "QUOTA_EXHAUSTED" });
  if (explanations.length === 0) return null;
  return decision(explanations.some((item) => item.result === "rejected") ? "rejected" : "quarantined", [], explanations);
}
function approvalDecision(input: AdmissionEvaluationInputV1, combined: PolicyDecisionV1): PolicyDecisionV1 {
  if (combined.result !== "approval_required" || input.approval === null) return normalizeDecision(combined);
  const approval = input.approval;
  const valid = approval.proposalDigest === input.proposalDigest && approval.baseRevision === input.baseRevision && approval.baseStateHash === input.baseStateHash
    && approval.pinnedPolicyDigest === policySlotDigest(input.pinnedPolicy) && approval.currentPolicyDigest === policySlotDigest(input.currentPolicy)
    && approval.approverPrincipalId === input.snapshots.authenticatedApproverPrincipalId && approval.approverPrincipalId !== input.proposalAuthorPrincipalId
    && approval.approverGrantDigest === input.snapshots.observedGrantDigest && approval.allowedAction === input.action
    && sameCursor(approval.issueObservationCursor, input.snapshots.issueObservationCursor)
    && sameCursor(approval.evaluationObservationCursor, input.snapshots.evaluationObservationCursor)
    && cursorNotAfter(approval.issueObservationCursor, approval.evaluationObservationCursor)
    && Date.parse(input.evaluationClock.authorityTime) >= Date.parse(approval.issuedAt) && Date.parse(input.evaluationClock.authorityTime) < Date.parse(approval.expiresAt);
  if (!valid) return normalizeDecision(combined);
  const explanations = combined.explanations.map((item) => item.result === "approval_required" ? { ...item, result: "accepted" as const, code: "APPROVAL_SATISFIED" } : item) as AdmissionExplanationV1[];
  return decision(explanations.some((item) => item.result === "rejected") ? "rejected" : explanations.some((item) => item.result === "quarantined") ? "quarantined" : "accepted", combined.constraints, explanations);
}
export function parseAdmissionEvaluationInputV1(value: unknown): AdmissionEvaluationInputV1 {
  const input = exact(value, ["schemaVersion","proposalDigest","proposalAuthorPrincipalId","baseRevision","baseStateHash","action","paths","version","pinnedPolicy","currentPolicy","evidence","snapshots","evaluationClock","approval","preconditionConflict"], "POLICY_INPUT_INVALID");
  if (input.schemaVersion !== "1") fail("POLICY_VERSION_UNSUPPORTED"); [input.proposalDigest,input.proposalAuthorPrincipalId,input.baseStateHash,input.action,input.version].forEach((item) => text(item,"POLICY_INPUT_INVALID")); natural(input.baseRevision,"POLICY_INPUT_INVALID");
  if (!Array.isArray(input.paths) || input.paths.length === 0) fail("POLICY_INPUT_INVALID");
  const paths = input.paths as unknown[];
  if (paths.some((path) => { if (typeof path !== "string") return true; try { validatePointer(path); return false; } catch { return true; } }) || new Set(paths).size !== paths.length || paths.some((path,index)=>index>0&&compareUtf8(paths[index-1] as string,path as string)>=0)) fail("POLICY_INPUT_INVALID");
  parsePolicySlotV1(input.pinnedPolicy); parsePolicySlotV1(input.currentPolicy);
  if (!Array.isArray(input.evidence)) fail("POLICY_INPUT_INVALID"); const evidenceIds = new Set<string>(); let previousEvidenceId: string | undefined;
  for (const evidence of input.evidence) { const item=exact(evidence,["evidenceId","digest","path","version"],"POLICY_INPUT_INVALID"); [item.evidenceId,item.digest,item.version].forEach((part)=>text(part,"POLICY_INPUT_INVALID")); try { validatePointer(item.path as string); } catch { fail("POLICY_INPUT_INVALID"); } const id=item.evidenceId as string; if(evidenceIds.has(id)||(previousEvidenceId!==undefined&&compareUtf8(previousEvidenceId,id)>=0)) fail("POLICY_INPUT_INVALID"); evidenceIds.add(id); previousEvidenceId=id; }
  const snapshots=exact(input.snapshots,["issueObservationCursor","evaluationObservationCursor","expectedGrantDigest","observedGrantDigest","expectedQuotaDigest","observedQuotaDigest","quotaAvailable","authenticatedApproverPrincipalId"],"POLICY_INPUT_INVALID"); composite(snapshots.issueObservationCursor); composite(snapshots.evaluationObservationCursor); [snapshots.expectedGrantDigest,snapshots.observedGrantDigest,snapshots.expectedQuotaDigest,snapshots.observedQuotaDigest,snapshots.authenticatedApproverPrincipalId].forEach((item)=>text(item,"POLICY_INPUT_INVALID")); if(typeof snapshots.quotaAvailable!=="boolean") fail("POLICY_INPUT_INVALID");
  const clock=exact(input.evaluationClock,["schemaVersion","authorityTime","observationCursor"],"POLICY_CLOCK_INVALID"); if(clock.schemaVersion!=="1") fail("POLICY_VERSION_UNSUPPORTED"); canonicalSecond(clock.authorityTime,"POLICY_CLOCK_INVALID"); composite(clock.observationCursor);
  if (input.approval !== null) { const approval=exact(input.approval,["schemaVersion","approvalId","proposalDigest","baseRevision","baseStateHash","pinnedPolicyDigest","currentPolicyDigest","approverPrincipalId","approverGrantDigest","allowedAction","issueObservationCursor","evaluationObservationCursor","issuedAt","expiresAt"],"POLICY_APPROVAL_INVALID"); if(approval.schemaVersion!=="1") fail("POLICY_VERSION_UNSUPPORTED"); [approval.approvalId,approval.proposalDigest,approval.baseStateHash,approval.pinnedPolicyDigest,approval.currentPolicyDigest,approval.approverPrincipalId,approval.approverGrantDigest,approval.allowedAction].forEach((item)=>text(item,"POLICY_APPROVAL_INVALID")); natural(approval.baseRevision,"POLICY_APPROVAL_INVALID"); composite(approval.issueObservationCursor); composite(approval.evaluationObservationCursor); canonicalSecond(approval.issuedAt,"POLICY_APPROVAL_INVALID"); canonicalSecond(approval.expiresAt,"POLICY_APPROVAL_INVALID"); if(Date.parse(approval.issuedAt as string)>=Date.parse(approval.expiresAt as string)) fail("POLICY_APPROVAL_INVALID"); }
  if (input.preconditionConflict !== null) text(input.preconditionConflict,"POLICY_INPUT_INVALID"); return value as AdmissionEvaluationInputV1;
}
export function evaluateAdmission(value: AdmissionEvaluationInputV1): AdmissionEvaluationV1 {
  const input = parseAdmissionEvaluationInputV1(value); const pinnedDigest = policySlotDigest(input.pinnedPolicy); const currentDigest = policySlotDigest(input.currentPolicy);
  if (input.preconditionConflict !== null) return { schemaVersion:"1",result:"conflicted",constraints:[],explanations:sortExplanations([{policyDigest:pinnedDigest,ruleId:"PRECONDITION",subject:"proposal",result:"rejected",code:input.preconditionConflict}]),pinnedPolicyDigest:pinnedDigest,currentPolicyDigest:currentDigest,evaluationObservationCursor:input.snapshots.evaluationObservationCursor,authorityTime:input.evaluationClock.authorityTime };
  const snapshot = snapshotDecision(input); let combined = normalizeDecision(combinePolicyDecisions(evaluateDocument(input.pinnedPolicy,input),evaluateDocument(input.currentPolicy,input))); if(snapshot!==null) combined=normalizeDecision(combinePolicyDecisions(combined,snapshot)); combined=approvalDecision(input,combined);
  return { schemaVersion:"1",result:combined.result,constraints:[...new Set(combined.constraints)].sort(compareUtf8),explanations:sortExplanations(combined.explanations as AdmissionExplanationV1[]),pinnedPolicyDigest:pinnedDigest,currentPolicyDigest:currentDigest,evaluationObservationCursor:input.snapshots.evaluationObservationCursor,authorityTime:input.evaluationClock.authorityTime };
}
