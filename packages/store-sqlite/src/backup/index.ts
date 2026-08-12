import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DatabaseSync as Database } from "node:sqlite";
import { verifyAuthority } from "../recovery/index.js";

export interface BackupFileV1 { readonly path:string; readonly digest:string; readonly bytes:number }
export interface BackupDatabaseV1 { readonly file:string; readonly digest:string; readonly bytes:number }
export interface BackupManifestV1 {
  readonly kind:"HorsenessBackupManifestV1";
  readonly schemaVersion:1;
  readonly authoritySchemaVersion:number;
  readonly createdAt:string;
  readonly database:BackupDatabaseV1;
  readonly artifacts:readonly BackupFileV1[];
}
export interface VerifiedBackupIdentityV1 {
  readonly kind:"HorsenessVerifiedBackupIdentityV1";
  readonly manifestDigest:string;
  readonly databaseDigest:string;
  readonly createdAt:string;
}

const SHA256=/^[0-9a-f]{64}$/u;
const digest=(data:Uint8Array):string=>createHash("sha256").update(data).digest("hex");
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const exactKeys=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).sort().join("\0")===[...keys].sort().join("\0");

export function parsePortableRelativePath(value:unknown,root:"db"|"artifacts"):string {
  if(typeof value!=="string"||value.length===0||value.includes("\\")||value.includes("\0")||isAbsolute(value))throw new Error("backup path is not a portable relative path");
  const parts=value.split("/");
  if(parts.some(part=>part===""||part==="."||part==="..")||posix.normalize(value)!==value||parts[0]!==root||parts.length<2)throw new Error("backup path escapes its fixed root");
  return value;
}

function parseFile(value:unknown,root:"db"|"artifacts"):BackupFileV1 {
  if(!object(value)||!exactKeys(value,["path","digest","bytes"]))throw new Error("invalid backup file manifest entry");
  const path=parsePortableRelativePath(value.path,root);
  if(typeof value.digest!=="string"||!SHA256.test(value.digest)||!Number.isSafeInteger(value.bytes)||Number(value.bytes)<0)throw new Error("invalid backup file metadata");
  return {path,digest:value.digest,bytes:Number(value.bytes)};
}
function parseDatabase(value:unknown):BackupDatabaseV1 {
  if(!object(value)||!exactKeys(value,["file","digest","bytes"]))throw new Error("invalid backup database manifest entry");
  const file=parsePortableRelativePath(value.file,"db");
  if(file!=="db/authority.sqlite"||typeof value.digest!=="string"||!SHA256.test(value.digest)||!Number.isSafeInteger(value.bytes)||Number(value.bytes)<0)throw new Error("invalid backup database metadata");
  return {file,digest:value.digest,bytes:Number(value.bytes)};
}

export function parseBackupManifest(value:unknown):BackupManifestV1 {
  if(!object(value)||!exactKeys(value,["kind","schemaVersion","authoritySchemaVersion","createdAt","database","artifacts"])||value.kind!=="HorsenessBackupManifestV1"||value.schemaVersion!==1)throw new Error("invalid backup manifest version");
  if(!Number.isSafeInteger(value.authoritySchemaVersion)||Number(value.authoritySchemaVersion)<1||typeof value.createdAt!=="string"||!Number.isFinite(Date.parse(value.createdAt))||!Array.isArray(value.artifacts))throw new Error("invalid backup manifest metadata");
  const database=parseDatabase(value.database);
  const artifacts=value.artifacts.map(item=>parseFile(item,"artifacts")).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path)));
  const paths=[database.file,...artifacts.map(item=>item.path)];
  if(new Set(paths).size!==paths.length)throw new Error("duplicate backup manifest path");
  return {kind:"HorsenessBackupManifestV1",schemaVersion:1,authoritySchemaVersion:Number(value.authoritySchemaVersion),createdAt:value.createdAt,database,artifacts};
}

