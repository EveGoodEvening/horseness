import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createBackup, verifyBackupIdentity } from "../../src/backup/index.js";
import { upgradeAuthority } from "../../src/migrations/index.js";
import {
  recoverInterruptedRestore,
  restoreBackup,
  rollbackFromRetainedBackup,
  type RestoreCrashPoint,
} from "../../src/restore/index.js";
import { SQLiteAuthority } from "../../src/sqlite-authority.js";

const journal = (databasePath: string): string => `${databasePath}.restore-intent.json`;

function makeAuthority(root: string, name: string, generation: string): { database: string; artifacts: string } {
  const database = join(root, `${name}.sqlite`);
  const artifacts = join(root, `${name}-artifacts`);
  const authority = new SQLiteAuthority(database, artifacts);
  upgradeAuthority(authority.db, artifacts);
  authority.db.exec("CREATE TABLE restore_generation(value TEXT NOT NULL, artifact_digest TEXT NOT NULL)");
  const record = authority.artifacts.publishAndRegister(generation, "text/plain");
  authority.db.prepare("INSERT INTO restore_generation(value, artifact_digest) VALUES (?, ?)").run(generation, record.digest);
  authority.close();
  return { database, artifacts };
}

function pairGeneration(database: string, artifacts: string): { database: string; artifacts: string } {
  assert.equal(existsSync(database), true, "database path must exist after reopen recovery");
  assert.equal(existsSync(artifacts), true, "artifact root must exist after reopen recovery");
  const db = new DatabaseSync(database);
  try {
    const row = db.prepare("SELECT value, artifact_digest FROM restore_generation").get();
    assert.ok(row && typeof row === "object" && "value" in row && typeof row.value === "string");
    assert.ok("artifact_digest" in row && typeof row.artifact_digest === "string");
    const artifact = db.prepare("SELECT relative_path FROM artifacts WHERE digest=?").get(row.artifact_digest);
    assert.ok(artifact && typeof artifact === "object" && "relative_path" in artifact && typeof artifact.relative_path === "string");
    return { database: row.value, artifacts: readFileSync(join(artifacts, artifact.relative_path), "utf8") };
  } finally { db.close(); }
}
function durableJournalPhase(database: string): string | undefined {
  const path = journal(database);
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || !("phase" in value) || typeof value.phase !== "string") {
    throw new Error("invalid test restore journal");
  }
  return value.phase;
}


function prepareCase(prefix: string): { root: string; backup: string; retained: string; database: string; artifacts: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const source = makeAuthority(root, "source", "new");
  const sourceDb = new DatabaseSync(source.database);
  const backup = join(root, "backup");
  createBackup(sourceDb, source.artifacts, backup);
  sourceDb.close();
  const target = makeAuthority(root, "target", "old");
  return { root, backup, retained: join(root, "retained-old"), database: target.database, artifacts: target.artifacts };
}

function confirmed(state: { retained: string }): { confirmReplacement: true; retainedBackupRoot: string } {
  return { confirmReplacement: true, retainedBackupRoot: state.retained };
}

test("restore refuses live replacement without explicit confirmation", () => {
  const state = prepareCase("horseness-restore-refusal-");
  try {
    assert.throws(() => restoreBackup(state.backup, state.database, state.artifacts), /explicit confirmation/);
    assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "old", artifacts: "old" });
    assert.equal(existsSync(state.retained), false);
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("pre-restore backup failure leaves live authority untouched", () => {
  const state = prepareCase("horseness-restore-prebackup-failure-");
  try {
    writeFileSync(state.retained, "occupied");
    assert.throws(() => restoreBackup(state.backup, state.database, state.artifacts, confirmed(state)), /destination already exists/);
    assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "old", artifacts: "old" });
    assert.equal(existsSync(journal(state.database)), false);
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("restore retains verified pre-restore backup and supports rollback", () => {
  const state = prepareCase("horseness-restore-retained-");
  try {
    const evidence = restoreBackup(state.backup, state.database, state.artifacts, confirmed(state));
    assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "new", artifacts: "new" });
    assert.deepEqual(evidence.retainedBackupIdentity, verifyBackupIdentity(state.retained));
    assert.equal(evidence.retainedBackupRoot, state.retained);
    const rollbackRetention = join(state.root, "retained-new");
    rollbackFromRetainedBackup(state.retained, state.database, state.artifacts, { confirmReplacement: true, retainedBackupRoot: rollbackRetention });
    assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "old", artifacts: "old" });
    assert.equal(verifyBackupIdentity(rollbackRetention).kind, "HorsenessVerifiedBackupIdentityV1");
    assert.equal(existsSync(state.retained), true);
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("restore records committed authority generation and removes its journal", () => {
  const state = prepareCase("horseness-restore-");
  try {
    restoreBackup(state.backup, state.database, state.artifacts, confirmed(state));
    assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "new", artifacts: "new" });
    assert.equal(existsSync(journal(state.database)), false);
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});

test("restore crash matrix never reopens a mixed database/artifact generation", () => {
  const observed: RestoreCrashPoint[] = [];
  const discovery = prepareCase("horseness-restore-discovery-");
  try {
    restoreBackup(discovery.backup, discovery.database, discovery.artifacts, confirmed(discovery), point => { observed.push(point); });
  } finally { rmSync(discovery.root, { recursive: true, force: true }); }
  assert.ok(observed.length > 0);

  for (let crashIndex = 0; crashIndex < observed.length; crashIndex += 1) {
    const state = prepareCase("horseness-restore-crash-");
    let visit = 0;
    try {
      assert.throws(
        () => restoreBackup(state.backup, state.database, state.artifacts, confirmed(state), point => {
          if (visit === crashIndex) throw new Error(`crash:${point}:${crashIndex}`);
          visit += 1;
        }),
        /crash:restore\./,
      );
      const durablePhase = durableJournalPhase(state.database);
      recoverInterruptedRestore(state.database, state.artifacts);
      const pair = pairGeneration(state.database, state.artifacts);
      assert.equal(pair.database, pair.artifacts, `mixed authority after ${observed[crashIndex]}`);
      if (durablePhase !== undefined) assert.equal(pair.database, durablePhase === "committed" ? "new" : "old", `wrong recovery direction after ${observed[crashIndex]}`);
      assert.equal(existsSync(journal(state.database)), false);
    } finally { rmSync(state.root, { recursive: true, force: true }); }
  }
});

