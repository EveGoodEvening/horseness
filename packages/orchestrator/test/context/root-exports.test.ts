import assert from "node:assert/strict";
import test from "node:test";
import * as orchestrator from "@horseness/orchestrator";

test("contextSourceDigest is deterministic and NFC-normalized at the package root", () => {
  const direct = orchestrator.contextSourceDigest("é");
  const decomposed = orchestrator.contextSourceDigest("e\u0301");
  assert.equal(direct, decomposed);
});

test("reconstructPinnedContext rejects unauthenticated snapshots via package root import", () => {
  const forged = { schemaVersion: "1" } as unknown as Parameters<typeof orchestrator.reconstructPinnedContext>[0];
  assert.throws(() => orchestrator.reconstructPinnedContext(forged), /CONTEXT_AUTHORITY_UNAUTHENTICATED/);
});
