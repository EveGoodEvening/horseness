import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteAuthority } from "../../src/sqlite-authority.js";
import { createBackup } from "../../src/backup/index.js";
import { upgradeAuthority } from "../../src/migrations/index.js";
import { recoverInterruptedRestore, restoreBackup } from "../../src/restore/index.js";
import { verifyAuthority } from "../../src/recovery/index.js";

test("restore stages, verifies and atomically replaces authority",()=>{const root=mkdtempSync(join(tmpdir(),"horseness-restore-"));const sourceDb=join(root,"source.sqlite"),sourceArtifacts=join(root,"source-artifacts");new SQLiteAuthority(sourceDb,sourceArtifacts).close();const source=new DatabaseSync(sourceDb);upgradeAuthority(source,sourceArtifacts);const backup=join(root,"backup");createBackup(source,sourceArtifacts,backup);source.close();const targetDb=join(root,"target.sqlite"),targetArtifacts=join(root,"target-artifacts");restoreBackup(backup,targetDb,targetArtifacts);const target=new DatabaseSync(targetDb);assert.deepEqual(verifyAuthority(target,targetArtifacts),{streams:0,events:0,artifacts:0});target.close();rmSync(root,{recursive:true,force:true});});
test("startup recovery rolls an interrupted swap back",()=>{const root=mkdtempSync(join(tmpdir(),"horseness-recover-"));const db=join(root,"a.sqlite"),artifacts=join(root,"artifacts"),oldDb=`${db}.old-x`,oldArtifacts=`${artifacts}.old-x`,stageDb=`${db}.stage`,stageArtifacts=`${artifacts}.stage`;writeFileSync(oldDb,"old");writeFileSync(`${db}.restore-intent.json`,JSON.stringify({databasePath:db,artifactRoot:artifacts,oldDatabase:oldDb,oldArtifacts,stageDatabase:stageDb,stageArtifacts}));recoverInterruptedRestore(db,artifacts);assert.equal(readFileSync(db,"utf8"),"old");assert.equal(existsSync(`${db}.restore-intent.json`),false);rmSync(root,{recursive:true,force:true});});
