import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

test("lifecycle blackbox accepts the root argument separator and enforces the complete command order", { timeout: 30_000 }, () => {
  const script = resolve(import.meta.dirname, "../../../scripts/bootstrap/cli-lifecycle-blackbox.mjs");
  const commands = ["install", "upgrade", "downgrade", "rollback", "retry-install", "uninstall", "doctor", "repair", "rebind-workspace", "smoke"] as const;
  const accepted = spawnSync(process.execPath, ["--import", "tsx", script, "--", ...commands], { encoding: "utf8" });
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  assert.equal(accepted.stdout, "CLI lifecycle blackbox passed for 10 packed commands\n");

  const wrongOrder = spawnSync(process.execPath, ["--import", "tsx", script, "--", commands[1], commands[0], ...commands.slice(2)], { encoding: "utf8" });
  assert.notEqual(wrongOrder.status, 0);
  assert.match(wrongOrder.stderr, /CLI command registry mismatch/u);

  const incomplete = spawnSync(process.execPath, ["--import", "tsx", script, "--", ...commands.slice(0, -1)], { encoding: "utf8" });
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /CLI command registry mismatch/u);
});
