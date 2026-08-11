import { DatabaseSync } from "node:sqlite";
import { canonicalJson, domainDigest, verifyEventChain, type DomainEventPayloadV1, type HashedEventEnvelopeV1, type JsonValue, type RunEventPayloadV1, type WorkspaceEventPayloadV1 } from "@horseness/domain";
import { ArtifactStore } from "./artifact-store.js";
import { noCrash, type CrashInjector } from "./crash.js";
import { migrate } from "./migrations.js";

export type EventStream="workspace"|"run";
export type StoredEvent=HashedEventEnvelopeV1<DomainEventPayloadV1>;
export interface AppendRequest<T extends DomainEventPayloadV1=DomainEventPayloadV1> { streamKind:EventStream; workspaceId:string; streamId:string; expectedSequence:number; expectedEnvelopeHash:string|null; events:readonly HashedEventEnvelopeV1<T>[] }
export interface AtomicAppendRequest { commandId:string; workspace?:AppendRequest<WorkspaceEventPayloadV1>; run?:AppendRequest<RunEventPayloadV1> }
export interface AppendResult { commandId:string; workspaceHead?:{sequence:number;envelopeHash:string}; runHead?:{sequence:number;envelopeHash:string}; deduplicated:boolean }
export interface SnapshotRecord { streamKind:EventStream; streamId:string; sequence:number; envelopeHash:string; projectionName:string; projectionVersion:string; state:JsonValue }
export class StoreConflictError extends Error { constructor(message:string){super(message);this.name="StoreConflictError";} }
export class StoreIntegrityError extends Error { constructor(message:string){super(message);this.name="StoreIntegrityError";} }
const now=():string=>new Date().toISOString();

