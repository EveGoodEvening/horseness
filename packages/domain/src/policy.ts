import { domainDigest, DomainError, type JsonValue } from "./canonical.js";
import type { CompositeCursorV1 } from "./events.js";

export const NO_POLICY_V1 = { schemaVersion: "1", kind: "no-policy", rules: [] } as const;
export const NO_POLICY_DIGEST = domainDigest("horseness.policy.v1", NO_POLICY_V1 as unknown as JsonValue);
export type AdmissionResult = "accepted" | "rejected" | "conflicted" | "quarantined" | "approval_required";
export interface PolicyExplanationV1 { policyDigest: string; ruleId: string; subject: string; result: Exclude<AdmissionResult, "conflicted"> }
export interface PolicyDecisionV1 { result: Exclude<AdmissionResult, "conflicted">; constraints: string[]; explanations: PolicyExplanationV1[] }
export function noPolicyDecision(): PolicyDecisionV1 { return { result: "accepted", constraints: [], explanations: [{ policyDigest: NO_POLICY_DIGEST, ruleId: "NO_POLICY", subject: "*", result: "accepted" }] }; }
const PRECEDENCE: Record<PolicyDecisionV1["result"], number> = { accepted: 0, approval_required: 1, quarantined: 2, rejected: 3 };
export function combinePolicyDecisions(pinned: PolicyDecisionV1, current: PolicyDecisionV1): PolicyDecisionV1 {
  const result = PRECEDENCE[pinned.result] >= PRECEDENCE[current.result] ? pinned.result : current.result;
  return { result, constraints: [...new Set([...pinned.constraints, ...current.constraints])].sort(), explanations: [...pinned.explanations, ...current.explanations].sort((a, b) => a.policyDigest.localeCompare(b.policyDigest) || a.ruleId.localeCompare(b.ruleId) || a.subject.localeCompare(b.subject)) };
}
export interface ApprovalBindingV1 { schemaVersion: "1"; approvalId: string; proposalDigest: string; baseRevision: number; baseStateHash: string; pinnedPolicyDigest: string; currentPolicyDigest: string; approverPrincipalId: string; approverGrantDigest: string; allowedAction: string; issueObservationCursor: CompositeCursorV1; evaluationObservationCursor: CompositeCursorV1; issuedAt: string; expiresAt: string }
export function approvalIsValid(binding: ApprovalBindingV1, authorityTime: string, expected: Pick<ApprovalBindingV1, "proposalDigest" | "pinnedPolicyDigest" | "currentPolicyDigest" | "approverGrantDigest">): boolean {
  return authorityTime < binding.expiresAt && authorityTime >= binding.issuedAt && binding.proposalDigest === expected.proposalDigest && binding.pinnedPolicyDigest === expected.pinnedPolicyDigest && binding.currentPolicyDigest === expected.currentPolicyDigest && binding.approverGrantDigest === expected.approverGrantDigest;
}

export type PrincipalRole = "authority" | "approver" | "operator" | "worker" | "adapter";
export type PrivilegedCommand = "create-workspace" | "rebind-workspace" | "grant-admin" | "policy-admin" | "quota-admin" | "approve-proposal" | "reject-proposal" | "release-proposal" | "resolve-unknown" | "duplicate-risk-launch" | "promote-import" | "recovery-admin" | "daemon-admin" | "install" | "dispatch" | "submit-receipt" | "submit-proposal" | "read-bound-context" | "cancel-own-attempt";
const ALLOWED: Record<PrincipalRole, readonly PrivilegedCommand[]> = {
  authority: ["create-workspace", "rebind-workspace", "grant-admin", "policy-admin", "quota-admin", "approve-proposal", "reject-proposal", "release-proposal", "resolve-unknown", "duplicate-risk-launch", "promote-import", "recovery-admin", "daemon-admin", "install", "dispatch", "submit-receipt", "submit-proposal", "read-bound-context", "cancel-own-attempt"],
  approver: ["approve-proposal"], operator: ["install", "dispatch"], worker: ["submit-receipt", "submit-proposal", "read-bound-context", "cancel-own-attempt"], adapter: ["submit-receipt", "read-bound-context"]
};
export type AuthorizationDenial = "ROLE_FORBIDDEN" | "CAPABILITY_SCOPE_MISMATCH" | "CROSS_WORKSPACE_DENIED" | "GRANT_STALE" | "GRANT_SUBSTITUTED" | "USER_PRESENCE_REQUIRED" | "RECOVERY_QUORUM_REQUIRED";
export interface CapabilityV1 { schemaVersion: "1"; workspaceId: string; runId?: string; taskId?: string; attemptId?: string; generation?: number; commands: PrivilegedCommand[]; issuer: string; delegatee: string; issuedObservationSequence: number; expiresObservationSequence: number; nonce: string; revocationSequence: number | null }
export function authorizeCommand(input: { role: PrincipalRole; command: PrivilegedCommand; capability: CapabilityV1; workspaceId: string; observationSequence: number; grantDigest: string; expectedGrantDigest: string; userPresence?: boolean; recoveryQuorum?: boolean }): { allowed: true } | { allowed: false; reason: AuthorizationDenial } {
  if (!ALLOWED[input.role].includes(input.command)) return { allowed: false, reason: "ROLE_FORBIDDEN" };
  if (input.capability.workspaceId !== input.workspaceId) return { allowed: false, reason: "CROSS_WORKSPACE_DENIED" };
  if (!input.capability.commands.includes(input.command)) return { allowed: false, reason: "CAPABILITY_SCOPE_MISMATCH" };
  if (input.grantDigest !== input.expectedGrantDigest) return { allowed: false, reason: "GRANT_SUBSTITUTED" };
  if (input.observationSequence > input.capability.expiresObservationSequence || (input.capability.revocationSequence !== null && input.capability.revocationSequence <= input.observationSequence)) return { allowed: false, reason: "GRANT_STALE" };
  if (["duplicate-risk-launch", "rebind-workspace", "promote-import", "resolve-unknown"].includes(input.command) && !input.userPresence) return { allowed: false, reason: "USER_PRESENCE_REQUIRED" };
  if (input.command === "recovery-admin" && !input.recoveryQuorum) return { allowed: false, reason: "RECOVERY_QUORUM_REQUIRED" };
  if (input.role === "approver" && input.capability.delegatee === input.capability.issuer) throw new DomainError("ROLE_FORBIDDEN", "self approval forbidden");
  return { allowed: true };
}
