import {
  DomainError,
  NO_POLICY_DIGEST,
  NO_POLICY_V1,
  canonicalScope,
  domainDigest,
  validatePointer,
  type JsonValue,
} from "@horseness/domain";

export type PolicyEffectV1 = "accepted" | "rejected" | "quarantined" | "approval_required";
export interface PolicySubjectV1 { action: string | null; pathPrefix: string | null; version: string | null }
export interface EvidenceRequirementV1 { evidenceId: string; digest: string; path: string; version: string }
export interface PolicyRuleV1 { ruleId: string; subject: PolicySubjectV1; effect: PolicyEffectV1; constraints: string[]; evidence: EvidenceRequirementV1[] }
export interface PolicyDocumentCoreV1 { schemaVersion: "1"; kind: "policy"; policyId: string; revision: number; predecessorDigest: string | null; rules: PolicyRuleV1[] }
export interface PolicyDocumentV1 { core: PolicyDocumentCoreV1; policyDigest: string }
export type NoPolicyV1 = typeof NO_POLICY_V1;
export type PolicySlotV1 = PolicyDocumentV1 | NoPolicyV1;
export type PolicyReferenceStateV1 =
  | { schemaVersion: "1"; state: "inactive"; activePolicyDigest: typeof NO_POLICY_DIGEST; activationSequence: number }
  | { schemaVersion: "1"; state: "active"; activePolicyDigest: string; activationSequence: number };

