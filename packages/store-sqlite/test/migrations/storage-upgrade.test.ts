import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteAuthority } from "../../src/sqlite-authority.js";
import { createBackup, verifyBackup } from "../../src/backup/index.js";
import { requireLosslessDowngrade, upgradeAuthority } from "../../src/migrations/index.js";

const setup=()=>{const root=mkdtempSync(join(tmpdir(),"horseness-c06-"));const database=join(root,"authority.sqlite"),artifacts=join(root,"artifacts");new SQLiteAuthority(database,artifacts).close();const db=new DatabaseSync(database);return{root,database,artifacts,db};};
test("upgrade verifies authority and is idempotent while every v2 to v1 downgrade is major-gated",()=>{const x=setup();try{assert.deepEqual(upgradeAuthority(x.db,x.artifacts),[1,2]);assert.deepEqual(upgradeAuthority(x.db,x.artifacts),[1,2]);assert.throws(()=>requireLosslessDowngrade(x.db,1),/storage schema v2 cannot be downgraded to v1 in place/);x.db.prepare("INSERT INTO retention_intents(intent_id,workspace_id,digest,state,created_at) VALUES('i','w',?,'pending',?)").run("a".repeat(64),new Date().toISOString());assert.throws(()=>requireLosslessDowngrade(x.db,1),/major-version gate/);assert.doesNotThrow(()=>requireLosslessDowngrade(x.db,2));assert.throws(()=>requireLosslessDowngrade(x.db,0),/unsupported downgrade/);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
test("raw chain corruption rejects before schema upcast",()=>{const x=setup();try{x.db.prepare("INSERT INTO streams VALUES('workspace','w','w',0,NULL,0)").run();assert.throws(()=>upgradeAuthority(x.db,x.artifacts),/raw event-chain verification failed/);assert.equal(x.db.prepare("SELECT 1 FROM schema_migrations WHERE version=2").get(),undefined);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
test("backup manifest binds database and artifacts",()=>{const x=setup();try{upgradeAuthority(x.db,x.artifacts);const backup=join(x.root,"backup");const manifest=createBackup(x.db,x.artifacts,backup);const verified=verifyBackup(backup);assert.equal(verified.database.digest,manifest.database.digest);const databasePath=join(backup,verified.database.file),bytes=readFileSync(databasePath);writeFileSync(databasePath,Buffer.concat([bytes,Buffer.from("x")]));assert.throws(()=>verifyBackup(backup),/digest mismatch/);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
