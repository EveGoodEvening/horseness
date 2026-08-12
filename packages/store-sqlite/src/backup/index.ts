import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
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
export type BackupCreationPoint = "backup.final.before-reserve" | "backup.final.after-reserve" | "backup.final.populated" | "backup.final.verified";
export type BackupCreationInjector = (point: BackupCreationPoint, path: string) => void;


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
function syncDirectory(path:string):void {const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncTree(path:string):void {for(const entry of readdirSync(path)){const child=join(path,entry);const stat=lstatSync(child);if(stat.isSymbolicLink())throw new Error("backup tree contains symlink");if(stat.isDirectory())syncTree(child);else if(stat.isFile()){const fd=openSync(child,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}else throw new Error("backup tree contains special file");}syncDirectory(path);}

interface PinnedDirectory { readonly path:string; readonly realpath:string; readonly device:bigint; readonly inode:bigint }
function pinDirectory(path:string,label:string):PinnedDirectory {const absolute=resolve(path),stat=lstatSync(absolute,{bigint:true});if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error(`${label} is not a non-symlink directory`);const real=realpathSync(absolute);if(real!==absolute)throw new Error(`${label} is not a real directory path`);return{path:absolute,realpath:real,device:stat.dev,inode:stat.ino};}
function assertPinnedDirectory(identity:PinnedDirectory,label:string):void {const current=pinDirectory(identity.path,label);if(current.realpath!==identity.realpath||current.device!==identity.device||current.inode!==identity.inode)throw new Error(`${label} identity changed`);}
function writeExclusive(path:string,data:Uint8Array):void {let fd:number|undefined;try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);let offset=0;while(offset<data.length)offset+=writeSync(fd,data,offset,data.length-offset);fsyncSync(fd);}finally{if(fd!==undefined)closeSync(fd);}}
function ensureReservedDirectory(root:PinnedDirectory,path:string):void {assertPinnedDirectory(root,"backup destination");const relativePath=relative(root.path,path);if(relativePath===""||relativePath.startsWith("..")||isAbsolute(relativePath))throw new Error("backup directory escapes reserved destination");let current=root.path;for(const part of relativePath.split(sep)){current=join(current,part);try{mkdirSync(current,{recursive:false,mode:0o700});}catch(error){if(!(error instanceof Error&&"code" in error&&error.code==="EEXIST"))throw error;const stat=lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error("backup directory contains symlink or non-directory");}const real=realpathSync(current);if(!real.startsWith(`${root.path}${sep}`))throw new Error("backup directory escapes reserved destination");}assertPinnedDirectory(root,"backup destination");}

export function createBackup(db:Database,artifactRoot:string,destination:string,inject:BackupCreationInjector=()=>undefined):BackupManifestV1 {
  destination=resolve(destination);const parent=pinDirectory(dirname(destination),"backup destination parent");const leaf=basename(destination);if(leaf===""||leaf==="."||leaf===".."||join(parent.path,leaf)!==destination)throw new Error("unsafe backup destination leaf");
  verifyAuthority(db,artifactRoot);
  inject("backup.final.before-reserve",destination);assertPinnedDirectory(parent,"backup destination parent");
  try{mkdirSync(destination,{recursive:false,mode:0o700});}catch(error){if(error instanceof Error&&"code" in error&&error.code==="EEXIST")throw new Error("backup destination already exists");throw error;}
  const reserved=pinDirectory(destination,"backup destination");
  try {
    inject("backup.final.after-reserve",destination);assertPinnedDirectory(parent,"backup destination parent");assertPinnedDirectory(reserved,"backup destination");
    ensureReservedDirectory(reserved,join(destination,"db"));ensureReservedDirectory(reserved,join(destination,"artifacts"));
    const databasePath=join(destination,"db","authority.sqlite");db.exec(`VACUUM INTO '${databasePath.replaceAll("'","''")}'`);assertPinnedDirectory(reserved,"backup destination");
    const catalog=db.prepare("SELECT digest,byte_length,relative_path FROM artifacts ORDER BY relative_path").all() as {digest:string;byte_length:number;relative_path:string}[];
    const artifacts:BackupFileV1[]=catalog.map(row=>{assertPinnedDirectory(reserved,"backup destination");const relativePath=parsePortableRelativePath(`artifacts/${row.relative_path}`,"artifacts").slice("artifacts/".length);const source=resolve(artifactRoot,...relativePath.split("/"));const sourceRootRelative=relative(resolve(artifactRoot),source);if(sourceRootRelative.startsWith("..")||isAbsolute(sourceRootRelative))throw new Error("artifact catalog path escapes root");const data=readRegularNoFollow(source);if(data.length!==row.byte_length||digest(data)!==row.digest)throw new Error(`artifact catalog mismatch: ${relativePath}`);const target=join(destination,"artifacts",...relativePath.split("/"));ensureReservedDirectory(reserved,dirname(target));writeExclusive(target,data);return{path:`artifacts/${relativePath}`,digest:row.digest,bytes:row.byte_length};});
    const databaseBytes=readRegularNoFollow(databasePath);const version=(db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {version:number|null}).version;
    if(version===null)throw new Error("authority has no schema version");
    const manifest:BackupManifestV1={kind:"HorsenessBackupManifestV1",schemaVersion:1,authoritySchemaVersion:version,createdAt:new Date().toISOString(),database:{file:"db/authority.sqlite",digest:digest(databaseBytes),bytes:databaseBytes.length},artifacts};
    inject("backup.final.populated",destination);assertPinnedDirectory(parent,"backup destination parent");assertPinnedDirectory(reserved,"backup destination");
    writeExclusive(join(destination,"manifest.json"),Buffer.from(`${JSON.stringify(manifest,null,2)}\n`,"utf8"));syncTree(destination);syncDirectory(parent.path);
    const verified=verifyBackup(destination);assertPinnedDirectory(parent,"backup destination parent");assertPinnedDirectory(reserved,"backup destination");inject("backup.final.verified",destination);
    return verified;
  } catch(error) {try{const current=lstatSync(destination,{bigint:true});if(!current.isSymbolicLink()&&current.isDirectory()&&current.dev===reserved.device&&current.ino===reserved.inode)rmSync(destination,{recursive:true,force:true});}catch{}throw error;}
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