export class SQLiteAuthority {
  readonly db:DatabaseSync; readonly artifacts:ArtifactStore;
  constructor(databasePath:string,artifactRoot:string,private readonly crash:CrashInjector=noCrash){this.db=new DatabaseSync(databasePath);migrate(this.db);this.artifacts=new ArtifactStore(artifactRoot,this.db,crash);}
  close():void{this.db.close();}
  migrationVersions():number[]{return (this.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {version:number}[]).map(r=>r.version);}
  private validateAppend<T extends DomainEventPayloadV1>(request:AppendRequest<T>):void {
    if(request.events.length===0)throw new StoreIntegrityError("empty append");
    verifyEventChain(request.events);
    for(const [index,event] of request.events.entries()){
      const envelope=event.envelope;
      if(envelope.streamKind!==request.streamKind||envelope.workspaceId!==request.workspaceId||envelope.streamId!==request.streamId||envelope.sequence!==request.expectedSequence+index+1)throw new StoreIntegrityError("event does not match append stream");
      const previous=request.events[index-1];
      const expectedPrior=index===0?request.expectedEnvelopeHash:previous?.envelopeHash;
      if(envelope.priorEnvelopeHash!==expectedPrior)throw new StoreIntegrityError("event prior hash mismatch");
    }
  }
  private head<T extends DomainEventPayloadV1>(request:AppendRequest<T>):{head_sequence:number;head_hash:string|null}|undefined{return this.db.prepare("SELECT head_sequence,head_hash FROM streams WHERE stream_kind=? AND stream_id=?").get(request.streamKind,request.streamId) as {head_sequence:number;head_hash:string|null}|undefined;}
  private writeAppend<T extends DomainEventPayloadV1>(request:AppendRequest<T>):{sequence:number;envelopeHash:string}{
    this.validateAppend(request);const head=this.head(request);const actualSequence=head?.head_sequence??0;const actualHash=head?.head_hash??null;if(actualSequence!==request.expectedSequence||actualHash!==request.expectedEnvelopeHash)throw new StoreConflictError("stream compare-and-swap conflict");
    if(!head)this.db.prepare("INSERT INTO streams(stream_kind,workspace_id,stream_id,head_sequence,head_hash,context_epoch) VALUES(?,?,?,?,NULL,0)").run(request.streamKind,request.workspaceId,request.streamId,0);
    const insert=this.db.prepare("INSERT INTO events(stream_kind,workspace_id,stream_id,sequence,envelope_hash,prior_envelope_hash,event_id,idempotency_key,command_id,envelope_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    for(const event of request.events){const envelope=event.envelope;insert.run(request.streamKind,request.workspaceId,request.streamId,envelope.sequence,event.envelopeHash,envelope.priorEnvelopeHash,envelope.eventId,envelope.idempotencyKey,envelope.causationId,canonicalJson(event as unknown as JsonValue),now());}
    const last=request.events.at(-1);if(!last)throw new StoreIntegrityError("empty append");this.db.prepare("UPDATE streams SET head_sequence=?,head_hash=? WHERE stream_kind=? AND stream_id=?").run(last.envelope.sequence,last.envelopeHash,request.streamKind,request.streamId);return{sequence:last.envelope.sequence,envelopeHash:last.envelopeHash};
  }
  appendAtomic(request:AtomicAppendRequest):AppendResult {
    if(!request.workspace&&!request.run)throw new StoreIntegrityError("atomic append has no streams");if(request.workspace?.streamKind!==undefined&&request.workspace.streamKind!=="workspace")throw new StoreIntegrityError("workspace append kind mismatch");if(request.run?.streamKind!==undefined&&request.run.streamKind!=="run")throw new StoreIntegrityError("run append kind mismatch");
    const digest=domainDigest("horseness.store-append.v1",JSON.parse(canonicalJson(request as unknown as JsonValue)) as JsonValue);const prior=this.db.prepare("SELECT request_digest,result_json FROM command_dedup WHERE command_id=?").get(request.commandId) as {request_digest:string;result_json:string}|undefined;if(prior){if(prior.request_digest!==digest)throw new StoreConflictError("command id reused with different request");return{...(JSON.parse(prior.result_json) as AppendResult),deduplicated:true};}
    this.crash("transaction.begin.before");this.db.exec("BEGIN IMMEDIATE");this.crash("transaction.begin.after");
    try{this.crash("transaction.write.before");const result:AppendResult={commandId:request.commandId,deduplicated:false};if(request.workspace)result.workspaceHead=this.writeAppend(request.workspace);if(request.run)result.runHead=this.writeAppend(request.run);this.db.prepare("INSERT INTO command_dedup(command_id,request_digest,result_json,created_at) VALUES(?,?,?,?)").run(request.commandId,digest,canonicalJson(result as unknown as JsonValue),now());this.crash("transaction.write.after");this.crash("transaction.commit.before");this.db.exec("COMMIT");this.crash("transaction.commit.after");return result;}catch(error){if(this.db.isTransaction){this.crash("transaction.rollback.before");this.db.exec("ROLLBACK");this.crash("transaction.rollback.after");}throw error;}
  }
  replay(streamKind:EventStream,streamId:string,fromSequence=1):StoredEvent[]{const rows=this.db.prepare("SELECT envelope_json FROM events WHERE stream_kind=? AND stream_id=? AND sequence>=? ORDER BY sequence").all(streamKind,streamId,fromSequence) as {envelope_json:string}[];const events=rows.map(r=>JSON.parse(r.envelope_json) as StoredEvent);if(fromSequence===1&&events.length>0){if(events[0]?.envelope.sequence!==1||events[0].envelope.priorEnvelopeHash!==null)throw new StoreIntegrityError("invalid stream genesis");verifyEventChain(events);}return events;}
  replayRaw(streamKind:EventStream,streamId:string):readonly string[]{return (this.db.prepare("SELECT envelope_json FROM events WHERE stream_kind=? AND stream_id=? ORDER BY sequence").all(streamKind,streamId) as {envelope_json:string}[]).map(r=>r.envelope_json);}
  putSnapshot(snapshot:SnapshotRecord):void{const event=this.db.prepare("SELECT envelope_hash FROM events WHERE stream_kind=? AND stream_id=? AND sequence=?").get(snapshot.streamKind,snapshot.streamId,snapshot.sequence) as {envelope_hash:string}|undefined;if(!event||event.envelope_hash!==snapshot.envelopeHash)throw new StoreIntegrityError("snapshot is not anchored to event chain");this.db.prepare("INSERT OR REPLACE INTO snapshots(stream_kind,stream_id,sequence,envelope_hash,projection_name,projection_version,state_json,created_at) VALUES(?,?,?,?,?,?,?,?)").run(snapshot.streamKind,snapshot.streamId,snapshot.sequence,snapshot.envelopeHash,snapshot.projectionName,snapshot.projectionVersion,canonicalJson(snapshot.state),now());}
  latestSnapshot(streamKind:EventStream,streamId:string,projectionName:string,projectionVersion:string):SnapshotRecord|null{const row=this.db.prepare("SELECT sequence,envelope_hash,state_json FROM snapshots WHERE stream_kind=? AND stream_id=? AND projection_name=? AND projection_version=? ORDER BY sequence DESC LIMIT 1").get(streamKind,streamId,projectionName,projectionVersion) as {sequence:number;envelope_hash:string;state_json:string}|undefined;return row?{streamKind,streamId,projectionName,projectionVersion,sequence:row.sequence,envelopeHash:row.envelope_hash,state:JSON.parse(row.state_json) as JsonValue}:null;}
  setProjectionMetadata(name:string,version:string,streamKind:EventStream,streamId:string,lastSequence:number,lastEnvelopeHash:string|null):void{this.db.prepare("INSERT INTO projection_metadata(projection_name,projection_version,stream_kind,stream_id,last_sequence,last_envelope_hash,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(projection_name,projection_version,stream_kind,stream_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_envelope_hash=excluded.last_envelope_hash,updated_at=excluded.updated_at").run(name,version,streamKind,streamId,lastSequence,lastEnvelopeHash,now());}
}
