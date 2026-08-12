import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { verifyBackup } from "../backup/index.js";
import { verifyAuthority } from "../recovery/index.js";

interface RestoreJournal {databasePath:string;artifactRoot:string;oldDatabase:string;oldArtifacts:string;stageDatabase:string;stageArtifacts:string}
const journalPath=(databasePath:string):string=>`${databasePath}.restore-intent.json`;
export function recoverInterruptedRestore(databasePath:string,artifactRoot:string):void{
  const path=journalPath(databasePath);if(!existsSync(path))return;const j=JSON.parse(readFileSync(path,"utf8")) as RestoreJournal;
  if(!existsSync(databasePath)&&existsSync(j.oldDatabase))renameSync(j.oldDatabase,databasePath);
  if(!existsSync(artifactRoot)&&existsSync(j.oldArtifacts))renameSync(j.oldArtifacts,artifactRoot);
  rmSync(j.stageDatabase,{force:true});rmSync(j.stageArtifacts,{recursive:true,force:true});
  if(existsSync(j.oldDatabase))rmSync(j.oldDatabase,{force:true});if(existsSync(j.oldArtifacts))rmSync(j.oldArtifacts,{recursive:true,force:true});rmSync(path,{force:true});
}
export function restoreBackup(backupRoot:string,databasePath:string,artifactRoot:string):void{
  const manifest=verifyBackup(backupRoot);recoverInterruptedRestore(databasePath,artifactRoot);mkdirSync(dirname(databasePath),{recursive:true});mkdirSync(dirname(artifactRoot),{recursive:true});const token=randomUUID();
  const stageDatabase=`${databasePath}.restore-${token}`;const stageArtifacts=`${artifactRoot}.restore-${token}`;const oldDatabase=`${databasePath}.old-${token}`;const oldArtifacts=`${artifactRoot}.old-${token}`;
  cpSync(join(backupRoot,manifest.database.file),stageDatabase,{errorOnExist:true});cpSync(join(backupRoot,"artifacts"),stageArtifacts,{recursive:true,errorOnExist:true});
  const staged=new DatabaseSync(stageDatabase);try{verifyAuthority(staged,stageArtifacts);}finally{staged.close();}
  const journal:RestoreJournal={databasePath,artifactRoot,oldDatabase,oldArtifacts,stageDatabase,stageArtifacts};writeFileSync(journalPath(databasePath),JSON.stringify(journal),{mode:0o600});
  try{if(existsSync(databasePath))renameSync(databasePath,oldDatabase);if(existsSync(artifactRoot))renameSync(artifactRoot,oldArtifacts);renameSync(stageDatabase,databasePath);renameSync(stageArtifacts,artifactRoot);rmSync(oldDatabase,{force:true});rmSync(oldArtifacts,{recursive:true,force:true});rmSync(journalPath(databasePath),{force:true});}
  catch(error){if(existsSync(databasePath))rmSync(databasePath,{force:true});if(existsSync(artifactRoot))rmSync(artifactRoot,{recursive:true,force:true});if(existsSync(oldDatabase))renameSync(oldDatabase,databasePath);if(existsSync(oldArtifacts))renameSync(oldArtifacts,artifactRoot);rmSync(stageDatabase,{force:true});rmSync(stageArtifacts,{recursive:true,force:true});rmSync(journalPath(databasePath),{force:true});throw error;}
}