export function resolveBackupRoot(root:string):string {
  const absolute=resolve(root);
  const rootStat=lstatSync(absolute);
  if(rootStat.isSymbolicLink()||!rootStat.isDirectory())throw new Error("backup root must be a non-symlink directory");
  const real=realpathSync(absolute);
  if(real!==absolute)throw new Error("backup root must be a real directory path");
  const pinned=lstatSync(real);
  if(pinned.isSymbolicLink()||!pinned.isDirectory()||pinned.dev!==rootStat.dev||pinned.ino!==rootStat.ino)throw new Error("backup root identity changed");
  return real;
}

export function containedBackupPath(root:string,portablePath:string):string {
  const absoluteRoot=resolveBackupRoot(root);const candidate=resolve(absoluteRoot,...portablePath.split("/"));
  if(candidate===absoluteRoot||!candidate.startsWith(`${absoluteRoot}${sep}`))throw new Error("backup path containment failure");
  return candidate;
}

function readRegularNoFollow(path:string):Buffer {
  let fd:number|undefined;
  try {fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);if(!stat.isFile())throw new Error(`backup member is not a regular file: ${path}`);const data=Buffer.alloc(stat.size);let offset=0;while(offset<data.length){const count=readSync(fd,data,offset,data.length-offset,offset);if(count===0)throw new Error(`short backup read: ${path}`);offset+=count;}return data;} finally {if(fd!==undefined)closeSync(fd);}
}

function enumerateRegularFiles(root:string,prefix=""):string[] {
  const directory=prefix===""?root:join(root,...prefix.split("/"));
  const entries=readdirSync(directory,{withFileTypes:true}).sort((a,b)=>Buffer.from(a.name).compare(Buffer.from(b.name)));
  const result:string[]=[];
  for(const entry of entries){const portable=prefix===""?entry.name:`${prefix}/${entry.name}`;const path=join(directory,entry.name);const stat=lstatSync(path);if(stat.isSymbolicLink())throw new Error(`backup contains symlink: ${portable}`);if(stat.isDirectory())result.push(...enumerateRegularFiles(root,portable));else if(stat.isFile())result.push(portable);else throw new Error(`backup contains special file: ${portable}`);}
  return result;
}

