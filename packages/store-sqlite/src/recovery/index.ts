import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { verifyEventChain, type HashedEventEnvelopeV1, type DomainEventPayloadV1 } from "@horseness/domain";

export class RecoveryIntegrityError extends Error { constructor(message:string){super(message);this.name="RecoveryIntegrityError";} }
export const sha256File=(path:string):string=>createHash("sha256").update(readFileSync(path)).digest("hex");

export function verifyAuthority(db:DatabaseSync, artifactRoot:string, options:{allowPendingRetentionMissing?:boolean}={}):{streams:number;events:number;artifacts:number}{
  const fk=db.prepare("PRAGMA foreign_key_check").all(); if(fk.length)throw new RecoveryIntegrityError("foreign key integrity failure");
  const integrity=db.prepare("PRAGMA integrity_check").get() as Record<string,unknown>|undefined;if(integrity?.integrity_check!=="ok")throw new RecoveryIntegrityError("sqlite integrity failure");
  const streams=db.prepare("SELECT workspace_id,stream_kind,stream_id,head_sequence,head_hash FROM streams ORDER BY workspace_id,stream_kind,stream_id").all() as {workspace_id:string;stream_kind:string;stream_id:string;head_sequence:number;head_hash:string|null}[];
  let eventCount=0;
  for(const stream of streams){
    const rows=db.prepare("SELECT sequence,envelope_hash,envelope_json FROM events WHERE workspace_id=? AND stream_kind=? AND stream_id=? ORDER BY sequence").all(stream.workspace_id,stream.stream_kind,stream.stream_id) as {sequence:number;envelope_hash:string;envelope_json:string}[];
    let chain:HashedEventEnvelopeV1<DomainEventPayloadV1>[];
    try{chain=rows.map((row,index)=>{const value=JSON.parse(row.envelope_json) as HashedEventEnvelopeV1<DomainEventPayloadV1>;if(row.sequence!==index+1||value.envelopeHash!==row.envelope_hash)throw new Error("event row identity mismatch");return value;});verifyEventChain(chain);}catch(error){throw new RecoveryIntegrityError(`raw event-chain verification failed: ${error instanceof Error?error.message:String(error)}`);}
    const last=chain.at(-1);if(rows.length!==stream.head_sequence||(last?.envelopeHash??null)!==stream.head_hash)throw new RecoveryIntegrityError("stream head mismatch");eventCount+=rows.length;
  }
  const artifacts=db.prepare("SELECT digest,byte_length,relative_path FROM artifacts ORDER BY digest").all() as {digest:string;byte_length:number;relative_path:string}[];
  for(const item of artifacts){const path=join(artifactRoot,item.relative_path);if(!existsSync(path)){const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retention_intents'").get();const pending=table===undefined?undefined:db.prepare("SELECT 1 FROM retention_intents WHERE digest=? AND state='pending'").get(item.digest);const refs=db.prepare("SELECT (SELECT count(*) FROM artifact_refs WHERE digest=?)+(SELECT count(*) FROM artifact_pins WHERE digest=?) AS count").get(item.digest,item.digest) as {count:number};if(options.allowPendingRetentionMissing===true&&pending!==undefined&&refs.count===0)continue;throw new RecoveryIntegrityError(`dangling artifact ${item.digest}`);}const bytes=readFileSync(path);if(bytes.length!==item.byte_length||createHash("sha256").update(bytes).digest("hex")!==item.digest)throw new RecoveryIntegrityError(`corrupt artifact ${item.digest}`);}
  return {streams:streams.length,events:eventCount,artifacts:artifacts.length};
}
