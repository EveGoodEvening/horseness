import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NO_POLICY_DIGEST, NO_POLICY_V1, createRunGenesis, createWorkspaceGenesis,
  deltaAuthorityScopeDigest, jsonValueDigest, sealForkPin, sealProposal,
  type CapabilityV1, type CompositeCursorV1, type ProposalEnvelopeCoreV1,
} from "@horseness/domain";
import { SQLiteAuthority } from "@horseness/store-sqlite";
import { AdmissionService, loadRevision, type AdmissionRequestV1 } from "../../src/index.js";

function fixture() {
  const root=mkdtempSync(join(tmpdir(),"horseness-c07-")); const authority=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"));
  const workspace=createWorkspaceGenesis({workspaceId:"w",authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"marker",activePolicyDigest:NO_POLICY_DIGEST,commandId:"workspace"});
  authority.appendAtomic({commandId:"workspace",workspace:{streamKind:"workspace",workspaceId:"w",streamId:"w",expectedSequence:0,expectedEnvelopeHash:null,events:[workspace.event]}});
  const absent={schemaVersion:"1" as const,kind:"absent-run-genesis" as const,workspaceId:"w",workspaceSequence:1,workspaceEnvelopeHash:workspace.event.envelopeHash,workspaceContextEpoch:0,runId:"r",expectedRunHead:"absent" as const};
  const run=createRunGenesis({observationCursor:absent,initialDocument:{value:1,nested:{value:1}},principalId:"worker",commandId:"run"}); authority.appendAtomic({commandId:"run",runGenesis:{observationCursor:absent,event:run.event}});
  const cursor:CompositeCursorV1=run.resultCursor; const revision=loadRevision(authority,"w","r");
  const scope={schemaVersion:"1" as const,workspaceId:"w",runId:"r",taskId:"t",roots:["/value","/nested"]};
  const fork=sealForkPin({schemaVersion:"1",forkId:"f",pinVersion:1,workspaceId:"w",runId:"r",parentForkPinDigest:null,refreshesForkPinDigest:null,canonicalRevision:revision.revision,canonicalStateHash:revision.stateHash,canonicalizerVersion:"jcs-v1",hashVersion:"sha256-v1",sourceObservationCursor:cursor,sourceContextVersion:{schemaVersion:"1",kind:"composite",workspaceContextEpoch:cursor.workspaceContextEpoch,runContextEpoch:cursor.runContextEpoch,observationCursor:cursor},dependencyJoinSnapshotDigest:"join",deltaAuthorityScopeDigest:deltaAuthorityScopeDigest(scope),pinnedPolicyDigest:NO_POLICY_DIGEST,ancestry:[],createdByPrincipalId:"worker",createdByGrantDigest:"grant"});
  const capability:CapabilityV1={schemaVersion:"1",workspaceId:"w",runId:"r",commands:["submit-proposal"],issuer:"authority",delegatee:"worker",issuedObservationSequence:1,expiresObservationSequence:100,nonce:"cap",revocationSequence:null};
  const put=(name:string,state:Parameters<SQLiteAuthority["putSnapshot"]>[0]["state"])=>authority.putSnapshot({workspaceId:"w",streamKind:"run",streamId:"r",sequence:cursor.runSequence,envelopeHash:cursor.runEnvelopeHash,projectionName:name,projectionVersion:"1",state});
  put("admission-sealing",{schemaVersion:"1",observationCursor:cursor,fork,scope,receipts:[],pinnedPolicy:NO_POLICY_V1,evidence:[]});
  put("admission-current",{schemaVersion:"1",evaluationObservationCursor:cursor,currentPolicy:NO_POLICY_V1,authorization:{role:"worker",capabilityId:"capability",capability,grantDigest:"grant",revoked:false},quota:{id:"quota",digest:"quota-digest",available:true},authenticatedApproverPrincipalId:"approver",authorityTime:"2026-08-12T00:00:00Z"});
  return {authority,cursor,scope,fork,cleanup:()=>{authority.close();rmSync(root,{recursive:true,force:true});}};
}
function request(f:ReturnType<typeof fixture>, commandId="accept"):AdmissionRequestV1 {
  const revision=loadRevision(f.authority,"w","r");
  const core:ProposalEnvelopeCoreV1={schemaVersion:"1",workspaceId:"w",runId:"r",authorPrincipalId:"worker",authorGrantDigest:"grant",attemptId:"attempt",receiptDigests:[],forkPinDigest:f.fork.forkPinDigest,deltaAuthorityScopeDigest:deltaAuthorityScopeDigest(f.scope),baseRevision:revision.revision,baseStateHash:revision.stateHash,canonicalizerVersion:"jcs-v1",hashVersion:"sha256-v1",proposalSealingObservationCursor:f.cursor,proposalSealingContextVersion:{schemaVersion:"1",kind:"composite",workspaceContextEpoch:f.cursor.workspaceContextEpoch,runContextEpoch:f.cursor.runContextEpoch,observationCursor:f.cursor},operations:[{op:"replace",path:"/value",expectedValueDigest:jsonValueDigest(1),value:2}],evidenceClaims:[],pinnedPolicyDigest:NO_POLICY_DIGEST,currentPolicyDigest:NO_POLICY_DIGEST,nonce:commandId,predecessorProposalDigest:null,predecessorReason:null};
  return {schemaVersion:"1",commandId,proposal:sealProposal(core),scopeDigest:core.deltaAuthorityScopeDigest,forkPinDigest:core.forkPinDigest,receiptDigests:[],evidenceIds:[],policyDigest:NO_POLICY_DIGEST,quotaId:"quota",evaluationClock:{schemaVersion:"1",authorityTime:"1900-01-01T00:00:00Z",observationCursor:f.cursor},approval:null,authorization:{capabilityId:"capability"},action:"apply-delta",version:"1"};
}
function errorCode(fn:()=>unknown):string { try { fn(); return "NO_ERROR"; } catch(error) { return error instanceof Error ? error.message : String(error); } }