test("recovery itself is idempotent across every rename and removal interruption", () => {
  const points = new Set<RestoreCrashPoint>();
  const discovery = prepareCase("horseness-recovery-discovery-");
  try {
    assert.throws(() => restoreBackup(discovery.backup, discovery.database, discovery.artifacts, confirmed(discovery), point => {
      if (point === "restore.remove.old-database.before") throw new Error("stop-after-commit");
    }), /stop-after-commit/);
    recoverInterruptedRestore(discovery.database, discovery.artifacts, point => { points.add(point); });
  } finally { rmSync(discovery.root, { recursive: true, force: true }); }

  for (const crashPoint of points) {
    const state = prepareCase("horseness-recovery-crash-");
    try {
      assert.throws(() => restoreBackup(state.backup, state.database, state.artifacts, confirmed(state), point => {
        if (point === "restore.remove.old-database.before") throw new Error("stop-after-commit");
      }), /stop-after-commit/);
      let crashed = false;
      assert.throws(() => recoverInterruptedRestore(state.database, state.artifacts, point => {
        if (!crashed && point === crashPoint) { crashed = true; throw new Error(`recovery-crash:${point}`); }
      }), /recovery-crash:/);
      recoverInterruptedRestore(state.database, state.artifacts);
      assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "new", artifacts: "new" });
      assert.equal(existsSync(journal(state.database)), false);
    } finally { rmSync(state.root, { recursive: true, force: true }); }
  }
});

test("rollback recovery is idempotent across every rename and removal interruption", () => {
  const points = new Set<RestoreCrashPoint>();
  const discovery = prepareCase("horseness-rollback-discovery-");
  try {
    assert.throws(() => restoreBackup(discovery.backup, discovery.database, discovery.artifacts, confirmed(discovery), point => {
      if (point === "restore.rename.database-activate.before") throw new Error("stop-before-commit");
    }), /stop-before-commit/);
    recoverInterruptedRestore(discovery.database, discovery.artifacts, point => { points.add(point); });
  } finally { rmSync(discovery.root, { recursive: true, force: true }); }

  for (const crashPoint of points) {
    const state = prepareCase("horseness-rollback-crash-");
    try {
      assert.throws(() => restoreBackup(state.backup, state.database, state.artifacts, confirmed(state), point => {
        if (point === "restore.rename.database-activate.before") throw new Error("stop-before-commit");
      }), /stop-before-commit/);
      let crashed = false;
      assert.throws(() => recoverInterruptedRestore(state.database, state.artifacts, point => {
        if (!crashed && point === crashPoint) { crashed = true; throw new Error(`rollback-crash:${point}`); }
      }), /rollback-crash:/);
      recoverInterruptedRestore(state.database, state.artifacts);
      assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "old", artifacts: "old" });
      assert.equal(existsSync(journal(state.database)), false);
    } finally { rmSync(state.root, { recursive: true, force: true }); }
  }
});

test("recovery rejects untrusted journal generations before victim mutation", () => {
  const maliciousTokens = [
    "../victim",
    "12345678-1234-4123-8123-123456789abc/../../victim",
    "x12345678-1234-4123-8123-123456789abc",
    "12345678-1234-4123-8123-123456789abc.old-prefix",
  ];
  for (const generationToken of maliciousTokens) {
    const state = prepareCase("horseness-journal-traversal-");
    const victim = join(state.root, "victim");
    try {
      writeFileSync(victim, "untouched");
      writeFileSync(journal(state.database), JSON.stringify({
        version: "HorsenessRestoreJournalV1",
        phase: "staged",
        generationToken,
        hadDatabase: true,
        hadArtifacts: true,
        retainedBackupRoot: null,
        retainedBackupIdentity: null,
      }));
      assert.throws(() => recoverInterruptedRestore(state.database, state.artifacts), /invalid restore journal/);
      assert.equal(readFileSync(victim, "utf8"), "untouched");
      assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "old", artifacts: "old" });
    } finally { rmSync(state.root, { recursive: true, force: true }); }
  }
});

test("recovery rejects legacy path fields and extra keys before mutation", () => {
  const state = prepareCase("horseness-journal-extra-");
  const victim = join(state.root, "victim");
  try {
    writeFileSync(victim, "untouched");
    writeFileSync(journal(state.database), JSON.stringify({
      version: "HorsenessRestoreJournalV1",
      phase: "staged",
      generationToken: "12345678-1234-4123-8123-123456789abc",
      hadDatabase: true,
      hadArtifacts: true,
      oldDatabase: victim,
      retainedBackupRoot: null,
      retainedBackupIdentity: null,
    }));
    assert.throws(() => recoverInterruptedRestore(state.database, state.artifacts), /invalid restore journal keys/);
    assert.equal(readFileSync(victim, "utf8"), "untouched");
    assert.deepEqual(pairGeneration(state.database, state.artifacts), { database: "old", artifacts: "old" });
  } finally { rmSync(state.root, { recursive: true, force: true }); }
});
