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
export interface SnapshotRecord { workspaceId:string; streamKind:EventStream; streamId:string; sequence:number; envelopeHash:string; projectionName:string; projectionVersion:string; state:JsonValue }
export interface ArtifactPublication { data:Uint8Array|string; mediaType?:string|null; references?:readonly {ownerKind:string;ownerId:string}[]; pins?:readonly {pinId:string}[] }
export interface AtomicProjectionUpdate { workspaceId:string; name:string; version:string; streamKind:EventStream; streamId:string; lastSequence:number; lastEnvelopeHash:string|null }
export interface PublishAndAppendRequest extends AtomicAppendRequest { artifacts:readonly ArtifactPublication[]; requiredArtifactDigests?:readonly string[]; projections?:readonly AtomicProjectionUpdate[] }
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
  private head<T extends DomainEventPayloadV1>(request:AppendRequest<T>):{head_sequence:number;head_hash:string|null}|undefined{return this.db.prepare("SELECT head_sequence,head_hash FROM streams WHERE workspace_id=? AND stream_kind=? AND stream_id=?").get(request.workspaceId,request.streamKind,request.streamId) as {head_sequence:number;head_hash:string|null}|undefined;}
  private writeAppend<T extends DomainEventPayloadV1>(request:AppendRequest<T>):{sequence:number;envelopeHash:string}{
    this.validateAppend(request);const head=this.head(request);const actualSequence=head?.head_sequence??0;const actualHash=head?.head_hash??null;if(actualSequence!==request.expectedSequence||actualHash!==request.expectedEnvelopeHash)throw new StoreConflictError("stream compare-and-swap conflict");
    if(!head)this.db.prepare("INSERT INTO streams(stream_kind,workspace_id,stream_id,head_sequence,head_hash,context_epoch) VALUES(?,?,?,?,NULL,0)").run(request.streamKind,request.workspaceId,request.streamId,0);
    const insert=this.db.prepare("INSERT INTO events(stream_kind,workspace_id,stream_id,sequence,envelope_hash,prior_envelope_hash,event_id,idempotency_key,command_id,envelope_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    for(const event of request.events){const envelope=event.envelope;insert.run(request.streamKind,request.workspaceId,request.streamId,envelope.sequence,event.envelopeHash,envelope.priorEnvelopeHash,envelope.eventId,envelope.idempotencyKey,envelope.causationId,canonicalJson(event as unknown as JsonValue),now());}
    const last=request.events.at(-1);if(!last)throw new StoreIntegrityError("empty append");this.db.prepare("UPDATE streams SET head_sequence=?,head_hash=? WHERE workspace_id=? AND stream_kind=? AND stream_id=?").run(last.envelope.sequence,last.envelopeHash,request.workspaceId,request.streamKind,request.streamId);return{sequence:last.envelope.sequence,envelopeHash:last.envelopeHash};
  }
  private requestWorkspace(request:AtomicAppendRequest):string{const workspaceId=request.workspace?.workspaceId??request.run?.workspaceId;if(workspaceId===undefined||request.workspace!==undefined&&request.workspace.workspaceId!==workspaceId||request.run!==undefined&&request.run.workspaceId!==workspaceId)throw new StoreIntegrityError("atomic append workspace mismatch");return workspaceId;}
  appendAtomic(request:AtomicAppendRequest):AppendResult {
    if(!request.workspace&&!request.run)throw new StoreIntegrityError("atomic append has no streams");if(request.workspace?.streamKind!==undefined&&request.workspace.streamKind!=="workspace")throw new StoreIntegrityError("workspace append kind mismatch");if(request.run?.streamKind!==undefined&&request.run.streamKind!=="run")throw new StoreIntegrityError("run append kind mismatch");
    const workspaceId=this.requestWorkspace(request);const digest=domainDigest("horseness.store-append.v1",JSON.parse(canonicalJson(request as unknown as JsonValue)) as JsonValue);
    this.crash("transaction.begin.before");this.db.exec("BEGIN IMMEDIATE");this.crash("transaction.begin.after");
    try{const prior=this.db.prepare("SELECT request_digest,result_json FROM command_dedup WHERE workspace_id=? AND command_id=?").get(workspaceId,request.commandId) as {request_digest:string;result_json:string}|undefined;if(prior){if(prior.request_digest!==digest)throw new StoreConflictError("command id reused with different request");const result=JSON.parse(prior.result_json) as AppendResult;this.db.exec("COMMIT");return{...result,deduplicated:true};}this.crash("transaction.write.before");const result:AppendResult={commandId:request.commandId,deduplicated:false};if(request.workspace)result.workspaceHead=this.writeAppend(request.workspace);if(request.run)result.runHead=this.writeAppend(request.run);this.db.prepare("INSERT INTO command_dedup(workspace_id,command_id,request_digest,result_json,created_at) VALUES(?,?,?,?,?)").run(workspaceId,request.commandId,digest,canonicalJson(result as unknown as JsonValue),now());this.crash("transaction.write.after");this.crash("transaction.commit.before");this.db.exec("COMMIT");this.crash("transaction.commit.after");return result;}catch(error){if(this.db.isTransaction){this.crash("transaction.rollback.before");this.db.exec("ROLLBACK");this.crash("transaction.rollback.after");}throw error;}
  }
  private authenticatedRows(workspaceId:string,streamKind:EventStream,streamId:string):{raw:string;event:StoredEvent}[]{const head=this.db.prepare("SELECT head_sequence,head_hash FROM streams WHERE workspace_id=? AND stream_kind=? AND stream_id=?").get(workspaceId,streamKind,streamId) as {head_sequence:number;head_hash:string|null}|undefined;const rows=this.db.prepare("SELECT sequence,envelope_hash,prior_envelope_hash,envelope_json FROM events WHERE workspace_id=? AND stream_kind=? AND stream_id=? ORDER BY sequence").all(workspaceId,streamKind,streamId) as {sequence:number;envelope_hash:string;prior_envelope_hash:string|null;envelope_json:string}[];if(head===undefined){if(rows.length!==0)throw new StoreIntegrityError("events exist without stream head");return[];}try{const authenticated=rows.map(row=>{const event=JSON.parse(row.envelope_json) as StoredEvent;const envelope=event.envelope;if(envelope.workspaceId!==workspaceId||envelope.streamKind!==streamKind||envelope.streamId!==streamId||envelope.sequence!==row.sequence||event.envelopeHash!==row.envelope_hash||envelope.priorEnvelopeHash!==row.prior_envelope_hash)throw new StoreIntegrityError("event row does not match envelope");return{raw:row.envelope_json,event};});if(authenticated.length===0||authenticated[0]?.event.envelope.sequence!==1||authenticated[0].event.envelope.priorEnvelopeHash!==null)throw new StoreIntegrityError("invalid stream genesis");verifyEventChain(authenticated.map(item=>item.event));const last=authenticated.at(-1)?.event;if(last===undefined||head.head_sequence!==last.envelope.sequence||head.head_hash!==last.envelopeHash)throw new StoreIntegrityError("stored stream head mismatch");return authenticated;}catch(error){if(error instanceof StoreIntegrityError)throw error;throw new StoreIntegrityError(`event chain authentication failed: ${error instanceof Error?error.message:String(error)}`);}}
  replay(workspaceId:string,streamKind:EventStream,streamId:string,fromSequence=1):StoredEvent[]{if(!Number.isSafeInteger(fromSequence)||fromSequence<1)throw new StoreIntegrityError("invalid replay sequence");return this.authenticatedRows(workspaceId,streamKind,streamId).filter(item=>item.event.envelope.sequence>=fromSequence).map(item=>item.event);}
  replayRaw(workspaceId:string,streamKind:EventStream,streamId:string,fromSequence=1):readonly string[]{if(!Number.isSafeInteger(fromSequence)||fromSequence<1)throw new StoreIntegrityError("invalid replay sequence");return this.authenticatedRows(workspaceId,streamKind,streamId).filter(item=>item.event.envelope.sequence>=fromSequence).map(item=>item.raw);}
  putSnapshot(snapshot:SnapshotRecord):void{const event=this.db.prepare("SELECT envelope_hash FROM events WHERE workspace_id=? AND stream_kind=? AND stream_id=? AND sequence=?").get(snapshot.workspaceId,snapshot.streamKind,snapshot.streamId,snapshot.sequence) as {envelope_hash:string}|undefined;if(!event||event.envelope_hash!==snapshot.envelopeHash)throw new StoreIntegrityError("snapshot is not anchored to event chain");this.db.prepare("INSERT OR REPLACE INTO snapshots(workspace_id,stream_kind,stream_id,sequence,envelope_hash,projection_name,projection_version,state_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(snapshot.workspaceId,snapshot.streamKind,snapshot.streamId,snapshot.sequence,snapshot.envelopeHash,snapshot.projectionName,snapshot.projectionVersion,canonicalJson(snapshot.state),now());}
  latestSnapshot(workspaceId:string,streamKind:EventStream,streamId:string,projectionName:string,projectionVersion:string):SnapshotRecord|null{const row=this.db.prepare("SELECT sequence,envelope_hash,state_json FROM snapshots WHERE workspace_id=? AND stream_kind=? AND stream_id=? AND projection_name=? AND projection_version=? ORDER BY sequence DESC LIMIT 1").get(workspaceId,streamKind,streamId,projectionName,projectionVersion) as {sequence:number;envelope_hash:string;state_json:string}|undefined;return row?{workspaceId,streamKind,streamId,projectionName,projectionVersion,sequence:row.sequence,envelopeHash:row.envelope_hash,state:JSON.parse(row.state_json) as JsonValue}:null;}
  setProjectionMetadata(name:string,version:string,workspaceId:string,streamKind:EventStream,streamId:string,lastSequence:number,lastEnvelopeHash:string|null):void{this.db.prepare("INSERT INTO projection_metadata(projection_name,projection_version,workspace_id,stream_kind,stream_id,last_sequence,last_envelope_hash,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(projection_name,projection_version,workspace_id,stream_kind,stream_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_envelope_hash=excluded.last_envelope_hash,updated_at=excluded.updated_at").run(name,version,workspaceId,streamKind,streamId,lastSequence,lastEnvelopeHash,now());}
  publishAndAppendAtomic(request:PublishAndAppendRequest):AppendResult {
    const records=request.artifacts.map(publication=>({publication,record:this.artifacts.publish(publication.data,publication.mediaType??null)}));
    const available=new Set(records.map(item=>item.record.digest));
    if(!request.requiredArtifactDigests||request.requiredArtifactDigests.length===0)throw new StoreIntegrityError("authoritative artifact append requires artifact digests");
    for(const digest of request.requiredArtifactDigests??[])if(!available.has(digest))throw new StoreIntegrityError(`required artifact was not published: ${digest}`);
    if(!request.workspace&&!request.run)throw new StoreIntegrityError("atomic append has no streams");
    if(request.workspace?.streamKind!==undefined&&request.workspace.streamKind!=="workspace")throw new StoreIntegrityError("workspace append kind mismatch");
    if(request.run?.streamKind!==undefined&&request.run.streamKind!=="run")throw new StoreIntegrityError("run append kind mismatch");
    const workspaceId=this.requestWorkspace(request);
    for(const projection of request.projections??[])if(projection.workspaceId!==workspaceId)throw new StoreIntegrityError("projection workspace mismatch");
    const digestInput={commandId:request.commandId,workspace:request.workspace??null,run:request.run??null,artifacts:records.map(({publication,record})=>({record,references:publication.references??[],pins:publication.pins??[]})),requiredArtifactDigests:request.requiredArtifactDigests??[],projections:request.projections??[]};
    const requestDigest=domainDigest("horseness.store-artifact-append.v1",JSON.parse(canonicalJson(digestInput as unknown as JsonValue)) as JsonValue);
    this.crash("transaction.begin.before");this.db.exec("BEGIN IMMEDIATE");this.crash("transaction.begin.after");
    try {
      const prior=this.db.prepare("SELECT request_digest,result_json FROM command_dedup WHERE workspace_id=? AND command_id=?").get(workspaceId,request.commandId) as {request_digest:string;result_json:string}|undefined;
      if(prior){if(prior.request_digest!==requestDigest)throw new StoreConflictError("command id reused with different request");this.db.exec("COMMIT");return{...(JSON.parse(prior.result_json) as AppendResult),deduplicated:true};}
      this.crash("transaction.write.before");
      const result:AppendResult={commandId:request.commandId,deduplicated:false};
      for(const {publication,record} of records){
        this.artifacts.verifyRecord(record);this.artifacts.register(record);
        for(const reference of publication.references??[])this.db.prepare("INSERT OR IGNORE INTO artifact_refs(owner_kind,owner_id,digest,created_at) VALUES(?,?,?,?)").run(reference.ownerKind,reference.ownerId,record.digest,now());
        for(const pin of publication.pins??[])this.db.prepare("INSERT OR IGNORE INTO artifact_pins(pin_id,digest,created_at) VALUES(?,?,?)").run(pin.pinId,record.digest,now());
      }
      for(const required of request.requiredArtifactDigests??[]){const record=records.find(item=>item.record.digest===required)?.record;if(!record)throw new StoreIntegrityError(`required artifact was not published: ${required}`);this.artifacts.verifyRecord(record);}
      if(request.workspace)result.workspaceHead=this.writeAppend(request.workspace);
      if(request.run)result.runHead=this.writeAppend(request.run);
      for(const projection of request.projections??[]){const anchor=projection.lastSequence===0&&projection.lastEnvelopeHash===null?true:this.db.prepare("SELECT 1 FROM events WHERE workspace_id=? AND stream_kind=? AND stream_id=? AND sequence=? AND envelope_hash=?").get(projection.workspaceId,projection.streamKind,projection.streamId,projection.lastSequence,projection.lastEnvelopeHash)!==undefined;if(!anchor)throw new StoreIntegrityError(`projection is not anchored to an event: ${projection.name}`);this.db.prepare("INSERT INTO projection_metadata(projection_name,projection_version,workspace_id,stream_kind,stream_id,last_sequence,last_envelope_hash,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(projection_name,projection_version,workspace_id,stream_kind,stream_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_envelope_hash=excluded.last_envelope_hash,updated_at=excluded.updated_at").run(projection.name,projection.version,projection.workspaceId,projection.streamKind,projection.streamId,projection.lastSequence,projection.lastEnvelopeHash,now());}
      this.db.prepare("INSERT INTO command_dedup(workspace_id,command_id,request_digest,result_json,created_at) VALUES(?,?,?,?,?)").run(workspaceId,request.commandId,requestDigest,canonicalJson(result as unknown as JsonValue),now());
      this.crash("transaction.write.after");this.crash("transaction.commit.before");this.db.exec("COMMIT");this.crash("transaction.commit.after");return result;
    } catch(error){if(this.db.isTransaction){this.crash("transaction.rollback.before");this.db.exec("ROLLBACK");this.crash("transaction.rollback.after");}throw error;}
  }
}
