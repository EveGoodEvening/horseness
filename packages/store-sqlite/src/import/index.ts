import { createHash, randomUUID } from "node:crypto";
import { deterministicReplay, reduceWorkspaceState, type HashedEventEnvelopeV1, type WorkspaceOperationalEvent, type WorkspaceState } from "@horseness/domain";
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DatabaseSync as Database } from "node:sqlite";
import { containedBackupPath, verifyBackup } from "../backup/index.js";
import { verifyAuthority } from "../recovery/index.js";

export interface ImportedWorkspaceMappingV1 {readonly sourceWorkspaceId:string;readonly localWorkspaceId:string}
export interface ImportProvenanceV1 {
  readonly kind:"HorsenessImportProvenanceV1";
  readonly schemaVersion:1;
  readonly importId:string;
  readonly sourceManifestDigest:string;
  readonly importedAt:string;
  readonly state:"quarantined"|"promoted";
  readonly databasePath:"db/authority.sqlite";
  readonly artifactPath:"artifacts";
  readonly workspaceMappings:readonly ImportedWorkspaceMappingV1[];
  readonly promotion?:{readonly reviewedBy:string;readonly reviewedAt:string;readonly reviewEvidence:string};
}
export interface ImportResult {readonly importId:string;readonly quarantinePath:string;readonly workspaces:readonly ImportedWorkspaceMappingV1[];readonly events:number;readonly artifacts:number;readonly state:"quarantined"}

function safeChild(root:string,...parts:string[]):string {const base=resolve(root),path=resolve(base,...parts);if(path===base||!path.startsWith(`${base}${sep}`))throw new Error("import path containment failure");return path;}
function canonicalBytes(value:unknown):Buffer {return Buffer.from(`${JSON.stringify(value)}\n`,"utf8");}
function sourceManifestDigest(root:string):string {return createHash("sha256").update(readFileSync(join(root,"manifest.json"))).digest("hex");}
function verifySemanticReplay(db:Database):void {
  const streams=db.prepare("SELECT workspace_id,stream_kind,stream_id FROM streams ORDER BY workspace_id,stream_kind,stream_id").all() as {workspace_id:string;stream_kind:"workspace"|"run";stream_id:string}[];
  for(const stream of streams){const rows=db.prepare("SELECT envelope_json FROM events WHERE workspace_id=? AND stream_kind=? AND stream_id=? ORDER BY sequence").all(stream.workspace_id,stream.stream_kind,stream.stream_id) as {envelope_json:string}[];const envelopes:HashedEventEnvelopeV1<unknown>[]=rows.map(row=>JSON.parse(row.envelope_json) as HashedEventEnvelopeV1<unknown>);if(stream.stream_kind==="run"){deterministicReplay(envelopes);continue;}let state:WorkspaceState|null=null;for(const item of envelopes){const payload=item.envelope.payload;if(payload===null||typeof payload!=="object"||!("eventType" in payload)||!("workspaceId" in payload)||typeof payload.workspaceId!=="string")throw new Error("invalid workspace replay payload");if(payload.eventType==="WorkspaceCreatedV1"){if(!("authorityPrincipalId" in payload)||typeof payload.authorityPrincipalId!=="string"||!("initialGrantDigest" in payload)||typeof payload.initialGrantDigest!=="string"||!("authorityConsumptionMarker" in payload)||typeof payload.authorityConsumptionMarker!=="string"||!("activePolicyDigest" in payload)||typeof payload.activePolicyDigest!=="string")throw new Error("invalid workspace genesis replay payload");const event:WorkspaceOperationalEvent={eventType:"WorkspaceCreatedV1",sequence:item.envelope.sequence,workspaceId:payload.workspaceId,authorityPrincipalId:payload.authorityPrincipalId,initialGrantDigest:payload.initialGrantDigest,authorityConsumptionMarker:payload.authorityConsumptionMarker,activePolicyDigest:payload.activePolicyDigest};state=reduceWorkspaceState(state,event);}else if(payload.eventType==="PolicyReferenceChangedV1"){if(!("activePolicyDigest" in payload)||typeof payload.activePolicyDigest!=="string")throw new Error("invalid policy replay payload");state=reduceWorkspaceState(state,{eventType:"PolicyReferenceChangedV1",sequence:item.envelope.sequence,workspaceId:payload.workspaceId,activePolicyDigest:payload.activePolicyDigest});}else throw new Error(`unsupported workspace replay event: ${String(payload.eventType)}`);}}
}

