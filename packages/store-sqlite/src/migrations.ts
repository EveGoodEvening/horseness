import type { DatabaseSync } from "node:sqlite";

export const MIGRATION_0001 = `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE streams(stream_kind TEXT NOT NULL CHECK(stream_kind IN ('workspace','run')), workspace_id TEXT NOT NULL, stream_id TEXT NOT NULL, head_sequence INTEGER NOT NULL, head_hash TEXT, context_epoch INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(workspace_id,stream_kind,stream_id));
CREATE TABLE events(stream_kind TEXT NOT NULL, workspace_id TEXT NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL, envelope_hash TEXT NOT NULL, prior_envelope_hash TEXT, event_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_id TEXT NOT NULL, envelope_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,stream_kind,stream_id,sequence), UNIQUE(workspace_id,envelope_hash), UNIQUE(workspace_id,event_id), FOREIGN KEY(workspace_id,stream_kind,stream_id) REFERENCES streams(workspace_id,stream_kind,stream_id));
CREATE UNIQUE INDEX events_stream_idempotency ON events(workspace_id,stream_kind,stream_id,idempotency_key);
CREATE TABLE command_dedup(workspace_id TEXT NOT NULL, command_id TEXT NOT NULL, request_digest TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,command_id));
CREATE TABLE snapshots(workspace_id TEXT NOT NULL, stream_kind TEXT NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL, envelope_hash TEXT NOT NULL, projection_name TEXT NOT NULL, projection_version TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,stream_kind,stream_id,projection_name,projection_version,sequence), FOREIGN KEY(workspace_id,stream_kind,stream_id,sequence) REFERENCES events(workspace_id,stream_kind,stream_id,sequence));
CREATE TABLE projection_metadata(projection_name TEXT NOT NULL, projection_version TEXT NOT NULL, workspace_id TEXT NOT NULL, stream_kind TEXT NOT NULL, stream_id TEXT NOT NULL, last_sequence INTEGER NOT NULL, last_envelope_hash TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(projection_name,projection_version,workspace_id,stream_kind,stream_id), FOREIGN KEY(workspace_id,stream_kind,stream_id) REFERENCES streams(workspace_id,stream_kind,stream_id));
CREATE TABLE artifacts(digest TEXT PRIMARY KEY, byte_length INTEGER NOT NULL, relative_path TEXT NOT NULL UNIQUE, media_type TEXT, published_at TEXT NOT NULL);
CREATE TABLE artifact_refs(owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_kind,owner_id,digest), FOREIGN KEY(digest) REFERENCES artifacts(digest) ON DELETE RESTRICT);
CREATE TABLE artifact_pins(pin_id TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(pin_id,digest), FOREIGN KEY(digest) REFERENCES artifacts(digest) ON DELETE RESTRICT);
`;

const migrationName = "0001_initial_authority";

function inspectSchemaVersion(db: DatabaseSync): boolean {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (table === undefined) return false;
  const rows = db.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all() as {version:number;name:string}[];
  const newer = rows.find((row) => row.version > 1);
  if (newer !== undefined) throw new Error(`unsupported newer schema version ${newer.version}`);
  const versionOne = rows.find((row) => row.version === 1);
  if (versionOne !== undefined && versionOne.name !== migrationName) throw new Error("migration 0001 identity mismatch");
  return versionOne !== undefined;
}

export function migrate(db: DatabaseSync): void {
  // Version compatibility is checked before PRAGMAs or transactions that mutate database state.
  const migrationApplied = inspectSchemaVersion(db);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  if (migrationApplied) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(MIGRATION_0001);
    db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(1,?,?)").run(migrationName, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