test("accepts once and terminal lookup uses the canonical proposal id/digest pair",()=>{const f=fixture();try{const service=new AdmissionService(f.authority);const input=request(f);const first=service.evaluateAndApply(input);assert.equal(first.state,"accepted");assert.equal(first.revision,1);assert.deepEqual(loadRevision(f.authority,"w","r").document,{value:2,nested:{value:1}});const second=service.evaluateAndApply(input);assert.equal(second.deduplicated,true);}finally{f.cleanup();}});

test("proposal schema/id and operation shape precede scope, authority identifiers, and terminal lookup",()=>{const f=fixture();try{const service=new AdmissionService(f.authority);const malformed=request(f,"malformed") as unknown as Record<string,unknown>; (malformed.proposal as Record<string,unknown>).extra=true; malformed.scopeDigest="wrong";assert.match(errorCode(()=>service.evaluateAndApply(malformed as unknown as AdmissionRequestV1)),/INVALID_ENVELOPE/);const badId=request(f,"bad-id");badId.proposal={...badId.proposal,proposalId:"prp_substituted"};badId.scopeDigest="wrong";assert.match(errorCode(()=>service.evaluateAndApply(badId)),/PROPOSAL_ID_MISMATCH/);}finally{f.cleanup();}});

test("pointer and overlap validation precede authenticated scope escape",()=>{const f=fixture();try{const service=new AdmissionService(f.authority);const overlap=request(f,"overlap");overlap.proposal=sealProposal({...overlap.proposal.core,operations:[{op:"replace",path:"/nested",expectedValueDigest:jsonValueDigest({value:1}),value:{}},{op:"replace",path:"/nested/value",expectedValueDigest:jsonValueDigest(1),value:2}]});overlap.scopeDigest="substituted";assert.match(errorCode(()=>service.evaluateAndApply(overlap)),/OVERLAPPING_WRITE_TARGET/);const escaped=request(f,"escape");escaped.proposal=sealProposal({...escaped.proposal.core,operations:[{op:"replace",path:"/private",expectedValueDigest:jsonValueDigest(1),value:2}]});assert.match(errorCode(()=>service.evaluateAndApply(escaped)),/SCOPE_ESCAPE/);}finally{f.cleanup();}});

test("base conflict precedes current policy, grant, quota, version, and no-op evaluation",()=>{const f=fixture();try{const service=new AdmissionService(f.authority);const staleFork=sealForkPin({...f.fork.core,canonicalRevision:9,canonicalStateHash:"stale"});f.authority.putSnapshot({workspaceId:"w",streamKind:"run",streamId:"r",sequence:f.cursor.runSequence,envelopeHash:f.cursor.runEnvelopeHash,projectionName:"admission-sealing",projectionVersion:"1",state:{schemaVersion:"1",observationCursor:f.cursor,fork:staleFork,scope:f.scope,receipts:[],pinnedPolicy:NO_POLICY_V1,evidence:[]}});const stale=request(f,"stale");stale.proposal=sealProposal({...stale.proposal.core,forkPinDigest:staleFork.forkPinDigest,baseRevision:9,baseStateHash:"stale"});stale.forkPinDigest=staleFork.forkPinDigest;assert.equal(service.evaluateAndApply(stale).state,"conflicted");assert.equal(loadRevision(f.authority,"w","r").revision,0);}finally{f.cleanup();}});
