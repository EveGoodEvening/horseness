import assert from "node:assert/strict";
import test from "node:test";
import { NO_POLICY_DIGEST, type CompositeCursorV1 } from "@horseness/domain";
import {
  activatePolicy, deactivatePolicy, evaluateAdmission, parseAdmissionEvaluationInputV1,
  parsePolicyDocumentV1, policyDocumentDigest, sealPolicyDocument,
  type AdmissionEvaluationInputV1, type PolicyDocumentCoreV1, type PolicyDocumentV1,
} from "../src/index.js";

const cursor: CompositeCursorV1 = { schemaVersion:"1",kind:"composite",workspaceId:"ws",workspaceSequence:3,workspaceEnvelopeHash:"w",workspaceContextEpoch:2,runId:"run",runSequence:4,runEnvelopeHash:"r",runContextEpoch:2 };
const core = (policyId: string, effect: "accepted"|"rejected"|"quarantined"|"approval_required", options: {revision?:number; predecessorDigest?:string|null; constraints?:string[]; evidence?:boolean; action?:string|null; pathPrefix?:string|null; version?:string|null}={}): PolicyDocumentCoreV1 => ({
  schemaVersion:"1",kind:"policy",policyId,revision:options.revision??0,predecessorDigest:options.predecessorDigest??null,
  rules:[{ruleId:"rule",subject:{action:options.action??"write",pathPrefix:options.pathPrefix??"/src",version:options.version??"1"},effect,constraints:options.constraints??[],evidence:options.evidence===false?[]:[{evidenceId:"ev",digest:"digest",path:"/evidence/report",version:"1"}]}],
});
const input = (pinnedPolicy: PolicyDocumentV1|null, currentPolicy: PolicyDocumentV1|null): AdmissionEvaluationInputV1 => ({
  schemaVersion:"1",proposalDigest:"proposal",baseRevision:1,baseStateHash:"state",action:"write",paths:["/src/index.ts"],version:"1",pinnedPolicy,currentPolicy,
  evidence:[{evidenceId:"ev",digest:"digest",path:"/evidence/report",version:"1"}],
  snapshots:{evaluationObservationCursor:cursor,expectedGrantDigest:"grant",observedGrantDigest:"grant",expectedQuotaDigest:"quota",observedQuotaDigest:"quota",quotaAvailable:true},
  evaluationClock:{schemaVersion:"1",authorityTime:"2026-01-01T12:00:00Z",observationCursor:cursor},approval:null,preconditionConflict:null,
});

test("content addressing, lineage, lifecycle and strict document validation",()=>{
  const first=sealPolicyDocument(core("p","accepted")); assert.equal(first.policyDigest,policyDocumentDigest(first.core)); assert.equal(parsePolicyDocumentV1(first),first);
  assert.throws(()=>parsePolicyDocumentV1({...first,policyDigest:"substituted"}),/POLICY_DIGEST_MISMATCH/);
  assert.throws(()=>sealPolicyDocument({...core("p","accepted"),revision:1}),/POLICY_LINEAGE_INVALID/);
  assert.throws(()=>sealPolicyDocument({...core("p","accepted"),rules:[...core("p","accepted").rules,{...core("p","accepted").rules[0]!,ruleId:"rule"}]}),/POLICY_RULE_ORDER_INVALID/);
  const inactive={schemaVersion:"1",state:"inactive",activePolicyDigest:null,activationSequence:0} as const;
  const active=activatePolicy(inactive,first); assert.deepEqual(active,{schemaVersion:"1",state:"active",activePolicyDigest:first.policyDigest,activationSequence:1}); assert.equal(activatePolicy(active,first),active);
  const stopped=deactivatePolicy(active); assert.deepEqual(stopped,{schemaVersion:"1",state:"inactive",activePolicyDigest:null,activationSequence:2}); assert.equal(deactivatePolicy(stopped),stopped);
});

test("full pinned by current result cross-product uses conjunctive precedence",()=>{
  const effects=["accepted","approval_required","quarantined","rejected"] as const;
  const rank={accepted:0,approval_required:1,quarantined:2,rejected:3} as const;
  for(const pinned of effects) for(const current of effects){
    const result=evaluateAdmission(input(sealPolicyDocument(core(`p-${pinned}`,pinned)),sealPolicyDocument(core(`c-${current}`,current))));
    assert.equal(result.result,rank[pinned]>=rank[current]?pinned:current,`${pinned} x ${current}`);
  }
  assert.equal(evaluateAdmission(input(null,null)).result,"accepted");
  assert.deepEqual(evaluateAdmission(input(null,null)).explanations.map((item)=>item.policyDigest),[NO_POLICY_DIGEST,NO_POLICY_DIGEST]);
});

test("incomparable, loosened and tightened policies preserve both constraints and stable explanations",()=>{
  const pinned=sealPolicyDocument(core("pinned","approval_required",{constraints:["b","shared"]}));
  const current=sealPolicyDocument(core("current","quarantined",{constraints:["a","shared"]}));
  const first=evaluateAdmission(input(pinned,current)); const second=evaluateAdmission(input(pinned,current));
  assert.equal(first.result,"quarantined"); assert.deepEqual(first,second);
  assert.deepEqual(first.constraints,["a","b","shared"]);
  assert.deepEqual(first.explanations,[...first.explanations].sort((a,b)=>a.policyDigest.localeCompare(b.policyDigest)||a.ruleId.localeCompare(b.ruleId)||a.subject.localeCompare(b.subject)||a.result.localeCompare(b.result)||a.code.localeCompare(b.code)));
  assert.equal(evaluateAdmission(input(sealPolicyDocument(core("strict","rejected")),sealPolicyDocument(core("loose","accepted")))).result,"rejected");
  assert.equal(evaluateAdmission(input(sealPolicyDocument(core("loose","accepted")),sealPolicyDocument(core("strict","rejected")))).result,"rejected");
});

