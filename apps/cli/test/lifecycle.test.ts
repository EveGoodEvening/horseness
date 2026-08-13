import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readProtectedSecretFileV1 } from "../src/lifecycle.js";
import { AuthorizedLocalTransportV1, CliTransportError } from "../src/transport.js";

function createTemporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "horseness-cli-lifecycle-"));
}

test("protected secret input rejects broad permissions without disclosing material", () => {
  const directory = createTemporaryDirectory();
  const path = join(directory, "credential");
  try {
    const secret = "sk_should-never-appear";
    writeFileSync(path, secret, { mode: 0o644 });
    assert.throws(
      () => readProtectedSecretFileV1(path),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes(secret) &&
        "code" in error &&
        error.code === "LIFECYCLE_SECRET_FILE_INVALID",
    );
    chmodSync(path, 0o600);
    assert.equal(readProtectedSecretFileV1(path), secret);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local transport accepts only opaque grant references and never reports their value", async () => {
  const transport = new AuthorizedLocalTransportV1(join(createTemporaryDirectory(), "missing.sock"));
  const raw = "bearer raw-secret";
  await assert.rejects(
    transport.request(
      { jsonrpc: "2.0", id: 1, method: "run.list.v1", params: {} as never },
      {
        schemaVersion: "1",
        kind: "host-reference",
        reference: raw,
        scope: { workspaceId: "w", adapterId: "cli", purpose: "coordinator" },
      },
    ),
    (error: unknown) => error instanceof CliTransportError && !error.message.includes(raw),
  );
});