export function importBackup(db:Database,artifactRoot:string,backupRoot:string):ImportResult {
  const manifest=verifyBackup(backupRoot);
  const localVersion=(db.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {version:number|null}).version;
  if(localVersion!==manifest.authoritySchemaVersion)throw new Error("import schema/version mismatch");
  const importId=randomUUID();const quarantineBase=resolve(dirname(artifactRoot),"imports-quarantine");mkdirSync(quarantineBase,{recursive:true,mode:0o700});
  const quarantinePath=safeChild(quarantineBase,importId);mkdirSync(quarantinePath,{recursive:false,mode:0o700});mkdirSync(join(quarantinePath,"db"),{mode:0o700});mkdirSync(join(quarantinePath,"artifacts"),{mode:0o700});
  const databasePath=join(quarantinePath,"db","authority.sqlite");copyFileSync(containedBackupPath(backupRoot,manifest.database.file),databasePath,constants.COPYFILE_EXCL);
  for(const item of manifest.artifacts){const relative=item.path.slice("artifacts/".length);const target=safeChild(join(quarantinePath,"artifacts"),...relative.split("/"));mkdirSync(dirname(target),{recursive:true,mode:0o700});copyFileSync(containedBackupPath(backupRoot,item.path),target,constants.COPYFILE_EXCL);}
  const source=new DatabaseSync(databasePath,{readOnly:true});
  let sourceWorkspaceIds:readonly string[];let events:number;
  try {verifyAuthority(source,join(quarantinePath,"artifacts"));verifySemanticReplay(source);sourceWorkspaceIds=(source.prepare("SELECT DISTINCT workspace_id FROM streams ORDER BY workspace_id").all() as {workspace_id:string}[]).map(row=>row.workspace_id);events=(source.prepare("SELECT count(*) AS count FROM events").get() as {count:number}).count;} finally {source.close();}
  const workspaceMappings=sourceWorkspaceIds.map(sourceWorkspaceId=>({sourceWorkspaceId,localWorkspaceId:randomUUID()}));
  const provenance:ImportProvenanceV1={kind:"HorsenessImportProvenanceV1",schemaVersion:1,importId,sourceManifestDigest:sourceManifestDigest(backupRoot),importedAt:new Date().toISOString(),state:"quarantined",databasePath:"db/authority.sqlite",artifactPath:"artifacts",workspaceMappings};
  writeFileSync(join(quarantinePath,"provenance.json"),canonicalBytes(provenance),{flag:"wx",mode:0o400});
  return{importId,quarantinePath,workspaces:workspaceMappings,events,artifacts:manifest.artifacts.length,state:"quarantined"};
}

function parseProvenance(path:string):ImportProvenanceV1 {
  const value:unknown=JSON.parse(readFileSync(path,"utf8"));
  if(value===null||typeof value!=="object"||!("kind" in value)||value.kind!=="HorsenessImportProvenanceV1"||!("schemaVersion" in value)||value.schemaVersion!==1||!("importId" in value)||typeof value.importId!=="string"||!("sourceManifestDigest" in value)||typeof value.sourceManifestDigest!=="string"||!/^[0-9a-f]{64}$/u.test(value.sourceManifestDigest)||!("importedAt" in value)||typeof value.importedAt!=="string"||!("state" in value)||(value.state!=="quarantined"&&value.state!=="promoted")||!("databasePath" in value)||value.databasePath!=="db/authority.sqlite"||!("artifactPath" in value)||value.artifactPath!=="artifacts"||!("workspaceMappings" in value)||!Array.isArray(value.workspaceMappings))throw new Error("invalid import provenance");
  const workspaceMappings:ImportedWorkspaceMappingV1[]=value.workspaceMappings.map(mapping=>{if(mapping===null||typeof mapping!=="object"||!("sourceWorkspaceId" in mapping)||typeof mapping.sourceWorkspaceId!=="string"||!("localWorkspaceId" in mapping)||typeof mapping.localWorkspaceId!=="string")throw new Error("invalid import workspace mapping");return{sourceWorkspaceId:mapping.sourceWorkspaceId,localWorkspaceId:mapping.localWorkspaceId};});
  if(new Set(workspaceMappings.map(mapping=>mapping.sourceWorkspaceId)).size!==workspaceMappings.length||new Set(workspaceMappings.map(mapping=>mapping.localWorkspaceId)).size!==workspaceMappings.length)throw new Error("duplicate import workspace mapping");
  return{kind:"HorsenessImportProvenanceV1",schemaVersion:1,importId:value.importId,sourceManifestDigest:value.sourceManifestDigest,importedAt:value.importedAt,state:value.state,databasePath:"db/authority.sqlite",artifactPath:"artifacts",workspaceMappings};
}

export function promoteImportedBackup(quarantinePath:string,review:{readonly reviewedBy:string;readonly reviewEvidence:string}):ImportProvenanceV1 {
  if(review.reviewedBy.trim()===""||review.reviewEvidence.trim()==="")throw new Error("import promotion requires explicit review identity and evidence");
  const stat=lstatSync(quarantinePath);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("invalid quarantine namespace");
  const provenancePath=safeChild(quarantinePath,"provenance.json");const provenance=parseProvenance(provenancePath);if(provenance.state!=="quarantined")throw new Error("import namespace is not quarantined");
  const databasePath=safeChild(quarantinePath,"db","authority.sqlite"),artifactPath=safeChild(quarantinePath,"artifacts");
  if(!existsSync(databasePath)||!existsSync(artifactPath))throw new Error("quarantined authority unit is incomplete");
  const source=new DatabaseSync(databasePath,{readOnly:true});try{verifyAuthority(source,artifactPath);verifySemanticReplay(source);}finally{source.close();}
  const promoted:ImportProvenanceV1={...provenance,state:"promoted",promotion:{reviewedBy:review.reviewedBy,reviewedAt:new Date().toISOString(),reviewEvidence:review.reviewEvidence}};
  const staged=safeChild(quarantinePath,"provenance.promoted.json");writeFileSync(staged,canonicalBytes(promoted),{flag:"wx",mode:0o400});renameSync(staged,provenancePath);return promoted;
}
