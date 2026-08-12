import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { verifyAuthority } from "../recovery/index.js";

export interface BackupManifestV1 {kind:"HorsenessBackupManifestV1";schemaVersion:1;authoritySchemaVersion:number;createdAt:string;database:{file:string;digest:string;bytes:number};artifacts:readonly {path:string;digest:string;bytes:number}[]}
const digest=(data:Uint8Array):string=>createHash("sha256").update(data).digest("hex");
const files=(root:string,prefix=""):string[]=>readdirSync(join(root,prefix),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(root,join(prefix,e.name)):[join(prefix,e.name)]).sort();
export function createBackup(db:DatabaseSync,artifactRoot:string,destination:string):BackupManifestV1{
  if(existsSync(destination))throw new Error("backup destination already exists");verifyAuthority(db,artifactRoot);mkdirSync(destination,{recursive:false});
  const dbFile="authority.sqlite";const dbPath=join(destination,dbFile);db.exec(`VACUUM INTO '${dbPath.replaceAll("'","''")}'`);
  const artifactDestination=join(destination,"artifacts");cpSync(artifactRoot,artifactDestination,{recursive:true,errorOnExist:true});
  const databaseBytes=readFileSync(dbPath);const artifacts=files(artifactDestination).filter(path=>statSync(join(artifactDestination,path)).isFile()&&!path.startsWith(`stage/`)).map(path=>{const data=readFileSync(join(artifactDestination,path));return{path,digest:digest(data),bytes:data.length};});
  const versions=db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").all() as {version:number}[];const authoritySchemaVersion=versions[0]?.version??0;
  const manifest:BackupManifestV1={kind:"HorsenessBackupManifestV1",schemaVersion:1,authoritySchemaVersion,createdAt:new Date().toISOString(),database:{file:dbFile,digest:digest(databaseBytes),bytes:databaseBytes.length},artifacts};
  writeFileSync(join(destination,"manifest.json"),`${JSON.stringify(manifest,null,2)}\n`,{encoding:"utf8",mode:0o600});return manifest;
}
export function readBackupManifest(root:string):BackupManifestV1{const value:unknown=JSON.parse(readFileSync(join(root,"manifest.json"),"utf8"));if(!value||typeof value!=="object"||!("kind" in value)||value.kind!=="HorsenessBackupManifestV1")throw new Error("invalid backup manifest");return value as BackupManifestV1;}
export function verifyBackup(root:string):BackupManifestV1{const m=readBackupManifest(root);const db=readFileSync(join(root,m.database.file));if(db.length!==m.database.bytes||digest(db)!==m.database.digest)throw new Error("backup database digest mismatch");for(const item of m.artifacts){const data=readFileSync(join(root,"artifacts",item.path));if(data.length!==item.bytes||digest(data)!==item.digest)throw new Error(`backup artifact digest mismatch: ${item.path}`);}return m;}
