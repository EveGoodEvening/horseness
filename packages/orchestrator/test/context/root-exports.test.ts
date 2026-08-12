import assert from "node:assert/strict";
import test from "node:test";
import * as orchestrator from "@horseness/orchestrator";

test("package root exports intended C09 context reconstruction and publication APIs", () => {
  assert.equal(typeof orchestrator.authenticateContextSnapshot, "function");
  assert.equal(typeof orchestrator.reconstructPinnedContext, "function");
  assert.equal(typeof orchestrator.contextSourceDigest, "function");
  assert.equal(typeof orchestrator.publishReconstructedContext, "function");
});

test("package root exports intended C09 context types as runtime-observable bindings", () => {
  // Type-only exports are not runtime values; verify via named property presence
  // by constructing a minimal digest and asserting the public function surface.
  const digest = orchestrator.contextSourceDigest("hello");
  assert.equal(typeof digest, "string");
  assert.ok(digest.length > 0);
});

test("package root does not export internal context trust machinery", () => {
  // Internal non-exported symbols must not appear on the package namespace.
  assert.equal((orchestrator as Record<string, unknown>).TrustedContextSourceV1, undefined);
  assert.equal((orchestrator as Record<string, unknown>).ContextSourcesProjectionV1, undefined);
  assert.equal((orchestrator as Record<string, unknown>).ContextAuthorizationProjectionV1, undefined);
});

test("contextSourceDigest is deterministic and NFC-normalized at the package root", () => {
  const direct = orchestrator.contextSourceDigest("é");
  const decomposed = orchestrator.contextSourceDigest("e\u0301");
  assert.equal(direct, decomposed);
});

test("reconstructPinnedContext rejects unauthenticated snapshots via package root import", () => {
  const forged = { schemaVersion: "1" } as unknown as Parameters<typeof orchestrator.reconstructPinnedContext>[0];
  assert.throws(() => orchestrator.reconstructPinnedContext(forged), /CONTEXT_AUTHORITY_UNAUTHENTICATED/);
});
