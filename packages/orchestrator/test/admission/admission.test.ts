import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NO_POLICY_DIGEST,
  NO_POLICY_V1,
  createRunGenesis,
  createWorkspaceGenesis,
  deltaAuthorityScopeDigest,
  domainDigest,
  jsonValueDigest,
  sealProposal,
  type CapabilityV1,
  type CompositeCursorV1,
  type JsonValue,
  type ProposalEnvelopeCoreV1,
} from "@horseness/domain";
import { SQLiteAuthority } from "@horseness/store-sqlite";
import { AdmissionService, loadRevision, type AdmissionRequestV1 } from "../../src/index.js";

function fixture() {
  const root=mkdtempSync(join(tmpdir(),"horseness-c07-")); const authority=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"));
  const workspace=createWorkspaceGenesis({workspaceId:"w",authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"marker",activePolicyDigest:NO_POLICY_DIGEST,commandId:"workspace"});
  authority.appendAtomic({commandId:"workspace",workspace:{streamKind:"workspace",workspaceId:"w",streamId:"w",expectedSequence:0,expectedEnvelopeHash:null,events:[workspace.event]}});
  const absent={schemaVersion:"1" as const,kind:"absent-run-genesis" as const,workspaceId:"w",workspaceSequence:1,workspaceEnvelopeHash:workspace.event.envelopeHash,workspaceContextEpoch:0,runId:"r",expectedRunHead:"absent" as const};
  const run=createRunGenesis({observationCursor:absent,initialDocument:{value:1},principalId:"worker",commandId:"run"}); authority.appendAtomic({commandId:"run",runGenesis:{observationCursor:absent,event:run.event}});
  const cursor:CompositeCursorV1=run.resultCursor; const cleanup=()=>{authority.close();rmSync(root,{recursive:true,force:true});}; return {authority,cursor,cleanup};
}
function request(authority:SQLiteAuthority,cursor:CompositeCursorV1,commandId="accept"):AdmissionRequestV1 {
  const revision=loadRevision(authority,"w","r"); const scope={schemaVersion:"1" as const,workspaceId:"w",runId:"r",taskId:"t",roots:["/value"]};
  const core:ProposalEnvelopeCoreV1={schemaVersion:"1",workspaceId:"w",runId:"r",authorPrincipalId:"worker",authorGrantDigest:"grant",attemptId:"attempt",receiptDigests:[],forkPinDigest:"fork",deltaAuthorityScopeDigest:deltaAuthorityScopeDigest(scope),baseRevision:revision.revision,baseStateHash:revision.stateHash,canonicalizerVersion:"jcs-v1",hashVersion:"sha256-v1",proposalSealingObservationCursor:cursor,proposalSealingContextVersion:{schemaVersion:"1",kind:"composite",workspaceContextEpoch:cursor.workspaceContextEpoch,runContextEpoch:cursor.runContextEpoch,observationCursor:cursor},operations:[{op:"replace",path:"/value",expectedValueDigest:jsonValueDigest(1),value:2}],evidenceClaims:[],pinnedPolicyDigest:NO_POLICY_DIGEST,currentPolicyDigest:NO_POLICY_DIGEST,nonce:"nonce",predecessorProposalDigest:null,predecessorReason:null};
  const proposal=sealProposal(core); const capability:CapabilityV1={schemaVersion:"1",workspaceId:"w",runId:"r",commands:["submit-proposal"],issuer:"authority",delegatee:"worker",issuedObservationSequence:1,expiresObservationSequence:100,nonce:"cap",revocationSequence:null};
  return {schemaVersion:"1",commandId,proposal,scope,fork:{digest:"fork",workspaceId:"w",runId:"r",canonicalRevision:0,canonicalStateHash:revision.stateHash,pinnedPolicyDigest:NO_POLICY_DIGEST},receipts:[],pinnedPolicy:NO_POLICY_V1,currentPolicy:NO_POLICY_V1,evidence:[],snapshots:{issueObservationCursor:cursor,evaluationObservationCursor:cursor,expectedGrantDigest:"grant",observedGrantDigest:"grant",expectedQuotaDigest:"quota",observedQuotaDigest:"quota",quotaAvailable:true,authenticatedApproverPrincipalId:"approver"},evaluationClock:{schemaVersion:"1",authorityTime:"2026-08-12T00:00:00Z",observationCursor:cursor},approval:null,authorization:{role:"worker",capability,expectedGrantDigest:"grant"},action:"apply-delta",version:"1"};
}
test("atomically accepts a sealed delta and terminally deduplicates",()=>{const f=fixture();try{const service=new AdmissionService(f.authority);const input=request(f.authority,f.cursor);const first=service.evaluateAndApply(input);assert.equal(first.state,"accepted");assert.equal(first.revision,1);assert.deepEqual(loadRevision(f.authority,"w","r").document,{value:2});const second=service.evaluateAndApply(input);assert.equal(second.deduplicated,true);assert.equal(f.authority.replay("w","run","r").filter(item=>item.envelope.eventType==="DeltaAcceptedV1").length,1);}finally{f.cleanup();}});
test("conflict, scope, grant, and no-op checks fail closed without revision change",()=>{const f=fixture();try{const service=new AdmissionService(f.authority);const stale=request(f.authority,f.cursor);stale.proposal=sealProposal({...stale.proposal.core,baseRevision:9,nonce:"stale"});stale.fork={...stale.fork,canonicalRevision:9};assert.equal(service.evaluateAndApply(stale).state,"conflicted");assert.equal(loadRevision(f.authority,"w","r").revision,0);const escaped=request(f.authority,f.cursor,"escape");escaped.scope={...escaped.scope,roots:["/other"]};assert.throws(()=>service.evaluateAndApply(escaped),/SCOPE_ESCAPE/);const denied=request(f.authority,f.cursor,"denied");denied.authorization.expectedGrantDigest="other";assert.throws(()=>service.evaluateAndApply(denied),/GRANT_SUBSTITUTED/);const noop=request(f.authority,f.cursor,"noop");noop.proposal=sealProposal({...noop.proposal.core,operations:[{op:"test",path:"/value",expectedValueDigest:jsonValueDigest(1)}],nonce:"noop"});assert.notEqual(service.evaluateAndApply(noop).state,"accepted");assert.equal(loadRevision(f.authority,"w","r").revision,0);}finally{f.cleanup();}});
