import assert from "node:assert/strict";
import test from "node:test";
import { reduceCanonicalDocument, reduceWorkspaceState, domainDigest } from "@horseness/domain";

test("genesis precedes the first acceptance and only DeltaAccepted changes canonical revision",()=>{
  assert.throws(()=>reduceCanonicalDocument(null,{eventType:"DeltaAcceptedV1",sequence:1,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:"missing",resultingStateHash:"missing",resultingDocument:{a:2}}),/EVENT_SEQUENCE_INVALID/);
  const initial=reduceCanonicalDocument(null,{eventType:"RunCreatedV1",sequence:1,workspaceId:"w",runId:"r",initialDocument:{a:1}});
  assert.equal(initial.revision,0);
  const document={a:2};
  const next=reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:4,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:domainDigest("horseness.canonical-document.v1",document),resultingDocument:document});
  assert.equal(next.revision,1);assert.deepEqual(next.document,document);
});

test("workspace admission replay advances authority projections but never policy",()=>{
  const workspace=reduceWorkspaceState(null,{eventType:"WorkspaceCreatedV1",sequence:1,workspaceId:"w",authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"used",activePolicyDigest:"policy"});
  const states=["accepted","rejected","conflicted","quarantined","approval_required"] as const;
  let projected=workspace;
  for(let index=0;index<states.length;index+=1){const state=states[index]!;projected=reduceWorkspaceState(projected,{eventType:"WorkspaceAdmissionRecordedV1",sequence:index+2,workspaceId:"w",proposalDigest:`proposal-${state}`,decisionEventId:`decision-${state}`,state,quotaId:"quota",quotaDigest:"quota-v1",consumed:state==="accepted"?"yes":"no"});}
  assert.equal(projected.activePolicyDigest,"policy"); assert.equal(Object.keys(projected.admissions).length,states.length); assert.deepEqual(projected.quotas.quota?.consumedDecisionEventIds,["decision-accepted"]); assert.equal(projected.quotas.quota?.observedDecisionEventIds.length,states.length);
});

test("workspace admission continuations share the release reevaluation matrix and keep terminal decisions immutable",()=>{
  const genesis=reduceWorkspaceState(null,{eventType:"WorkspaceCreatedV1",sequence:1,workspaceId:"w",authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"used",activePolicyDigest:"policy"});
  const allowed={approval_required:["accepted","rejected"],quarantined:["quarantined","approval_required","accepted","rejected"]} as const;
  for(const [from,targets] of Object.entries(allowed) as Array<[keyof typeof allowed,readonly (typeof allowed)[keyof typeof allowed][number][]]>) for(const to of targets){
    const first=reduceWorkspaceState(genesis,{eventType:"WorkspaceAdmissionRecordedV1",sequence:2,workspaceId:"w",proposalDigest:`${from}-${to}`,decisionEventId:`${from}-1-${to}`,state:from,quotaId:"quota",quotaDigest:"quota-v1",consumed:"no"});
    const continued=reduceWorkspaceState(first,{eventType:"WorkspaceAdmissionRecordedV1",sequence:3,workspaceId:"w",proposalDigest:`${from}-${to}`,decisionEventId:`${from}-2-${to}`,state:to,quotaId:"quota",quotaDigest:"quota-v1",consumed:to==="accepted"?"yes":"no"});
    assert.equal(continued.admissions[`${from}-${to}`]?.state,to); assert.equal(continued.admissions[`${from}-${to}`]?.history.length,2);
  }
  const all=["accepted","rejected","conflicted","quarantined","approval_required"] as const;
  for(const from of all) for(const to of all){
    if((allowed as Partial<Record<typeof from,readonly typeof to[]>>)[from]?.includes(to)) continue;
    const first=reduceWorkspaceState(genesis,{eventType:"WorkspaceAdmissionRecordedV1",sequence:2,workspaceId:"w",proposalDigest:`${from}-${to}`,decisionEventId:`${from}-1-${to}`,state:from,quotaId:"quota",quotaDigest:"quota-v1",consumed:from==="accepted"?"yes":"no"});
    assert.throws(()=>reduceWorkspaceState(first,{eventType:"WorkspaceAdmissionRecordedV1",sequence:3,workspaceId:"w",proposalDigest:`${from}-${to}`,decisionEventId:`${from}-2-${to}`,state:to,quotaId:"quota",quotaDigest:"quota-v1",consumed:to==="accepted"?"yes":"no"}),/ILLEGAL_ADMISSION_TRANSITION/);
  }
});

test("canonical replay binds sequence, aggregate identity, prior hash, and resulting document hash",()=>{
  const initial=reduceCanonicalDocument(null,{eventType:"RunCreatedV1",sequence:1,workspaceId:"w",runId:"r",initialDocument:{a:1}});
  const document={a:2}; const stateHash=domainDigest("horseness.canonical-document.v1",document);
  assert.throws(()=>reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:1,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:stateHash,resultingDocument:document}),/EVENT_SEQUENCE_INVALID/);
  assert.throws(()=>reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:2,workspaceId:"other",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:stateHash,resultingDocument:document}),/AGGREGATE_IDENTITY_MISMATCH/);
  assert.throws(()=>reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:2,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:"substituted",resultingStateHash:stateHash,resultingDocument:document}),/STALE_BASE/);
  assert.throws(()=>reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:2,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:"substituted",resultingDocument:document}),/STALE_BASE/);
});
