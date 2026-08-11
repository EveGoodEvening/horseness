import assert from "node:assert/strict";
import test from "node:test";
import { VECTOR_FAMILIES, verifyFamilies, verifyVector } from "../bin/vectors-verify.mjs";

test("all eleven versioned vector families execute the public contract", () => {
  assert.deepEqual(VECTOR_FAMILIES, ["events", "cursors", "proposal", "delta", "fork-pin", "dependency-join", "delta-authority", "context-binding", "receipt", "task-dispatch", "authorization"]);
  assert.ok(verifyFamilies(VECTOR_FAMILIES) >= VECTOR_FAMILIES.length);
});

test("the shared vector assertion fails on an expected-result mutation", () => {
  assert.throws(() => verifyVector({ schemaVersion: "2", familyVersion: "1", family: "authorization", case: "mutated-expectation", action: "authorizeCommand", input: { role: "operator", command: "policy-admin", capability: { schemaVersion: "1", workspaceId: "ws", commands: ["policy-admin"], issuer: "authority", delegatee: "operator", issuedObservationSequence: 1, expiresObservationSequence: 9, nonce: "n", revocationSequence: null }, workspaceId: "ws", observationSequence: 2, grantDigest: "g", expectedGrantDigest: "g" }, expected: { allowed: true } }, "authorization"), /result mismatch/);
});
