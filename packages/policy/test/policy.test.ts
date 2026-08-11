import assert from "node:assert/strict";
import test from "node:test";
import { NO_POLICY_DIGEST, NO_POLICY_V1, type CompositeCursorV1 } from "@horseness/domain";
import {
  activatePolicy, deactivatePolicy, evaluateAdmission, parseAdmissionEvaluationInputV1,
  parsePolicyDocumentV1, parsePolicyReferenceStateV1, policyDocumentDigest, sealPolicyDocument,
  type AdmissionEvaluationInputV1, type PolicyDocumentCoreV1, type PolicySlotV1,
} from "../src/index.js";

const cursor: CompositeCursorV1 = { schemaVersion:"1",kind:"composite",workspaceId:"ws",workspaceSequence:3,workspaceEnvelopeHash:"w",workspaceContextEpoch:2,runId:"run",runSequence:4,runEnvelopeHash:"r",runContextEpoch:2 };
const core = (policyId: string, effect: "accepted"|"rejected"|"quarantined"|"approval_required", options: {revision?:number; predecessorDigest?:string|null; constraints?:string[]; evidence?:boolean; action?:string|null; pathPrefix?:string|null; version?:string|null}={}): PolicyDocumentCoreV1 => ({
  schemaVersion:"1",kind:"policy",policyId,revision:options.revision??0,predecessorDigest:options.predecessorDigest??null,
  rules:[{ruleId:"rule",subject:{action:options.action??"write",pathPrefix:options.pathPrefix??"/src",version:options.version??"1"},effect,constraints:options.constraints??[],evidence:options.evidence===false?[]:[{evidenceId:"ev",digest:"digest",path:"/evidence/report",version:"1"}]}],
});
const input = (pinnedPolicy: PolicySlotV1=NO_POLICY_V1, currentPolicy: PolicySlotV1=NO_POLICY_V1): AdmissionEvaluationInputV1 => ({
  schemaVersion:"1",proposalDigest:"proposal",proposalAuthorPrincipalId:"author",baseRevision:1,baseStateHash:"state",action:"write",paths:["/src/index.ts"],version:"1",pinnedPolicy,currentPolicy,
  evidence:[{evidenceId:"ev",digest:"digest",path:"/evidence/report",version:"1"}],
  snapshots:{issueObservationCursor:cursor,evaluationObservationCursor:cursor,expectedGrantDigest:"grant",observedGrantDigest:"grant",expectedQuotaDigest:"quota",observedQuotaDigest:"quota",quotaAvailable:true,authenticatedApproverPrincipalId:"approver"},
  evaluationClock:{schemaVersion:"1",authorityTime:"2026-01-01T12:00:00Z",observationCursor:cursor},approval:null,preconditionConflict:null,
});
const approvalFor = (base: AdmissionEvaluationInputV1) => ({schemaVersion:"1",approvalId:"approval",proposalDigest:base.proposalDigest,baseRevision:base.baseRevision,baseStateHash:base.baseStateHash,pinnedPolicyDigest:evaluateAdmission(base).pinnedPolicyDigest,currentPolicyDigest:evaluateAdmission(base).currentPolicyDigest,approverPrincipalId:"approver",approverGrantDigest:"grant",allowedAction:base.action,issueObservationCursor:cursor,evaluationObservationCursor:cursor,issuedAt:"2026-01-01T00:00:00Z",expiresAt:"2026-01-02T00:00:00Z"} as const);

test("content addressing, lineage, explicit no-policy lifecycle and strict document validation",()=>{
  const first=sealPolicyDocument(core("p","accepted")); assert.equal(first.policyDigest,policyDocumentDigest(first.core)); assert.equal(parsePolicyDocumentV1(first),first);
  assert.throws(()=>parsePolicyDocumentV1({...first,policyDigest:"substituted"}),/POLICY_DIGEST_MISMATCH/);
  assert.throws(()=>sealPolicyDocument({...core("p","accepted"),revision:1}),/POLICY_LINEAGE_INVALID/);
  const inactive={schemaVersion:"1",state:"inactive",activePolicyDigest:NO_POLICY_DIGEST,activationSequence:0} as const;
  const active=activatePolicy(inactive,first); assert.deepEqual(active,{schemaVersion:"1",state:"active",activePolicyDigest:first.policyDigest,activationSequence:1});
  const stopped=deactivatePolicy(active); assert.deepEqual(stopped,{schemaVersion:"1",state:"inactive",activePolicyDigest:NO_POLICY_DIGEST,activationSequence:2});
  assert.throws(()=>parsePolicyReferenceStateV1({...inactive,activePolicyDigest:null}),/POLICY_REFERENCE_INVALID/);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...input(),pinnedPolicy:null}),/POLICY_DOCUMENT_INVALID/);
});

test("full pinned by current result cross-product uses explicit canonical no-policy",()=>{
  const effects=["accepted","approval_required","quarantined","rejected"] as const; const rank={accepted:0,approval_required:1,quarantined:2,rejected:3} as const;
  for(const pinned of effects) for(const current of effects){const result=evaluateAdmission(input(sealPolicyDocument(core(`p-${pinned}`,pinned)),sealPolicyDocument(core(`c-${current}`,current))));assert.equal(result.result,rank[pinned]>=rank[current]?pinned:current);}
  const neutral=evaluateAdmission(input()); assert.equal(neutral.result,"accepted"); assert.deepEqual(neutral.explanations.map((item)=>item.policyDigest),[NO_POLICY_DIGEST,NO_POLICY_DIGEST]);
});

