import type { DatabaseSync } from "node:sqlite";

export const MIGRATION_0001 = `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE streams(stream_kind TEXT NOT NULL CHECK(stream_kind IN ('workspace','run')), workspace_id TEXT NOT NULL, stream_id TEXT NOT NULL, head_sequence INTEGER NOT NULL, head_hash TEXT, context_epoch INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(workspace_id,stream_kind,stream_id));
CREATE TABLE events(stream_kind TEXT NOT NULL, workspace_id TEXT NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL, envelope_hash TEXT NOT NULL, prior_envelope_hash TEXT, event_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_id TEXT NOT NULL, envelope_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,stream_kind,stream_id,sequence), UNIQUE(workspace_id,envelope_hash), UNIQUE(workspace_id,event_id), FOREIGN KEY(workspace_id,stream_kind,stream_id) REFERENCES streams(workspace_id,stream_kind,stream_id));
CREATE UNIQUE INDEX events_stream_idempotency ON events(workspace_id,stream_kind,stream_id,idempotency_key);
CREATE TABLE command_dedup(workspace_id TEXT NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('workspace','run')), scope_id TEXT NOT NULL, command_id TEXT NOT NULL, request_digest TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,scope_kind,scope_id,command_id), CHECK((scope_kind='workspace' AND scope_id=workspace_id) OR scope_kind='run'));
CREATE TABLE authority_consumption(workspace_id TEXT NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('workspace','run')), scope_id TEXT NOT NULL, principal_id TEXT NOT NULL, authority_key TEXT NOT NULL, command_id TEXT NOT NULL, consumed_at TEXT NOT NULL, PRIMARY KEY(workspace_id,scope_kind,scope_id,principal_id,authority_key), CHECK((scope_kind='workspace' AND scope_id=workspace_id) OR scope_kind='run'));
CREATE TABLE snapshots(workspace_id TEXT NOT NULL, stream_kind TEXT NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL, envelope_hash TEXT NOT NULL, projection_name TEXT NOT NULL, projection_version TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,stream_kind,stream_id,projection_name,projection_version,sequence), FOREIGN KEY(workspace_id,stream_kind,stream_id,sequence) REFERENCES events(workspace_id,stream_kind,stream_id,sequence));
CREATE TABLE projection_metadata(projection_name TEXT NOT NULL, projection_version TEXT NOT NULL, workspace_id TEXT NOT NULL, stream_kind TEXT NOT NULL, stream_id TEXT NOT NULL, last_sequence INTEGER NOT NULL, last_envelope_hash TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(projection_name,projection_version,workspace_id,stream_kind,stream_id), FOREIGN KEY(workspace_id,stream_kind,stream_id) REFERENCES streams(workspace_id,stream_kind,stream_id));
CREATE TABLE artifacts(digest TEXT PRIMARY KEY, byte_length INTEGER NOT NULL, relative_path TEXT NOT NULL UNIQUE, media_type TEXT, published_at TEXT NOT NULL);
CREATE TABLE artifact_refs(workspace_id TEXT NOT NULL, owner_kind TEXT NOT NULL CHECK(owner_kind='event'), owner_id TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,owner_kind,owner_id,digest), FOREIGN KEY(digest) REFERENCES artifacts(digest) ON DELETE RESTRICT, FOREIGN KEY(workspace_id,owner_id) REFERENCES events(workspace_id,event_id) ON DELETE RESTRICT);
CREATE TABLE artifact_pins(pin_id TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(pin_id,digest), FOREIGN KEY(digest) REFERENCES artifacts(digest) ON DELETE RESTRICT);
`;

export const MIGRATION_0002 = `
CREATE TABLE retention_intents(intent_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('pending','deleting','deleted')), created_at TEXT NOT NULL, delete_committed_at TEXT, completed_at TEXT);
CREATE TABLE artifact_tombstones(digest TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, deleted_at TEXT NOT NULL, intent_id TEXT NOT NULL UNIQUE, FOREIGN KEY(intent_id) REFERENCES retention_intents(intent_id));
CREATE TRIGGER retention_blocks_refs BEFORE INSERT ON artifact_refs WHEN EXISTS(SELECT 1 FROM retention_intents WHERE digest=NEW.digest) BEGIN SELECT RAISE(ABORT,'artifact is under retention'); END;
CREATE TRIGGER retention_blocks_pins BEFORE INSERT ON artifact_pins WHEN EXISTS(SELECT 1 FROM retention_intents WHERE digest=NEW.digest) BEGIN SELECT RAISE(ABORT,'artifact is under retention'); END;
`;

export const CURRENT_STORAGE_SCHEMA = 2;

const migrations = [
  { version: 1, name: "0001_initial_authority", sql: MIGRATION_0001 },
  { version: 2, name: "0002_retention_recovery", sql: MIGRATION_0002 },
] as const;

export function inspectMigrationLedger(db: DatabaseSync): number {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (table === undefined) return 0;
  const rows = db.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all() as {version:number;name:string}[];
  const newer = rows.find((row) => row.version > CURRENT_STORAGE_SCHEMA);
  if (newer !== undefined) throw new Error(`unsupported newer schema version ${newer.version}`);
  for (const [index, row] of rows.entries()) {
    const expected = migrations[index];
    if (expected === undefined) {
      if (row.version > CURRENT_STORAGE_SCHEMA) throw new Error(`unsupported newer schema version ${row.version}`);
      throw new Error(`unknown migration ledger entry ${row.version}`);
    }
    if (row.version !== expected.version || row.name !== expected.name) {
      throw new Error(`migration ${String(expected.version).padStart(4, "0")} identity/order mismatch`);
    }
  }
  return rows.length;
}

function applyMigrations(db: DatabaseSync, appliedCount: number): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  for (const migration of migrations.slice(appliedCount)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)").run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function migrate(db: DatabaseSync): void {
  // Fresh creation and exact-current reopen are safe without authenticating prior authority.
  const appliedCount = inspectMigrationLedger(db);
  if (appliedCount > 0 && appliedCount < CURRENT_STORAGE_SCHEMA) {
    throw new Error("verified authority upgrade required");
  }
  applyMigrations(db, appliedCount);
}

export function migrateVerifiedAuthority(db: DatabaseSync): void {
  // The caller must authenticate the complete authority unit immediately before this mutation.
  applyMigrations(db, inspectMigrationLedger(db));
}
