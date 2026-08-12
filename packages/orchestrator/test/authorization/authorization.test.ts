import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAdmission } from "../../src/index.js";
const capability={schemaVersion:"1" as const,workspaceId:"w",runId:"r",commands:["submit-proposal" as const],issuer:"authority",delegatee:"worker",issuedObservationSequence:1,expiresObservationSequence:2,nonce:"n",revocationSequence:null};
test("authorization binds principal workspace run grant and observation",()=>{assert.deepEqual(authorizeAdmission({role:"worker",capability,expectedGrantDigest:"g"},{workspaceId:"w",runId:"r",principalId:"worker",grantDigest:"g",observationSequence:2}),{allowed:true});assert.equal(authorizeAdmission({role:"worker",capability:{...capability,revocationSequence:2},expectedGrantDigest:"g"},{workspaceId:"w",runId:"r",principalId:"worker",grantDigest:"g",observationSequence:2}).allowed,false);});
