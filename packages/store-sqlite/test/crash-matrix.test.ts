import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createWorkspaceGenesis, NO_POLICY_DIGEST } from "@horseness/domain";
import { SQLiteAuthority, type CrashPoint } from "../src/index.js";

const file=fileURLToPath(import.meta.url);
const bytes=Buffer.from("durable evidence");
const digest=createHash("sha256").update(bytes).digest("hex");
const artifactPoints:CrashPoint[]=["artifact.mkdir.before","artifact.mkdir.after","artifact.open.before","artifact.open.after","artifact.write.before","artifact.write.after","artifact.file-fsync.before","artifact.file-fsync.after","artifact.close.before","artifact.close.after","artifact.rename.before","artifact.rename.after","artifact.dir-fsync.before","artifact.dir-fsync.after","artifact.sql-reference.before","artifact.sql-reference.after"];
const transactionPoints:CrashPoint[]=["transaction.begin.before","transaction.begin.after","transaction.write.before","transaction.write.after","transaction.commit.before","transaction.commit.after"];
function request(){const genesis=createWorkspaceGenesis({workspaceId:"ws",authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"marker",activePolicyDigest:NO_POLICY_DIGEST,commandId:"genesis"});return{commandId:"atomic-evidence",workspace:{streamKind:"workspace" as const,workspaceId:"ws",streamId:"ws",expectedSequence:0,expectedEnvelopeHash:null,events:[genesis.event]},artifacts:[{data:bytes,mediaType:"application/octet-stream",references:[{ownerKind:"event",ownerId:genesis.event.envelope.eventId}],pins:[{pinId:"canonical"}]}],requiredArtifactDigests:[digest],projections:[{workspaceId:"ws",name:"workspace",version:"1",streamKind:"workspace" as const,streamId:"ws",lastSequence:1,lastEnvelopeHash:genesis.event.envelopeHash}]};}

if(process.env.HORSENESS_CRASH_CHILD==="1"){
  const root=process.env.HORSENESS_CRASH_ROOT;const target=process.env.HORSENESS_CRASH_POINT as CrashPoint|undefined;const occurrence=Number(process.env.HORSENESS_CRASH_OCCURRENCE??"1");if(!root||!target)process.exit(64);
  let armed=false;let seen=0;const store=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"),point=>{if(armed&&point===target&&++seen===occurrence){const hit=join(root,"hit");writeFileSync(hit,`${point}:${occurrence}`);const fd=openSync(hit,"r");fsyncSync(fd);closeSync(fd);process.kill(process.pid,"SIGKILL");}});armed=true;store.publishAndAppendAtomic(request());store.close();writeFileSync(join(root,"completed"),"");process.exit(0);
}

function verifyReopen(root:string):void{
  const store=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"));
  const refs=store.db.prepare("SELECT r.digest,a.byte_length FROM artifact_refs r JOIN artifacts a ON a.digest=r.digest").all() as {digest:string;byte_length:number}[];
  for(const ref of refs){const data=store.artifacts.readReferenced(ref.digest);assert.equal(data.length,ref.byte_length);assert.equal(createHash("sha256").update(data).digest("hex"),ref.digest);}
  const objectRoot=join(root,"artifacts","objects");if(existsSync(objectRoot))for(const prefix of readdirSync(objectRoot)){const directory=join(objectRoot,prefix);for(const leaf of readdirSync(directory)){const path=join(directory,leaf);const data=readFileSync(path);assert.equal(createHash("sha256").update(data).digest("hex"),`${prefix}${leaf}`,`residue ${path} must be a complete content-addressed object`);}}
  const eventCount=(store.db.prepare("SELECT count(*) AS count FROM events").get() as {count:number}).count;
  const refCount=(store.db.prepare("SELECT count(*) AS count FROM artifact_refs").get() as {count:number}).count;
  assert.equal(eventCount,refCount,"events and required evidence references commit together");store.close();
}


for(const point of [...artifactPoints.filter(point=>point!=="artifact.dir-fsync.before"&&point!=="artifact.dir-fsync.after"),...transactionPoints])test(`abrupt power loss at ${point}`,()=>{const root=mkdtempSync(join(tmpdir(),"horseness-power-loss-"));try{const child=spawnSync(process.execPath,["--import","tsx",file],{env:{...process.env,HORSENESS_CRASH_CHILD:"1",HORSENESS_CRASH_ROOT:root,HORSENESS_CRASH_POINT:point},stdio:"ignore"});assert.equal(child.signal,"SIGKILL");assert.equal(readFileSync(join(root,"hit"),"utf8"),`${point}:1`);assert.equal(existsSync(join(root,"completed")),false,"crash child unexpectedly completed");verifyReopen(root);}finally{rmSync(root,{recursive:true,force:true});}});
for(const point of ["artifact.dir-fsync.before","artifact.dir-fsync.after"] as const)for(let occurrence=1;occurrence<=4;occurrence++)test(`abrupt power loss at ${point} occurrence ${occurrence}`,()=>{const root=mkdtempSync(join(tmpdir(),"horseness-power-loss-"));try{const child=spawnSync(process.execPath,["--import","tsx",file],{env:{...process.env,HORSENESS_CRASH_CHILD:"1",HORSENESS_CRASH_ROOT:root,HORSENESS_CRASH_POINT:point,HORSENESS_CRASH_OCCURRENCE:String(occurrence)},stdio:"ignore"});assert.equal(child.signal,"SIGKILL");assert.equal(readFileSync(join(root,"hit"),"utf8"),`${point}:${occurrence}`);assert.equal(existsSync(join(root,"completed")),false,"crash child unexpectedly completed");verifyReopen(root);}finally{rmSync(root,{recursive:true,force:true});}});

for(const table of ["artifacts","artifact_refs","artifact_pins","events","projection_metadata","command_dedup"] as const)test(`SQL failure at ${table} rolls back the complete evidence append`,()=>{const root=mkdtempSync(join(tmpdir(),"horseness-statement-"));try{const store=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"));store.db.exec(`CREATE TEMP TRIGGER fail_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'injected statement failure'); END`);assert.throws(()=>store.publishAndAppendAtomic(request()));for(const authoritative of ["artifacts","artifact_refs","artifact_pins","events","streams","projection_metadata","command_dedup"])assert.equal((store.db.prepare(`SELECT count(*) AS count FROM ${authoritative}`).get() as {count:number}).count,0,authoritative);store.close();verifyReopen(root);}finally{rmSync(root,{recursive:true,force:true});}});

test("missing required publication prevents authoritative append",()=>{const root=mkdtempSync(join(tmpdir(),"horseness-required-"));try{const store=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"));const invalid={...request(),artifacts:[]};assert.throws(()=>store.publishAndAppendAtomic(invalid),/required artifact was not published/);assert.equal((store.db.prepare("SELECT count(*) AS count FROM events").get() as {count:number}).count,0);store.close();}finally{rmSync(root,{recursive:true,force:true});}});
