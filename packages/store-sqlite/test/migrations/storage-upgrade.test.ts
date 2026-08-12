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
test("upgrade verifies authority and is idempotent",()=>{const x=setup();try{assert.deepEqual(upgradeAuthority(x.db,x.artifacts),[1,2]);assert.deepEqual(upgradeAuthority(x.db,x.artifacts),[1,2]);requireLosslessDowngrade(x.db,1);x.db.prepare("INSERT INTO retention_intents VALUES('i','w',?,'pending',?,NULL)").run("a".repeat(64),new Date().toISOString());assert.throws(()=>requireLosslessDowngrade(x.db,1),/major-version gate/);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
test("raw chain corruption rejects before schema upcast",()=>{const x=setup();try{x.db.prepare("INSERT INTO streams VALUES('workspace','w','w',0,NULL,0)").run();assert.throws(()=>upgradeAuthority(x.db,x.artifacts),/raw event-chain verification failed/);assert.equal(x.db.prepare("SELECT 1 FROM schema_migrations WHERE version=2").get(),undefined);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
test("backup manifest binds database and artifacts",()=>{const x=setup();try{upgradeAuthority(x.db,x.artifacts);const backup=join(x.root,"backup");const manifest=createBackup(x.db,x.artifacts,backup);assert.equal(verifyBackup(backup).database.digest,manifest.database.digest);const bytes=readFileSync(join(backup,"authority.sqlite"));writeFileSync(join(backup,"authority.sqlite"),Buffer.concat([bytes,Buffer.from("x")]));assert.throws(()=>verifyBackup(backup),/digest mismatch/);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
