import assert from "node:assert/strict";
import test from "node:test";
import { verifyVector } from "../bin/vectors-verify.mjs";

void test("the shared vector assertion fails on an expected-result mutation", () => {
  assert.throws(() => { verifyVector({ schemaVersion: "2", familyVersion: "1", family: "authorization", case: "mutated-expectation", action: "authorizeCommand", input: { role: "operator", command: "policy-admin", capability: { schemaVersion: "1", workspaceId: "ws", commands: ["policy-admin"], issuer: "authority", delegatee: "operator", issuedObservationSequence: 1, expiresObservationSequence: 9, nonce: "n", revocationSequence: null }, workspaceId: "ws", observationSequence: 2, grantDigest: "g", expectedGrantDigest: "g" }, expected: { allowed: true } }, "authorization"); }, /result mismatch/);
});
