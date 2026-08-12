import type { DatabaseSync } from "node:sqlite";
import { CURRENT_STORAGE_SCHEMA, MIGRATION_0002, inspectMigrationLedger, migrateVerifiedAuthority } from "../migrations.js";
import { verifyAuthority } from "../recovery/index.js";

export { CURRENT_STORAGE_SCHEMA, MIGRATION_0002 };

export function upgradeAuthority(db:DatabaseSync,artifactRoot:string):number[]{
  inspectMigrationLedger(db);
  verifyAuthority(db,artifactRoot,{allowPendingRetentionMissing:true}); // Authenticate semantic replay and referenced artifacts before schema mutation.
  migrateVerifiedAuthority(db);
  return (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {version:number}[]).map(row=>row.version);
}
export function requireLosslessDowngrade(db:DatabaseSync,targetVersion:number):void{
  const versions=(db.prepare("SELECT version FROM schema_migrations").all() as {version:number}[]).map(row=>row.version);
  const current=versions.length===0?0:Math.max(...versions);
  if(targetVersion===current)return;
  if(current===2&&targetVersion===1)throw new Error("major-version gate: storage schema v2 cannot be downgraded to v1 in place");
  throw new Error("major-version gate: unsupported downgrade");
}
