import assert from "node:assert/strict";
import test from "node:test";
import { NO_POLICY_DIGEST, reduceOperationalState, reduceWorkspaceState, type RunOperationalState } from "@horseness/domain";

const base=()=>reduceOperationalState(null,{eventType:"RunCreatedV1",sequence:1,workspaceId:"w",runId:"r"});
const submit=(state:RunOperationalState,id:string,digest=`digest-${id}`)=>reduceOperationalState(state,{eventType:"ProposalSubmittedV1",sequence:state.lastEventSequence+1,workspaceId:"w",runId:"r",proposalId:id,proposalDigest:digest});
const decide=(state:RunOperationalState,id:string,status:"accepted"|"rejected"|"conflicted"|"quarantined"|"approval_required",suffix=status)=>reduceOperationalState(state,{eventType:"AdmissionDecisionRecordedV1",sequence:state.lastEventSequence+1,workspaceId:"w",runId:"r",proposalId:id,proposalDigest:`digest-${id}`,state:status,provenanceDigest:`provenance-${suffix}`,artifactDigest:`artifact-${suffix}`});

test("rejected and conflicted decisions remain terminal after replay restart",()=>{
  for(const terminal of ["rejected","conflicted"] as const){let state=decide(submit(base(),terminal),terminal,terminal);const restarted=structuredClone(state);assert.throws(()=>decide(restarted,terminal,terminal,"duplicate"),/DUPLICATE_PROPOSAL_TRANSITION/);assert.equal(restarted.proposals[terminal]?.status,terminal);}
});

test("approval-required decisions durably resolve through approve or reject",()=>{
  let approved=decide(submit(base(),"approve"),"approve","approval_required");
  approved=reduceOperationalState(approved,{eventType:"DeltaAcceptedV1",sequence:approved.lastEventSequence+1,workspaceId:"w",runId:"r",proposalId:"approve",proposalDigest:"digest-approve"});
  approved=decide(approved,"approve","accepted","approved");
  assert.deepEqual(approved.proposals.approve,{proposalDigest:"digest-approve",status:"accepted",provenanceDigest:"provenance-approved",artifactDigest:"artifact-approved"});
  const rejected=decide(decide(submit(base(),"reject"),"reject","approval_required"),"reject","rejected","rejected");
  assert.equal(rejected.proposals.reject?.status,"rejected");
});

test("quarantine release binds the terminal provenance artifact without mutating policy",()=>{
  const workspace=reduceWorkspaceState(null,{eventType:"WorkspaceCreatedV1",sequence:1,workspaceId:"w",activePolicyDigest:NO_POLICY_DIGEST});
  let state=decide(submit(base(),"release"),"release","quarantined");
  state=reduceOperationalState(state,{eventType:"DeltaAcceptedV1",sequence:state.lastEventSequence+1,workspaceId:"w",runId:"r",proposalId:"release",proposalDigest:"digest-release"});
  state=decide(state,"release","accepted","released");
  assert.equal(state.proposals.release?.provenanceDigest,"provenance-released");
  assert.equal(state.proposals.release?.artifactDigest,"artifact-released");
  assert.equal(workspace.activePolicyDigest,NO_POLICY_DIGEST);
});