const EFFECTS = ["accepted", "rejected", "quarantined", "approval_required"] as const;
const encoder = new TextEncoder();
export function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left); const b = encoder.encode(right); const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}
function fail(code: string): never { throw new DomainError(code); }
function record(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const result = value as Record<string, unknown>; const actual = Object.keys(result).sort(compareUtf8); const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return result;
}
function text(value: unknown, code: string): asserts value is string { if (typeof value !== "string" || value.length === 0) fail(code); }
function nullableText(value: unknown, code: string): void { if (value !== null) text(value, code); }
function natural(value: unknown, code: string): void { if (!Number.isSafeInteger(value) || (value as number) < 0) fail(code); }
function sortedUnique(values: unknown, code: string): asserts values is string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) fail(code);
  if (values.some((value, index) => index > 0 && compareUtf8(values[index - 1]!, value) >= 0)) fail(code);
}
function canonicalPointer(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string") fail(code);
  try { validatePointer(value); canonicalScope({ schemaVersion: "1", workspaceId: "policy", runId: "policy", taskId: "policy", roots: [value] }); } catch { fail(code); }
}
function validateSubject(value: unknown): void {
  const item = record(value, ["action", "pathPrefix", "version"], "POLICY_SUBJECT_INVALID");
  nullableText(item.action, "POLICY_SUBJECT_INVALID"); nullableText(item.version, "POLICY_SUBJECT_INVALID");
  if (item.pathPrefix !== null) canonicalPointer(item.pathPrefix, "POLICY_SUBJECT_INVALID");
}
function validateEvidence(value: unknown): void {
  const item = record(value, ["evidenceId", "digest", "path", "version"], "POLICY_EVIDENCE_INVALID");
  text(item.evidenceId, "POLICY_EVIDENCE_INVALID"); text(item.digest, "POLICY_EVIDENCE_INVALID"); canonicalPointer(item.path, "POLICY_EVIDENCE_INVALID"); text(item.version, "POLICY_EVIDENCE_INVALID");
}
function validateRule(value: unknown): void {
  const item = record(value, ["ruleId", "subject", "effect", "constraints", "evidence"], "POLICY_RULE_INVALID");
  text(item.ruleId, "POLICY_RULE_INVALID"); validateSubject(item.subject);
  if (typeof item.effect !== "string" || !EFFECTS.includes(item.effect as PolicyEffectV1)) fail("POLICY_RULE_INVALID");
  sortedUnique(item.constraints, "POLICY_RULE_INVALID");
  if (!Array.isArray(item.evidence)) fail("POLICY_RULE_INVALID"); item.evidence.forEach(validateEvidence);
  const ids = item.evidence.map((entry) => (entry as EvidenceRequirementV1).evidenceId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && compareUtf8(ids[index - 1]!, id) >= 0)) fail("POLICY_RULE_INVALID");
}
export function parseNoPolicyV1(value: unknown): NoPolicyV1 {
  const item = record(value, ["schemaVersion", "kind", "rules"], "POLICY_DOCUMENT_INVALID");
  if (item.schemaVersion !== "1") fail("POLICY_VERSION_UNSUPPORTED");
  if (item.kind !== "no-policy" || !Array.isArray(item.rules) || item.rules.length !== 0) fail("POLICY_KIND_UNSUPPORTED");
  return value as NoPolicyV1;
}
export function parsePolicySlotV1(value: unknown): PolicySlotV1 {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && (value as Record<string, unknown>).kind === "no-policy") return parseNoPolicyV1(value);
  return parsePolicyDocumentV1(value);
}
export function policySlotDigest(value: PolicySlotV1): string { return "kind" in value ? (parseNoPolicyV1(value), NO_POLICY_DIGEST) : parsePolicyDocumentV1(value).policyDigest; }
export function parsePolicyDocumentCoreV1(value: unknown): PolicyDocumentCoreV1 {
  const core = record(value, ["schemaVersion", "kind", "policyId", "revision", "predecessorDigest", "rules"], "POLICY_DOCUMENT_INVALID");
  if (core.schemaVersion !== "1") fail("POLICY_VERSION_UNSUPPORTED"); if (core.kind !== "policy") fail("POLICY_KIND_UNSUPPORTED");
  text(core.policyId, "POLICY_DOCUMENT_INVALID"); natural(core.revision, "POLICY_DOCUMENT_INVALID"); nullableText(core.predecessorDigest, "POLICY_DOCUMENT_INVALID");
  if ((core.revision === 0) !== (core.predecessorDigest === null)) fail("POLICY_LINEAGE_INVALID");
  if (!Array.isArray(core.rules)) fail("POLICY_DOCUMENT_INVALID"); core.rules.forEach(validateRule);
  const ids = core.rules.map((rule) => (rule as PolicyRuleV1).ruleId);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && compareUtf8(ids[index - 1]!, id) >= 0)) fail("POLICY_RULE_ORDER_INVALID");
  return value as PolicyDocumentCoreV1;
}
export function policyDocumentDigest(core: PolicyDocumentCoreV1): string { parsePolicyDocumentCoreV1(core); return domainDigest("horseness.policy.v1", core as unknown as JsonValue); }
export function sealPolicyDocument(core: PolicyDocumentCoreV1): PolicyDocumentV1 { return Object.freeze({ core: structuredClone(parsePolicyDocumentCoreV1(core)), policyDigest: policyDocumentDigest(core) }); }
export function parsePolicyDocumentV1(value: unknown): PolicyDocumentV1 {
  const document = record(value, ["core", "policyDigest"], "POLICY_DOCUMENT_INVALID"); const core = parsePolicyDocumentCoreV1(document.core); text(document.policyDigest, "POLICY_DOCUMENT_INVALID");
  if (document.policyDigest !== policyDocumentDigest(core)) fail("POLICY_DIGEST_MISMATCH"); return value as PolicyDocumentV1;
}
export function activatePolicy(state: PolicyReferenceStateV1, document: PolicyDocumentV1): PolicyReferenceStateV1 {
  parsePolicyDocumentV1(document); parsePolicyReferenceStateV1(state); if (state.activePolicyDigest === document.policyDigest) return state;
  return Object.freeze({ schemaVersion: "1", state: "active", activePolicyDigest: document.policyDigest, activationSequence: state.activationSequence + 1 });
}
export function deactivatePolicy(state: PolicyReferenceStateV1): PolicyReferenceStateV1 {
  parsePolicyReferenceStateV1(state); if (state.state === "inactive") return state;
  return Object.freeze({ schemaVersion: "1", state: "inactive", activePolicyDigest: NO_POLICY_DIGEST, activationSequence: state.activationSequence + 1 });
}
export function parsePolicyReferenceStateV1(value: unknown): PolicyReferenceStateV1 {
  const state = record(value, ["schemaVersion", "state", "activePolicyDigest", "activationSequence"], "POLICY_REFERENCE_INVALID");
  if (state.schemaVersion !== "1") fail("POLICY_VERSION_UNSUPPORTED"); natural(state.activationSequence, "POLICY_REFERENCE_INVALID"); text(state.activePolicyDigest, "POLICY_REFERENCE_INVALID");
  if (state.state === "inactive") { if (state.activePolicyDigest !== NO_POLICY_DIGEST) fail("POLICY_REFERENCE_INVALID"); }
  else if (state.state === "active") { if (state.activePolicyDigest === NO_POLICY_DIGEST) fail("POLICY_REFERENCE_INVALID"); }
  else fail("POLICY_REFERENCE_INVALID"); return value as PolicyReferenceStateV1;
}