function assertEqualSets(actual:readonly string[],expected:readonly string[],message:string):void {const a=[...actual].sort().join("\0"),e=[...expected].sort().join("\0");if(a!==e)throw new Error(message);}
function syncDirectory(path:string):void {const fd=openSync(path,"r");try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncTree(path:string):void {for(const entry of readdirSync(path)){const child=join(path,entry);const stat=lstatSync(child);if(stat.isSymbolicLink())throw new Error("backup tree contains symlink");if(stat.isDirectory())syncTree(child);else if(stat.isFile()){const fd=openSync(child,"r");try{fsyncSync(fd);}finally{closeSync(fd);}}else throw new Error("backup tree contains special file");}syncDirectory(path);}

export function createBackup(db:Database,artifactRoot:string,destination:string):BackupManifestV1 {
  if(existsSync(destination))throw new Error("backup destination already exists");
  verifyAuthority(db,artifactRoot);mkdirSync(join(destination,"db"),{recursive:true,mode:0o700});mkdirSync(join(destination,"artifacts"),{recursive:true,mode:0o700});
  const databasePath=join(destination,"db","authority.sqlite");db.exec(`VACUUM INTO '${databasePath.replaceAll("'","''")}'`);
  const catalog=db.prepare("SELECT digest,byte_length,relative_path FROM artifacts ORDER BY relative_path").all() as {digest:string;byte_length:number;relative_path:string}[];
  const artifacts:BackupFileV1[]=catalog.map(row=>{const relativePath=parsePortableRelativePath(`artifacts/${row.relative_path}`,"artifacts").slice("artifacts/".length);const source=resolve(artifactRoot,...relativePath.split("/"));const sourceRootRelative=relative(resolve(artifactRoot),source);if(sourceRootRelative.startsWith("..")||isAbsolute(sourceRootRelative))throw new Error("artifact catalog path escapes root");const data=readRegularNoFollow(source);if(data.length!==row.byte_length||digest(data)!==row.digest)throw new Error(`artifact catalog mismatch: ${relativePath}`);const target=join(destination,"artifacts",...relativePath.split("/"));mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,data,{mode:0o600,flag:"wx"});return{path:`artifacts/${relativePath}`,digest:row.digest,bytes:data.length};});
  const databaseBytes=readRegularNoFollow(databasePath);const version=(db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {version:number|null}).version;
  if(version===null)throw new Error("authority has no schema version");
  const manifest:BackupManifestV1={kind:"HorsenessBackupManifestV1",schemaVersion:1,authoritySchemaVersion:version,createdAt:new Date().toISOString(),database:{file:"db/authority.sqlite",digest:digest(databaseBytes),bytes:databaseBytes.length},artifacts};
  writeFileSync(join(destination,"manifest.json"),`${JSON.stringify(manifest,null,2)}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});syncTree(destination);syncDirectory(dirname(resolve(destination)));return manifest;
}

export function readBackupManifest(root:string):BackupManifestV1 {const pinned=resolveBackupRoot(root);return parseBackupManifest(JSON.parse(readRegularNoFollow(join(pinned,"manifest.json")).toString("utf8")) as unknown);}

export function verifyBackup(root:string):BackupManifestV1 {
  const pinnedRoot=resolveBackupRoot(root);const identity=lstatSync(pinnedRoot);const manifest=readBackupManifest(pinnedRoot);const rootEntries=readdirSync(pinnedRoot,{withFileTypes:true});
  if(rootEntries.some(entry=>entry.isSymbolicLink()||(!entry.isDirectory()&&!entry.isFile())))throw new Error("backup root contains symlink or special file");
  assertEqualSets(enumerateRegularFiles(pinnedRoot),["manifest.json",manifest.database.file,...manifest.artifacts.map(item=>item.path)],"backup manifest enumeration mismatch");
  const databaseBytes=readRegularNoFollow(containedBackupPath(pinnedRoot,manifest.database.file));if(databaseBytes.length!==manifest.database.bytes||digest(databaseBytes)!==manifest.database.digest)throw new Error(`backup member digest mismatch: ${manifest.database.file}`);
  for(const item of manifest.artifacts){const data=readRegularNoFollow(containedBackupPath(pinnedRoot,item.path));if(data.length!==item.bytes||digest(data)!==item.digest)throw new Error(`backup member digest mismatch: ${item.path}`);}
  const authority=new DatabaseSync(containedBackupPath(pinnedRoot,manifest.database.file),{readOnly:true});
  try {const version=(authority.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {version:number|null}).version;if(version!==manifest.authoritySchemaVersion)throw new Error("backup authority schema mismatch");const catalog=authority.prepare("SELECT digest,byte_length,relative_path FROM artifacts ORDER BY relative_path").all() as {digest:string;byte_length:number;relative_path:string}[];const expected=catalog.map(row=>`artifacts/${row.relative_path}`);assertEqualSets(manifest.artifacts.map(item=>item.path),expected,"backup artifact catalog mismatch");for(const row of catalog){const item=manifest.artifacts.find(candidate=>candidate.path===`artifacts/${row.relative_path}`);if(!item||item.digest!==row.digest||item.bytes!==row.byte_length)throw new Error("backup artifact catalog metadata mismatch");}verifyAuthority(authority,join(pinnedRoot,"artifacts"));}finally{authority.close();}
  const finalIdentity=lstatSync(pinnedRoot);if(finalIdentity.isSymbolicLink()||!finalIdentity.isDirectory()||finalIdentity.dev!==identity.dev||finalIdentity.ino!==identity.ino||realpathSync(pinnedRoot)!==pinnedRoot)throw new Error("backup root identity changed during verification");
  return manifest;
}

export function verifyBackupIdentity(root:string):VerifiedBackupIdentityV1 {
  const pinnedRoot=resolveBackupRoot(root);
  const manifest=verifyBackup(pinnedRoot);
  const manifestDigest=digest(readRegularNoFollow(join(pinnedRoot,"manifest.json")));
  return {kind:"HorsenessVerifiedBackupIdentityV1",manifestDigest,databaseDigest:manifest.database.digest,createdAt:manifest.createdAt};
}
