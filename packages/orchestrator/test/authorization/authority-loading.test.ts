import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAdmission, type AuthoritativeAdmissionAuthorization } from "../../src/index.js";

const capability={schemaVersion:"1" as const,workspaceId:"w",runId:"r",commands:["submit-proposal" as const],issuer:"authority",delegatee:"worker",issuedObservationSequence:1,expiresObservationSequence:20,nonce:"durable-capability",revocationSequence:null};
const durable:AuthoritativeAdmissionAuthorization={role:"worker",capabilityId:"cap-1",capability,grantDigest:"durable-grant",revoked:false};
const subject={workspaceId:"w",runId:"r",principalId:"worker",observationSequence:10};

test("request authorization contains only an identifier and durable grant controls admission",()=>{
  assert.deepEqual(authorizeAdmission({capabilityId:"cap-1"},durable,subject),{allowed:true});
  assert.equal(authorizeAdmission({capabilityId:"invented"},durable,subject).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"cap-1"},{...durable,revoked:true},subject).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"cap-1"},{...durable,grantDigest:"current-grant"},subject).allowed,true);
});

test("durable capability scope and evaluation sequence reject substitutions",()=>{
  assert.equal(authorizeAdmission({capabilityId:"cap-1"},{...durable,capability:{...capability,workspaceId:"other"}},subject).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"cap-1"},durable,{...subject,observationSequence:21}).allowed,false);
  assert.equal(authorizeAdmission({capabilityId:"cap-1"},{...durable,capability:{...capability,delegatee:"other"}},subject).allowed,false);
});
