import assert from "node:assert/strict";
import test from "node:test";
import { findReceiptAuthMaterial } from "./receipt-secret-audit.mjs";

test("receipt auth audit allows normative subscription and redaction metadata", () => {
  const receipt = {
    authMode: "existing-user-subscription-session",
    redactionAudit: {
      passed: true,
      prohibitedFields: ["account", "authorization", "cookie", "credential", "token", "tokenFingerprint"],
    },
  };

  assert.deepEqual(findReceiptAuthMaterial(receipt), []);
});

test("receipt auth audit recursively rejects credential keys and credential-shaped values", () => {
  const receipt = {
    nested: {
      authorization: "Bearer redacted-but-still-present",
      output: [
        { OPENAI_API_KEY: "redacted" },
        { text: "Bearer abc.def-123" },
      ],
    },
  };

  assert.deepEqual(findReceiptAuthMaterial(receipt), [
    "$.nested.authorization has a credential-bearing key",
    "$.nested.authorization contains credential-shaped material",
    "$.nested.output.0.OPENAI_API_KEY has a credential-bearing key",
    "$.nested.output.1.text contains credential-shaped material",
  ]);
});

test("receipt auth audit rejects forbidden environment names and token formats as values", () => {
  assert.deepEqual(findReceiptAuthMaterial({ details: ["ANTHROPIC_API_KEY", "sk-ant-abcdefghijklmnop"] }), [
    "$.details.0 names a credential environment variable",
    "$.details.1 contains credential-shaped material",
  ]);
});
