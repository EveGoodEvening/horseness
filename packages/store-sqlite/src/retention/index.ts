import { closeSync, existsSync, fsyncSync, openSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface RetentionIntent {intentId:string;workspaceId:string;digest:string;state:"pending"|"deleting"|"deleted"}
function artifactPath(root:string,digest:string):string{if(!/^[a-f0-9]{64}$/.test(digest))throw new Error("invalid retention digest");return join(root,"objects",digest.slice(0,2),digest.slice(2));}
function syncDirectory(path:string):void{const fd=openSync(path,"r");try{fsyncSync(fd);}finally{closeSync(fd);}}
export function planRetention(db:DatabaseSync,workspaceId:string,digest:string,intentId:string=randomUUID()):RetentionIntent{
  db.exec("BEGIN IMMEDIATE");try{
    const artifact=db.prepare("SELECT 1 FROM artifacts WHERE digest=?").get(digest);if(!artifact)throw new Error("retention rejects unknown/dangling artifact");
    const refs=(db.prepare("SELECT count(*) AS count FROM artifact_refs WHERE digest=?").get(digest) as {count:number}).count;
    const pins=(db.prepare("SELECT count(*) AS count FROM artifact_pins WHERE digest=?").get(digest) as {count:number}).count;
    if(refs||pins)throw new Error("retention artifact is still referenced");
    db.prepare("INSERT INTO retention_intents(intent_id,workspace_id,digest,state,created_at) VALUES(?,?,?,'pending',?) ON CONFLICT(digest) DO NOTHING").run(intentId,workspaceId,digest,new Date().toISOString());
    const row=db.prepare("SELECT intent_id,workspace_id,digest,state FROM retention_intents WHERE digest=?").get(digest) as {intent_id:string;workspace_id:string;digest:string;state:RetentionIntent["state"]};if(row.workspace_id!==workspaceId)throw new Error("retention digest is owned by another workspace intent");db.exec("COMMIT");return{intentId:row.intent_id,workspaceId:row.workspace_id,digest:row.digest,state:row.state};
  }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}
}
export function resumeRetention(db:DatabaseSync,artifactRoot:string):number{
  const intents=db.prepare("SELECT intent_id,workspace_id,digest,state FROM retention_intents WHERE state IN ('pending','deleting') ORDER BY created_at,intent_id").all() as {intent_id:string;workspace_id:string;digest:string;state:"pending"|"deleting"}[];let completed=0;
  for(const intent of intents){
    if(intent.state==="pending"){
      db.exec("BEGIN IMMEDIATE");try{
        const row=db.prepare("SELECT state FROM retention_intents WHERE intent_id=?").get(intent.intent_id) as {state:string}|undefined;
        if(row?.state!=="pending"){db.exec("COMMIT");continue;}
        const refs=(db.prepare("SELECT (SELECT count(*) FROM artifact_refs WHERE digest=?)+(SELECT count(*) FROM artifact_pins WHERE digest=?) AS count").get(intent.digest,intent.digest) as {count:number}).count;if(refs)throw new Error(`retention reference reappeared: ${intent.digest}`);
        const artifact=db.prepare("SELECT 1 FROM artifacts WHERE digest=?").get(intent.digest);if(!artifact)throw new Error(`retention catalog entry disappeared: ${intent.digest}`);
        db.prepare("DELETE FROM artifacts WHERE digest=?").run(intent.digest);
        const changed=db.prepare("UPDATE retention_intents SET state='deleting',delete_committed_at=? WHERE intent_id=? AND state='pending'").run(new Date().toISOString(),intent.intent_id).changes;if(changed!==1)throw new Error("retention intent compare-and-swap failed");
        db.exec("COMMIT");
      }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}
    }
    const path=artifactPath(artifactRoot,intent.digest);if(existsSync(path)){rmSync(path);syncDirectory(dirname(path));}
    db.exec("BEGIN IMMEDIATE");try{
      const changed=db.prepare("UPDATE retention_intents SET state='deleted',completed_at=? WHERE intent_id=? AND state='deleting'").run(new Date().toISOString(),intent.intent_id).changes;
      if(changed===1){db.prepare("INSERT INTO artifact_tombstones(digest,workspace_id,deleted_at,intent_id) VALUES(?,?,?,?)").run(intent.digest,intent.workspace_id,new Date().toISOString(),intent.intent_id);completed++;}
      db.exec("COMMIT");
    }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}
  }
  return completed;
}
