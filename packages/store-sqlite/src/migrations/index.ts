import type { DatabaseSync } from "node:sqlite";
import { verifyAuthority } from "../recovery/index.js";

export const CURRENT_STORAGE_SCHEMA=2;
const V2=`
CREATE TABLE retention_intents(intent_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('pending','deleting','deleted')), created_at TEXT NOT NULL, delete_committed_at TEXT, completed_at TEXT);
CREATE TABLE artifact_tombstones(digest TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, deleted_at TEXT NOT NULL, intent_id TEXT NOT NULL UNIQUE, FOREIGN KEY(intent_id) REFERENCES retention_intents(intent_id));
CREATE TRIGGER retention_blocks_refs BEFORE INSERT ON artifact_refs WHEN EXISTS(SELECT 1 FROM retention_intents WHERE digest=NEW.digest) BEGIN SELECT RAISE(ABORT,'artifact is under retention'); END;
CREATE TRIGGER retention_blocks_pins BEFORE INSERT ON artifact_pins WHEN EXISTS(SELECT 1 FROM retention_intents WHERE digest=NEW.digest) BEGIN SELECT RAISE(ABORT,'artifact is under retention'); END;`;
export function upgradeAuthority(db:DatabaseSync,artifactRoot:string):number[]{
  verifyAuthority(db,artifactRoot,{allowPendingRetentionMissing:true}); // Raw chains and references are authenticated before any upcast/schema write; only a durable unreferenced deletion intent may explain an absent object.
  const rows=db.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all() as {version:number;name:string}[];
  if(rows.some(r=>r.version>CURRENT_STORAGE_SCHEMA))throw new Error("major-version gate: authority schema is newer than this runtime");
  if(rows.some(r=>r.version===1&&r.name!=="0001_initial_authority"))throw new Error("migration identity mismatch");
  if(!rows.some(r=>r.version===2)){db.exec("BEGIN IMMEDIATE");try{db.exec(V2);db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(2,'0002_retention_recovery',?)").run(new Date().toISOString());db.exec("COMMIT");}catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}}
  return (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {version:number}[]).map(r=>r.version);
}
export function requireLosslessDowngrade(db:DatabaseSync,targetVersion:number):void{
  const versions=(db.prepare("SELECT version FROM schema_migrations").all() as {version:number}[]).map(row=>row.version);
  const current=versions.length===0?0:Math.max(...versions);
  if(targetVersion===current)return;
  if(current===2&&targetVersion===1)throw new Error("major-version gate: storage schema v2 cannot be downgraded to v1 in place");
  throw new Error("major-version gate: unsupported downgrade");
}
