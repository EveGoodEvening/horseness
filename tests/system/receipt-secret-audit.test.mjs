import assert from "node:assert/strict";
import test from "node:test";
import { findReceiptAuthMaterial } from "./receipt-secret-audit.mjs";

test("receipt auth audit allows normative subscription, redaction, and provenance metadata", () => {
  const receipt = {
    authMode: "existing-user-subscription-session",
    archiveDigest: "sha256:public-provenance",
    executableDigest: "sha256:public-provenance",
    packageDigest: "sha256:public-provenance",
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

test("receipt auth audit rejects credential-bearing compound keys with opaque values", () => {
  const receipt = {
    accessToken: "opaque",
    refresh_token: "opaque",
    "id-token": "opaque",
    secretKey: "opaque",
    authToken: "opaque",
    privateKeyData: "opaque",
    credentialStore: "opaque",
    passwordHash: "opaque",
    apiSecret: "opaque",
  };

  assert.deepEqual(findReceiptAuthMaterial(receipt), [
    "$.accessToken has a credential-bearing key",
    "$.refresh_token has a credential-bearing key",
    "$.id-token has a credential-bearing key",
    "$.secretKey has a credential-bearing key",
    "$.authToken has a credential-bearing key",
    "$.privateKeyData has a credential-bearing key",
    "$.credentialStore has a credential-bearing key",
    "$.passwordHash has a credential-bearing key",
    "$.apiSecret has a credential-bearing key",
  ]);
});

test("receipt auth audit examines credential strings inside prohibitedFields and arbitrary fields", () => {
  const receipt = {
    arbitrary: "Bearer arbitrary-secret",
    redactionAudit: {
      prohibitedFields: ["token", "OPENAI_API_KEY", "sk-ant-abcdefghijklmnop"],
    },
  };

  assert.deepEqual(findReceiptAuthMaterial(receipt), [
    "$.arbitrary contains credential-shaped material",
    "$.redactionAudit.prohibitedFields.1 names a credential environment variable",
    "$.redactionAudit.prohibitedFields.2 contains credential-shaped material",
  ]);
});

test("receipt auth audit rejects forbidden environment names and token formats as values", () => {
  assert.deepEqual(findReceiptAuthMaterial({ details: ["ANTHROPIC_API_KEY", "sk-ant-abcdefghijklmnop"] }), [
    "$.details.0 names a credential environment variable",
    "$.details.1 contains credential-shaped material",
  ]);
});
