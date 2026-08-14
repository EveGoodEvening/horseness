import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyMigrationFixture, InstallerMigrationEngine, InstallerMigrationError, type MigrationCrashPointV1 } from "../../src/migrations/index.js";

const points: readonly MigrationCrashPointV1[] = ["after-begin", "after-backup", "after-stage-fsync", "after-activate-rename", "after-activate-fsync"];
for (const point of points) {
  test(`migration recovers durably from ${point}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "horseness-migration-"));
    try {
      const engine = await InstallerMigrationEngine.open(root);
      await writeFile(join(engine.activeHome, "home.json"), "legacy\n", { mode: 0o600 });
      await assert.rejects(engine.migrate({ schema: "horseness.migration-plan.v1", transactionId: `tx-${point}`, fromVersion: "0.0.0-compat.1", toVersion: "0.0.0", reversible: true, explicitMajorGate: false, transform: copyMigrationFixture }, (observed) => {
        if (observed === point) throw new InstallerMigrationError("INJECTED_CRASH");
      }), (error: unknown) => error instanceof InstallerMigrationError && error.code === "INJECTED_CRASH");
      const reopened = await InstallerMigrationEngine.open(root);
      const recovered = await reopened.recover();
      assert.equal(recovered.installedVersion, "0.0.0-compat.1");
      assert.equal(recovered.phase === "compensated" || recovered.phase === "repair-required", true);
      if (recovered.phase === "compensated") assert.equal(await readFile(join(reopened.activeHome, "home.json"), "utf8"), "legacy\n");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("failed transformation compensates and uninstall-after-upgrade remains journaled", async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-compensation-"));
  try {
    const engine = await InstallerMigrationEngine.open(root);
    await writeFile(join(engine.activeHome, "home.json"), "legacy\n", { mode: 0o600 });
    const state = await engine.migrate({ schema: "horseness.migration-plan.v1", transactionId: "tx-failed", fromVersion: "0.0.0-compat.1", toVersion: "0.0.0", reversible: true, explicitMajorGate: false, transform: async () => { throw new Error("transform failed"); } });
    assert.equal(state.phase, "compensated");
    await engine.markUninstallPending("tx-uninstall");
    await engine.markUninstalled("tx-uninstall");
    assert.deepEqual((await engine.journal.read(state.generation)).slice(-2).map((entry) => entry.payload.operation), ["uninstall-pending", "uninstalled"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("major downgrade requires an explicit gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-downgrade-"));
  try {
    const engine = await InstallerMigrationEngine.open(root, "1.0.0");
    await assert.rejects(engine.requireDowngrade("0.0.0", false), (error: unknown) => error instanceof InstallerMigrationError && error.code === "DOWNGRADE_MAJOR_GATE_REQUIRED");
    await engine.requireDowngrade("0.0.0", true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
