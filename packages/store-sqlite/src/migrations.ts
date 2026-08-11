import type { DatabaseSync } from "node:sqlite";

export const MIGRATION_0001 = `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS streams(stream_kind TEXT NOT NULL CHECK(stream_kind IN ('workspace','run')), workspace_id TEXT NOT NULL, stream_id TEXT NOT NULL, head_sequence INTEGER NOT NULL, head_hash TEXT, context_epoch INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(stream_kind,stream_id));
CREATE TABLE IF NOT EXISTS events(stream_kind TEXT NOT NULL, workspace_id TEXT NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL, envelope_hash TEXT NOT NULL UNIQUE, prior_envelope_hash TEXT, event_id TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL, command_id TEXT NOT NULL, envelope_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(stream_kind,stream_id,sequence), FOREIGN KEY(stream_kind,stream_id) REFERENCES streams(stream_kind,stream_id));
CREATE UNIQUE INDEX IF NOT EXISTS events_stream_idempotency ON events(stream_kind,stream_id,idempotency_key);
CREATE TABLE IF NOT EXISTS command_dedup(command_id TEXT PRIMARY KEY, request_digest TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots(stream_kind TEXT NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL, envelope_hash TEXT NOT NULL, projection_name TEXT NOT NULL, projection_version TEXT NOT NULL, state_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(stream_kind,stream_id,projection_name,projection_version,sequence));
CREATE TABLE IF NOT EXISTS projection_metadata(projection_name TEXT NOT NULL, projection_version TEXT NOT NULL, stream_kind TEXT NOT NULL, stream_id TEXT NOT NULL, last_sequence INTEGER NOT NULL, last_envelope_hash TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(projection_name,projection_version,stream_kind,stream_id));
CREATE TABLE IF NOT EXISTS artifacts(digest TEXT PRIMARY KEY, byte_length INTEGER NOT NULL, relative_path TEXT NOT NULL UNIQUE, media_type TEXT, published_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS artifact_refs(owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner_kind,owner_id,digest), FOREIGN KEY(digest) REFERENCES artifacts(digest) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS artifact_pins(pin_id TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(pin_id,digest), FOREIGN KEY(digest) REFERENCES artifacts(digest) ON DELETE RESTRICT);
`;

export function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(MIGRATION_0001);
    const found = db.prepare("SELECT name FROM schema_migrations WHERE version=1").get() as {name:string}|undefined;
    if (found !== undefined && found.name !== "0001_initial_authority") throw new Error("migration 0001 identity mismatch");
    db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(1,?,?)").run("0001_initial_authority", new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
