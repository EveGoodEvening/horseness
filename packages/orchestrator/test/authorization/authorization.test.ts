import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAdmission, type AuthoritativeAdmissionAuthorization } from "../../src/index.js";
const capability={schemaVersion:"1" as const,workspaceId:"w",runId:"r",commands:["submit-proposal" as const],issuer:"authority",delegatee:"worker",issuedObservationSequence:1,expiresObservationSequence:2,nonce:"n",revocationSequence:null};
const authority:AuthoritativeAdmissionAuthorization={role:"worker",capabilityId:"capability",capability,grantDigest:"g",revoked:false};
const subject={workspaceId:"w",runId:"r",principalId:"worker",observationSequence:2};
test("authorization binds identifier to durable principal, workspace, run, grant, and observation",()=>{
  assert.deepEqual(authorizeAdmission({capabilityId:"capability"},authority,subject),{allowed:true});
  assert.equal(authorizeAdmission({capabilityId:"substituted"},authority,subject).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"capability"},{...authority,capability:{...capability,workspaceId:"other"}},subject).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"capability"},{...authority,capability:{...capability,runId:"other"}},subject).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"capability"},{...authority,capability:{...capability,delegatee:"other"}},subject).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"capability"},{...authority,capability:{...capability,revocationSequence:2}},subject).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"capability"},{...authority,revoked:true},subject).allowed,false);
});
