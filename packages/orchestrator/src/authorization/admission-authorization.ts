import { authorizeCommand, type CapabilityV1, type PrincipalRole } from "@horseness/domain";

/** Request-side authorization is a lookup key, never authority state. */
export interface AdmissionAuthorization { capabilityId: string }
export interface AuthoritativeAdmissionAuthorization { role: PrincipalRole; capabilityId: string; capability: CapabilityV1; grantDigest: string; revoked: boolean }
export function authorizeAdmission(input: AdmissionAuthorization, authority: AuthoritativeAdmissionAuthorization, subject: {workspaceId:string;runId:string;principalId:string;observationSequence:number}) {
  if(input.capabilityId!==authority.capabilityId||authority.revoked)return {allowed:false as const,reason:"CAPABILITY_SCOPE_MISMATCH" as const};
  if(authority.capability.delegatee!==subject.principalId)return {allowed:false as const,reason:"CAPABILITY_SCOPE_MISMATCH" as const};
  return authorizeCommand({role:authority.role,command:"submit-proposal",capability:authority.capability,workspaceId:subject.workspaceId,runId:subject.runId,observationSequence:subject.observationSequence,grantDigest:authority.grantDigest,expectedGrantDigest:authority.grantDigest});
}
