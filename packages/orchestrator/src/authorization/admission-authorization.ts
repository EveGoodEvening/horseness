import { authorizeCommand, type CapabilityV1, type PrincipalRole } from "@horseness/domain";

export interface AdmissionAuthorization { role: PrincipalRole; capability: CapabilityV1; expectedGrantDigest: string }
export function authorizeAdmission(input: AdmissionAuthorization, subject: {workspaceId:string;runId:string;principalId:string;grantDigest:string;observationSequence:number}) {
  if(input.capability.delegatee!==subject.principalId)return {allowed:false as const,reason:"CAPABILITY_SCOPE_MISMATCH" as const};
  return authorizeCommand({role:input.role,command:"submit-proposal",capability:input.capability,workspaceId:subject.workspaceId,runId:subject.runId,observationSequence:subject.observationSequence,grantDigest:subject.grantDigest,expectedGrantDigest:input.expectedGrantDigest});
}
