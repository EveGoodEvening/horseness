import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { noCrash, type CrashInjector } from "./crash.js";

export interface ArtifactRecord { digest: string; byteLength: number; relativePath: string; mediaType: string | null }
export class ArtifactIntegrityError extends Error { constructor(message: string) { super(message); this.name="ArtifactIntegrityError"; } }
const sha256=(data:Uint8Array):string=>createHash("sha256").update(data).digest("hex");

export class ArtifactStore {
  readonly root: string; readonly objects: string; readonly staging: string;
  constructor(root:string, private readonly db:DatabaseSync, private readonly crash:CrashInjector=noCrash) {
    this.root=resolve(root); this.objects=join(this.root,"objects"); this.staging=join(this.root,"stage");
    this.crash("artifact.mkdir.before"); mkdirSync(this.objects,{recursive:true}); mkdirSync(this.staging,{recursive:true}); this.crash("artifact.mkdir.after");
    this.recoverStaging();
  }
  private pathFor(digest:string):string { if(!/^[a-f0-9]{64}$/.test(digest)) throw new ArtifactIntegrityError("invalid artifact digest"); return join(this.objects,digest.slice(0,2),digest.slice(2)); }
  private ensureWithin(path:string):void { const rel=relative(this.root,path); if(rel.startsWith(`..${sep}`)||rel==="..") throw new ArtifactIntegrityError("artifact path escape"); }
  private syncDirectory(path:string):void { this.crash("artifact.dir-fsync.before"); const fd=openSync(path,"r"); try{fsyncSync(fd);}finally{closeSync(fd);} this.crash("artifact.dir-fsync.after"); }
  publish(data:Uint8Array|string, mediaType:string|null=null):ArtifactRecord {
    const bytes=typeof data==="string"?Buffer.from(data):Buffer.from(data); const digest=sha256(bytes); const destination=this.pathFor(digest); this.ensureWithin(destination);
    if(!existsSync(destination)) {
      const parent=dirname(destination); const parentExisted=existsSync(parent); this.crash("artifact.mkdir.before"); mkdirSync(parent,{recursive:true}); this.crash("artifact.mkdir.after");
      if(!parentExisted)this.syncDirectory(this.objects);
      const temporary=join(this.staging,`${digest}.${String(process.pid)}.${String(Date.now())}.tmp`); this.crash("artifact.open.before"); const fd=openSync(temporary,"wx",0o600); this.crash("artifact.open.after");
      let closed=false;
      try {
        this.crash("artifact.write.before"); let offset=0; while(offset<bytes.length) offset+=writeSync(fd,bytes,offset,bytes.length-offset); this.crash("artifact.write.after");
        this.crash("artifact.file-fsync.before"); fsyncSync(fd); this.crash("artifact.file-fsync.after");
        this.crash("artifact.close.before"); closeSync(fd); closed=true; this.crash("artifact.close.after");
        this.syncDirectory(this.staging);
        this.crash("artifact.rename.before"); renameSync(temporary,destination); this.crash("artifact.rename.after");
        this.syncDirectory(parent);
        this.syncDirectory(this.staging);
      } catch(error){ if(!closed){try{closeSync(fd);}catch(closeError){void closeError;}} if(existsSync(temporary))rmSync(temporary,{force:true}); throw error; }
    }
    const actual=this.readVerifiedBytes(digest); if(actual.length!==bytes.length) throw new ArtifactIntegrityError("published artifact length mismatch");
    return {digest,byteLength:bytes.length,relativePath:relative(this.root,destination),mediaType};
  }
  verifyRecord(record:ArtifactRecord):void { const expectedPath=relative(this.root,this.pathFor(record.digest)); if(record.relativePath!==expectedPath)throw new ArtifactIntegrityError(`artifact path mismatch: ${record.digest}`); const bytes=this.readVerifiedBytes(record.digest); if(bytes.length!==record.byteLength)throw new ArtifactIntegrityError(`artifact metadata mismatch: ${record.digest}`); }
  register(record:ArtifactRecord):void { this.verifyRecord(record); this.crash("artifact.sql-reference.before"); const existing=this.db.prepare("SELECT byte_length,relative_path,media_type FROM artifacts WHERE digest=?").get(record.digest) as {byte_length:number;relative_path:string;media_type:string|null}|undefined; if(existing&&(existing.byte_length!==record.byteLength||existing.relative_path!==record.relativePath||existing.media_type!==record.mediaType))throw new ArtifactIntegrityError(`artifact catalog conflict: ${record.digest}`); this.db.prepare("INSERT INTO artifacts(digest,byte_length,relative_path,media_type,published_at) VALUES(?,?,?,?,?) ON CONFLICT(digest) DO NOTHING").run(record.digest,record.byteLength,record.relativePath,record.mediaType,new Date().toISOString()); this.crash("artifact.sql-reference.after"); }
  publishAndRegister(data:Uint8Array|string,mediaType:string|null=null):ArtifactRecord { const record=this.publish(data,mediaType); this.register(record); return record; }
  readVerifiedBytes(digest:string):Buffer { const path=this.pathFor(digest); if(!existsSync(path))throw new ArtifactIntegrityError(`referenced artifact missing: ${digest}`); const data=readFileSync(path); if(sha256(data)!==digest)throw new ArtifactIntegrityError(`referenced artifact corrupt: ${digest}`); return data; }
  readReferenced(digest:string):Buffer { const row=this.db.prepare("SELECT byte_length FROM artifacts WHERE digest=?").get(digest) as {byte_length:number}|undefined; if(!row)throw new ArtifactIntegrityError(`unknown artifact reference: ${digest}`); const data=this.readVerifiedBytes(digest); if(data.length!==row.byte_length)throw new ArtifactIntegrityError(`artifact metadata mismatch: ${digest}`); return data; }
  addReference(workspaceId:string,ownerKind:string,ownerId:string,digest:string):void { this.readReferenced(digest); this.db.prepare("INSERT OR IGNORE INTO artifact_refs(workspace_id,owner_kind,owner_id,digest,created_at) VALUES(?,?,?,?,?)").run(workspaceId,ownerKind,ownerId,digest,new Date().toISOString()); }
  removeReference(workspaceId:string,ownerKind:string,ownerId:string,digest:string):void { this.db.prepare("DELETE FROM artifact_refs WHERE workspace_id=? AND owner_kind=? AND owner_id=? AND digest=?").run(workspaceId,ownerKind,ownerId,digest); }
  pin(pinId:string,digest:string):void { this.readReferenced(digest); this.db.prepare("INSERT OR IGNORE INTO artifact_pins(pin_id,digest,created_at) VALUES(?,?,?)").run(pinId,digest,new Date().toISOString()); }
  unpin(pinId:string,digest:string):void { this.db.prepare("DELETE FROM artifact_pins WHERE pin_id=? AND digest=?").run(pinId,digest); }
  recoverStaging():void { for(const entry of readdirSync(this.staging)){if(entry.endsWith(".tmp"))rmSync(join(this.staging,entry),{force:true});} }
}