test("conflict dominates and evidence digest path version or absence fail closed",()=>{
  const policy=sealPolicyDocument(core("p","accepted"));
  assert.equal(evaluateAdmission({...input(policy,policy),preconditionConflict:"BASE_HASH_MISMATCH",evidence:[]}).result,"conflicted");
  const cases=[
    {evidence:[],result:"quarantined",code:"EVIDENCE_MISSING"},
    {evidence:[{evidenceId:"ev",digest:"other",path:"/evidence/report",version:"1"}],result:"rejected",code:"EVIDENCE_DIGEST_SUBSTITUTED"},
    {evidence:[{evidenceId:"ev",digest:"digest",path:"/evidence/other",version:"1"}],result:"rejected",code:"EVIDENCE_PATH_SUBSTITUTED"},
    {evidence:[{evidenceId:"ev",digest:"digest",path:"/evidence/report",version:"2"}],result:"rejected",code:"EVIDENCE_VERSION_SUBSTITUTED"},
  ] as const;
  for(const scenario of cases){const result=evaluateAdmission({...input(policy,null),evidence:[...scenario.evidence]});assert.equal(result.result,scenario.result);assert(result.explanations.some((item)=>item.code===scenario.code));}
});

test("path action and version selection is exact and deterministic",()=>{
  const policy=sealPolicyDocument(core("p","rejected",{evidence:false,action:"release",pathPrefix:"/dist",version:"2"}));
  assert.equal(evaluateAdmission(input(policy,null)).result,"accepted");
  assert.equal(evaluateAdmission({...input(policy,null),action:"release",paths:["/dist/app.tgz"],version:"2"}).result,"rejected");
  assert.equal(evaluateAdmission({...input(policy,null),action:"release",paths:["/distribution/app.tgz"],version:"2"}).result,"accepted");
});

test("cursor, grant and quota snapshots are authority-clock inputs",()=>{
  const policy=sealPolicyDocument(core("p","accepted")); const base=input(policy,null);
  const moved={...cursor,runSequence:5};
  assert.equal(evaluateAdmission({...base,evaluationClock:{...base.evaluationClock,observationCursor:moved}}).explanations.some((item)=>item.code==="STALE_EVALUATION_CURSOR"),true);
  assert.equal(evaluateAdmission({...base,snapshots:{...base.snapshots,observedGrantDigest:"old"}}).explanations.some((item)=>item.code==="STALE_GRANT_SNAPSHOT"),true);
  assert.equal(evaluateAdmission({...base,snapshots:{...base.snapshots,observedQuotaDigest:"old"}}).explanations.some((item)=>item.code==="STALE_QUOTA_SNAPSHOT"),true);
  assert.equal(evaluateAdmission({...base,snapshots:{...base.snapshots,quotaAvailable:false}}).result,"quarantined");
  assert.throws(()=>parseAdmissionEvaluationInputV1({...base,evaluationClock:{...base.evaluationClock,authorityTime:"not-time"}}),/POLICY_CLOCK_INVALID/);
});

test("approval binding, expiry, replacement and re-evaluation are fail closed",()=>{
  const pinned=sealPolicyDocument(core("p","approval_required")); const current=sealPolicyDocument(core("c","accepted")); const base=input(pinned,current);
  const approval={schemaVersion:"1",approvalId:"approval",proposalDigest:"proposal",baseRevision:1,baseStateHash:"state",pinnedPolicyDigest:pinned.policyDigest,currentPolicyDigest:current.policyDigest,approverPrincipalId:"approver",approverGrantDigest:"grant",allowedAction:"write",issueObservationCursor:cursor,evaluationObservationCursor:cursor,issuedAt:"2026-01-01T00:00:00Z",expiresAt:"2026-01-02T00:00:00Z"} as const;
  assert.equal(evaluateAdmission({...base,approval}).result,"accepted");
  assert.equal(evaluateAdmission({...base,approval,evaluationClock:{...base.evaluationClock,authorityTime:approval.expiresAt}}).result,"approval_required");
  assert.equal(evaluateAdmission({...base,approval,proposalDigest:"replacement"}).result,"approval_required");
  assert.equal(evaluateAdmission({...base,approval,currentPolicy:sealPolicyDocument(core("replacement","accepted"))}).result,"approval_required");
  assert.equal(evaluateAdmission({...base,approval,snapshots:{...base.snapshots,observedGrantDigest:"replacement"}}).result,"rejected");
  const replacement={...approval,approvalId:"approval-2",expiresAt:"2026-01-03T00:00:00Z"}; assert.equal(evaluateAdmission({...base,approval:replacement}).result,"accepted");
});

test("strict input validators reject extras, duplicates and unsupported versions",()=>{
  const valid=input(null,null);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,extra:true}),/POLICY_INPUT_INVALID/);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,schemaVersion:"2"}),/POLICY_VERSION_UNSUPPORTED/);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,paths:["/a","/a"]}),/POLICY_INPUT_INVALID/);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,evidence:[...valid.evidence,...valid.evidence]}),/POLICY_INPUT_INVALID/);
});