test("UTF-8 canonical order is enforced and stable",()=>{
  const policy=core("p","accepted",{constraints:["z","é"]}); assert.doesNotThrow(()=>sealPolicyDocument(policy));
  assert.throws(()=>sealPolicyDocument(core("p","accepted",{constraints:["é","z"]})),/POLICY_RULE_INVALID/);
  const first=evaluateAdmission(input(sealPolicyDocument(policy))); assert.deepEqual(first.constraints,["z","é"]);
});

test("domain JSON Pointer containment handles root, tokens and escapes",()=>{
  const root=sealPolicyDocument(core("root","rejected",{evidence:false,pathPrefix:""})); assert.equal(evaluateAdmission(input(root)).result,"rejected");
  const token=sealPolicyDocument(core("token","rejected",{evidence:false,pathPrefix:"/a~1b"}));
  assert.equal(evaluateAdmission({...input(token),paths:["/a~1b/child"]}).result,"rejected");
  assert.equal(evaluateAdmission({...input(token),paths:["/a/b/child"]}).result,"accepted");
  assert.throws(()=>sealPolicyDocument(core("bad","accepted",{pathPrefix:"/bad~2token"})),/POLICY_SUBJECT_INVALID/);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...input(),paths:["/bad~"]}),/POLICY_INPUT_INVALID/);
});

test("conflict dominates and evidence substitutions fail closed",()=>{
  const policy=sealPolicyDocument(core("p","accepted")); assert.equal(evaluateAdmission({...input(policy),preconditionConflict:"BASE_HASH_MISMATCH",evidence:[]}).result,"conflicted");
  const cases=[{evidence:[],result:"quarantined",code:"EVIDENCE_MISSING"},{evidence:[{evidenceId:"ev",digest:"other",path:"/evidence/report",version:"1"}],result:"rejected",code:"EVIDENCE_DIGEST_SUBSTITUTED"},{evidence:[{evidenceId:"ev",digest:"digest",path:"/evidence/other",version:"1"}],result:"rejected",code:"EVIDENCE_PATH_SUBSTITUTED"},{evidence:[{evidenceId:"ev",digest:"digest",path:"/evidence/report",version:"2"}],result:"rejected",code:"EVIDENCE_VERSION_SUBSTITUTED"}] as const;
  for(const scenario of cases){const result=evaluateAdmission({...input(policy),evidence:[...scenario.evidence]});assert.equal(result.result,scenario.result);assert(result.explanations.some((item)=>item.code===scenario.code));}
});

test("base revisions, timestamps and intervals are canonical",()=>{
  const valid=input(); for(const bad of [-1,1.5,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,baseRevision:bad}),/POLICY_INPUT_INVALID/);
  for(const authorityTime of ["2026-01-01T12:00:00.000Z","2026-01-01T13:00:00+01:00","2026-02-30T00:00:00Z","not-time"]) assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,evaluationClock:{...valid.evaluationClock,authorityTime}}),/POLICY_CLOCK_INVALID/);
  const required=sealPolicyDocument(core("p","approval_required")); const base=input(required); const approval=approvalFor(base);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...base,approval:{...approval,issuedAt:approval.expiresAt}}),/POLICY_APPROVAL_INVALID/);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...base,approval:{...approval,baseRevision:-1}}),/POLICY_APPROVAL_INVALID/);
});

test("snapshot and cursor ordering rejects stale or substituted authority views",()=>{
  const policy=sealPolicyDocument(core("p","accepted")); const base=input(policy); const moved={...cursor,runSequence:5}; const future={...cursor,runSequence:6};
  assert(evaluateAdmission({...base,evaluationClock:{...base.evaluationClock,observationCursor:moved}}).explanations.some((item)=>item.code==="STALE_EVALUATION_CURSOR"));
  assert(evaluateAdmission({...base,snapshots:{...base.snapshots,issueObservationCursor:future}}).explanations.some((item)=>item.code==="ISSUE_CURSOR_AFTER_EVALUATION"));
  assert(evaluateAdmission({...base,snapshots:{...base.snapshots,observedGrantDigest:"old"}}).explanations.some((item)=>item.code==="STALE_GRANT_SNAPSHOT"));
  assert.equal(evaluateAdmission({...base,snapshots:{...base.snapshots,quotaAvailable:false}}).result,"quarantined");
});

test("approval binds author, authenticated approver, issue snapshot and evaluation snapshot",()=>{
  const pinned=sealPolicyDocument(core("p","approval_required")); const base=input(pinned); const approval=approvalFor(base); assert.equal(evaluateAdmission({...base,approval}).result,"accepted");
  const rejected=[
    {...base,approval:{...approval,approverPrincipalId:"author"},snapshots:{...base.snapshots,authenticatedApproverPrincipalId:"author"}},
    {...base,approval:{...approval,approverPrincipalId:"mallory"}},
    {...base,approval:{...approval,issueObservationCursor:{...cursor,runSequence:2}}},
    {...base,approval:{...approval,evaluationObservationCursor:{...cursor,runSequence:3}}},
    {...base,approval:{...approval,proposalDigest:"replacement"}},
    {...base,approval:{...approval,baseRevision:2}},
  ];
  for(const scenario of rejected) assert.equal(evaluateAdmission(scenario as AdmissionEvaluationInputV1).result,"approval_required");
  assert.equal(evaluateAdmission({...base,approval,evaluationClock:{...base.evaluationClock,authorityTime:approval.expiresAt}}).result,"approval_required");
});

test("strict validators reject extras, duplicates and noncanonical collections",()=>{
  const valid=input(); assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,extra:true}),/POLICY_INPUT_INVALID/); assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,schemaVersion:"2"}),/POLICY_VERSION_UNSUPPORTED/);
  assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,paths:["/b","/a"]}),/POLICY_INPUT_INVALID/); assert.throws(()=>parseAdmissionEvaluationInputV1({...valid,evidence:[...valid.evidence,...valid.evidence]}),/POLICY_INPUT_INVALID/);
});
