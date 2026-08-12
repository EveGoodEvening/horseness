import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync as Database } from "node:sqlite";
import { verifyBackup } from "../backup/index.js";
import { verifyAuthority } from "../recovery/index.js";

const tables=["streams","events","command_dedup","authority_consumption","snapshots","projection_metadata","artifacts","artifact_refs","artifact_pins"] as const;
export interface ImportResult {workspaces:readonly string[];events:number;artifacts:number}
export function importBackup(db:Database,artifactRoot:string,backupRoot:string):ImportResult{
  const manifest=verifyBackup(backupRoot);const temp=mkdtempSync(join(tmpdir(),"horseness-import-"));const isolatedDb=join(temp,"authority.sqlite");const isolatedArtifacts=join(temp,"artifacts");
  try{
    cpSync(join(backupRoot,manifest.database.file),isolatedDb);cpSync(join(backupRoot,"artifacts"),isolatedArtifacts,{recursive:true});const source=new DatabaseSync(isolatedDb);
    try{
      verifyAuthority(source,isolatedArtifacts);
      const local=(db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {version:number}).version;const remote=(source.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {version:number}).version;if(local!==remote)throw new Error("import schema/version mismatch");
      const workspaces=(source.prepare("SELECT DISTINCT workspace_id FROM streams ORDER BY workspace_id").all() as {workspace_id:string}[]).map(r=>r.workspace_id);for(const id of workspaces)if(db.prepare("SELECT 1 FROM streams WHERE workspace_id=? LIMIT 1").get(id)!==undefined)throw new Error(`import workspace identity conflict: ${id}`);
      for(const item of manifest.artifacts){const from=join(isolatedArtifacts,item.path),to=join(artifactRoot,item.path);if(existsSync(to)){if(readFileSync(to).equals(readFileSync(from)))continue;throw new Error(`import artifact conflict: ${item.path}`);}mkdirSync(dirname(to),{recursive:true});cpSync(from,to);}
      db.exec("BEGIN IMMEDIATE");try{db.exec(`ATTACH DATABASE '${isolatedDb.replaceAll("'","''")}' AS imported`);for(const table of tables)db.exec(`INSERT INTO main.${table} SELECT * FROM imported.${table}`);db.exec("COMMIT");db.exec("DETACH DATABASE imported");}catch(error){if(db.isTransaction)db.exec("ROLLBACK");try{db.exec("DETACH DATABASE imported");}catch(detachError){void detachError;}throw error;}
      verifyAuthority(db,artifactRoot);const count=source.prepare("SELECT count(*) AS count FROM events").get() as {count:number};return{workspaces,events:count.count,artifacts:manifest.artifacts.length};
    }finally{source.close();}
  }finally{rmSync(temp,{recursive:true,force:true});}
}
