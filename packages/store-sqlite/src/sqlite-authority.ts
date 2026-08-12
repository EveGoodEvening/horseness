import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { canonicalJson, domainDigest, parseDomainEventPayloadV1, parseObservationCursorV1, verifyEventChain, type AbsentRunGenesisCursorV1, type DomainEventPayloadV1, type HashedEventEnvelopeV1, type JsonValue, type RunCreatedV1, type RunEventPayloadV1, type WorkspaceEventPayloadV1 } from "@horseness/domain";
import { ArtifactStore } from "./artifact-store.js";
import { noCrash, type CrashInjector } from "./crash.js";
import { inspectMigrationLedger, migrate } from "./migrations.js";
import { upgradeAuthority } from "./migrations/index.js";
import { recoverInterruptedRestore } from "./restore/index.js";
import { issueTrustedAuthorityReader, type TrustedAuthorityReader, type AuthenticatedWorkspaceSessionV1, type TrustedSnapshotReducerRegistrationV1 } from "./trusted-reader.js";

export type EventStream="workspace"|"run";
export type StoredEvent=HashedEventEnvelopeV1<DomainEventPayloadV1>;
export interface AppendRequest<T extends DomainEventPayloadV1=DomainEventPayloadV1> { streamKind:EventStream; workspaceId:string; streamId:string; expectedSequence:number; expectedEnvelopeHash:string|null; events:readonly HashedEventEnvelopeV1<T>[] }
export interface RunGenesisAppendRequest { observationCursor:AbsentRunGenesisCursorV1; event:HashedEventEnvelopeV1<RunCreatedV1> }
export interface AtomicAppendRequest { commandId:string; workspace?:AppendRequest<WorkspaceEventPayloadV1>; run?:AppendRequest<RunEventPayloadV1>; runGenesis?:RunGenesisAppendRequest }
export interface AppendResult { commandId:string; workspaceHead?:{sequence:number;envelopeHash:string}; runHead?:{sequence:number;envelopeHash:string}; deduplicated:boolean }
export interface SnapshotRecord { workspaceId:string; streamKind:EventStream; streamId:string; sequence:number; envelopeHash:string; projectionName:string; projectionVersion:string; state:JsonValue }
export interface ArtifactPublication { data:Uint8Array|string; mediaType?:string|null; references?:readonly {ownerKind:string;ownerId:string;allowExistingEvent?:true}[]; pins?:readonly {pinId:string}[] }
export interface AtomicProjectionUpdate { workspaceId:string; name:string; version:string; streamKind:EventStream; streamId:string; lastSequence:number; lastEnvelopeHash:string|null }
export interface AtomicSnapshotUpdate extends SnapshotRecord {}
export interface AuthenticatedWorkspaceOpenV1 { workspaceId:string; sessionId:string; snapshotReducers:readonly TrustedSnapshotReducerRegistrationV1[] }
export interface PublishAndAppendRequest extends AtomicAppendRequest { artifacts:readonly ArtifactPublication[]; requiredArtifactDigests?:readonly string[]; projections?:readonly AtomicProjectionUpdate[]; snapshots?:readonly AtomicSnapshotUpdate[] }
export class StoreConflictError extends Error { constructor(message:string){super(message);this.name="StoreConflictError";} }
export class StoreIntegrityError extends Error { constructor(message:string){super(message);this.name="StoreIntegrityError";} }
const now=():string=>new Date().toISOString();
const activeWorkspaceSessions=new Map<string,{sessionId:string;authority:WeakRef<SQLiteAuthority>}>();

export class SQLiteAuthority {
  readonly db:DatabaseSync; readonly artifacts:ArtifactStore;
  private readonly authorityIdentity:string;
  private trustedSession:AuthenticatedWorkspaceSessionV1|null=null;
  constructor(databasePath:string,artifactRoot:string,private readonly crash:CrashInjector=noCrash,verifiedOpen=false){
    this.authorityIdentity=resolve(databasePath);
    this.db=new DatabaseSync(databasePath);
    try {
      const appliedCount=inspectMigrationLedger(this.db);
      if(appliedCount===1){
        if(!verifiedOpen)throw new StoreIntegrityError("verified authority open required for schema upgrade");
        upgradeAuthority(this.db,artifactRoot);
      }else migrate(this.db);
      this.artifacts=new ArtifactStore(artifactRoot,this.db,crash);
    }catch(error){this.db.close();throw error;}
  }
  static open(databasePath:string,artifactRoot:string,crash:CrashInjector=noCrash):SQLiteAuthority{
    recoverInterruptedRestore(databasePath,artifactRoot);
    return new SQLiteAuthority(databasePath,artifactRoot,crash,true);
  }
  static openAuthenticatedWorkspace(databasePath:string,artifactRoot:string,binding:AuthenticatedWorkspaceOpenV1,crash:CrashInjector=noCrash):{authority:SQLiteAuthority;reader:TrustedAuthorityReader}{
    if(binding.workspaceId.length===0||binding.sessionId.length===0)throw new StoreIntegrityError("invalid authenticated workspace session identity");
    const authority=SQLiteAuthority.open(databasePath,artifactRoot,crash);
    try{
      const workspaceRows=authority.replay(binding.workspaceId,"workspace",binding.workspaceId);
      if(workspaceRows.length===0)throw new StoreIntegrityError("authenticated workspace does not exist in authority");
      const sessionKey=`${authority.authorityIdentity}\u0000${binding.workspaceId}`;
      const existing=activeWorkspaceSessions.get(sessionKey), live=existing?.authority.deref();
      if(live!==undefined&&live!==authority)throw new StoreConflictError("workspace already belongs to another active authority session");
      if(existing!==undefined&&existing.sessionId!==binding.sessionId)throw new StoreConflictError("workspace authority session identity mismatch");
      if(binding.snapshotReducers.some(registration=>registration.projectionName.length===0||registration.projectionVersion.length===0))throw new StoreIntegrityError("invalid trusted snapshot reducer registration");
      const session=Object.freeze({schemaVersion:"1" as const,workspaceId:binding.workspaceId,sessionId:binding.sessionId,snapshotReducers:Object.freeze(binding.snapshotReducers.map(registration=>Object.freeze({...registration})))});
      authority.trustedSession=session;
      activeWorkspaceSessions.set(sessionKey,{sessionId:binding.sessionId,authority:new WeakRef(authority)});
      return {authority,reader:issueTrustedAuthorityReader(authority,session)};
    }catch(error){authority.close();throw error;}
  }
  close():void{if(this.trustedSession!==null){const sessionKey=`${this.authorityIdentity}\u0000${this.trustedSession.workspaceId}`;const current=activeWorkspaceSessions.get(sessionKey);if(current?.authority.deref()===this)activeWorkspaceSessions.delete(sessionKey);this.trustedSession=null;}this.db.close();}
  migrationVersions():number[]{return (this.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as {version:number}[]).map(r=>r.version);}
  private validateAppend<T extends DomainEventPayloadV1>(request:AppendRequest<T>):void {
    if(request.events.length===0)throw new StoreIntegrityError("empty append");
    if(!Number.isSafeInteger(request.expectedSequence)||request.expectedSequence<0)throw new StoreIntegrityError("invalid expected sequence");
    if(request.expectedSequence===0){
      if(request.expectedEnvelopeHash!==null)throw new StoreIntegrityError("genesis append has an existing head");
      try{verifyEventChain(request.events);}catch(error){throw new StoreIntegrityError(`event slice authentication failed: ${error instanceof Error?error.message:String(error)}`);}
    }else if(typeof request.expectedEnvelopeHash!=="string"||request.expectedEnvelopeHash.length===0)throw new StoreIntegrityError("post-genesis append requires an authenticated head");
    let prior=request.expectedEnvelopeHash;
    for(const [index,event] of request.events.entries()){
      const envelope=event.envelope;
      if(envelope.schemaVersion!=="1")throw new StoreIntegrityError("unsupported event schema");
      if(envelope.streamKind!==request.streamKind||envelope.workspaceId!==request.workspaceId||envelope.streamId!==request.streamId||envelope.sequence!==request.expectedSequence+index+1)throw new StoreIntegrityError("event does not match append stream");
      if(request.streamKind==="workspace"&&request.streamId!==request.workspaceId)throw new StoreIntegrityError("workspace stream identity mismatch");
      if(envelope.priorEnvelopeHash!==prior)throw new StoreIntegrityError("event prior hash mismatch");
      try{
        const payload=parseDomainEventPayloadV1(envelope.payload);
        if(payload.eventType!==envelope.eventType||payload.workspaceId!==request.workspaceId||request.streamKind==="run"&&("runId" in payload&&payload.runId!==request.streamId||!("runId" in payload))||request.streamKind==="workspace"&&"runId" in payload)throw new StoreIntegrityError("event payload identity mismatch");
        if(domainDigest("horseness.event-payload.v1",envelope.payload)!==envelope.payloadHash)throw new StoreIntegrityError("event payload hash mismatch");
        if(domainDigest("horseness.event-envelope.v1",envelope as unknown as JsonValue)!==event.envelopeHash)throw new StoreIntegrityError("event envelope hash mismatch");
      }catch(error){if(error instanceof StoreIntegrityError)throw error;throw new StoreIntegrityError(`event slice authentication failed: ${error instanceof Error?error.message:String(error)}`);}
      prior=event.envelopeHash;
    }
  }
  private head<T extends DomainEventPayloadV1>(request:AppendRequest<T>):{head_sequence:number;head_hash:string|null}|undefined{return this.db.prepare("SELECT head_sequence,head_hash FROM streams WHERE workspace_id=? AND stream_kind=? AND stream_id=?").get(request.workspaceId,request.streamKind,request.streamId) as {head_sequence:number;head_hash:string|null}|undefined;}
  private writeAppend<T extends DomainEventPayloadV1>(request:AppendRequest<T>):{sequence:number;envelopeHash:string}{
    this.validateAppend(request);const head=this.head(request);const actualSequence=head?.head_sequence??0;const actualHash=head?.head_hash??null;if(actualSequence!==request.expectedSequence||actualHash!==request.expectedEnvelopeHash)throw new StoreConflictError("stream compare-and-swap conflict");
    if(!head)this.db.prepare("INSERT INTO streams(stream_kind,workspace_id,stream_id,head_sequence,head_hash,context_epoch) VALUES(?,?,?,?,NULL,0)").run(request.streamKind,request.workspaceId,request.streamId,0);
    const insert=this.db.prepare("INSERT INTO events(stream_kind,workspace_id,stream_id,sequence,envelope_hash,prior_envelope_hash,event_id,idempotency_key,command_id,envelope_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    for(const event of request.events){const envelope=event.envelope;insert.run(request.streamKind,request.workspaceId,request.streamId,envelope.sequence,event.envelopeHash,envelope.priorEnvelopeHash,envelope.eventId,envelope.idempotencyKey,envelope.causationId,canonicalJson(event as unknown as JsonValue),now());}
    const last=request.events.at(-1);if(!last)throw new StoreIntegrityError("empty append");const contextEpoch=Math.max(0,last.envelope.sequence-1);this.db.prepare("UPDATE streams SET head_sequence=?,head_hash=?,context_epoch=? WHERE workspace_id=? AND stream_kind=? AND stream_id=?").run(last.envelope.sequence,last.envelopeHash,contextEpoch,request.workspaceId,request.streamKind,request.streamId);const authenticated=this.authenticatedRows(request.workspaceId,request.streamKind,request.streamId);const authenticatedLast=authenticated.at(-1)?.event;if(authenticatedLast===undefined||authenticatedLast.envelope.sequence!==last.envelope.sequence||authenticatedLast.envelopeHash!==last.envelopeHash)throw new StoreIntegrityError("appended stream head authentication failed");return{sequence:last.envelope.sequence,envelopeHash:last.envelopeHash};
  }
  private requestWorkspace(request:AtomicAppendRequest):string{const workspaceId=request.workspace?.workspaceId??request.run?.workspaceId??request.runGenesis?.observationCursor.workspaceId;if(workspaceId===undefined||request.workspace!==undefined&&request.workspace.workspaceId!==workspaceId||request.run!==undefined&&request.run.workspaceId!==workspaceId||request.runGenesis!==undefined&&request.runGenesis.observationCursor.workspaceId!==workspaceId)throw new StoreIntegrityError("atomic append workspace mismatch");return workspaceId;}
  private commandScope(request:AtomicAppendRequest):{kind:"workspace"|"run";id:string}{const runId=request.run?.streamId??request.runGenesis?.observationCursor.runId;return runId===undefined?{kind:"workspace",id:this.requestWorkspace(request)}:{kind:"run",id:runId};}
  recordAuthorityConsumption(input:{workspaceId:string;runId?:string;principalId:string;authorityKey:string;commandId:string}):boolean{const values=[input.workspaceId,input.principalId,input.authorityKey,input.commandId];if(values.some(value=>value.length===0)||input.runId!==undefined&&input.runId.length===0)throw new StoreIntegrityError("invalid authority consumption identity");const scopeKind=input.runId===undefined?"workspace":"run";const scopeId=input.runId??input.workspaceId;this.db.exec("BEGIN IMMEDIATE");try{const prior=this.db.prepare("SELECT command_id FROM authority_consumption WHERE workspace_id=? AND scope_kind=? AND scope_id=? AND principal_id=? AND authority_key=?").get(input.workspaceId,scopeKind,scopeId,input.principalId,input.authorityKey) as {command_id:string}|undefined;if(prior!==undefined){if(prior.command_id!==input.commandId)throw new StoreConflictError("authority key was already consumed by another command");this.db.exec("COMMIT");return false;}this.db.prepare("INSERT INTO authority_consumption(workspace_id,scope_kind,scope_id,principal_id,authority_key,command_id,consumed_at) VALUES(?,?,?,?,?,?,?)").run(input.workspaceId,scopeKind,scopeId,input.principalId,input.authorityKey,input.commandId,now());this.db.exec("COMMIT");return true;}catch(error){if(this.db.isTransaction)this.db.exec("ROLLBACK");throw error;}}
  private writeRunGenesis(request:RunGenesisAppendRequest):{sequence:number;envelopeHash:string}{
    let cursor:AbsentRunGenesisCursorV1;try{const parsed=parseObservationCursorV1(request.observationCursor);if(parsed.kind!=="absent-run-genesis")throw new StoreIntegrityError("run genesis requires an absent-run cursor");cursor=parsed;}catch(error){if(error instanceof StoreIntegrityError)throw error;throw new StoreIntegrityError(`invalid absent-run genesis cursor: ${error instanceof Error?error.message:String(error)}`);}
    const workspace=this.db.prepare("SELECT head_sequence,head_hash,context_epoch FROM streams WHERE workspace_id=? AND stream_kind='workspace' AND stream_id=?").get(cursor.workspaceId,cursor.workspaceId) as {head_sequence:number;head_hash:string|null;context_epoch:number}|undefined;
    if(!workspace)throw new StoreConflictError("run genesis requires an existing workspace");
    if(workspace.head_sequence!==cursor.workspaceSequence||workspace.head_hash!==cursor.workspaceEnvelopeHash||workspace.context_epoch!==cursor.workspaceContextEpoch)throw new StoreConflictError("workspace observation compare-and-swap conflict");
    this.authenticatedRows(cursor.workspaceId,"workspace",cursor.workspaceId);
    const authorityStateCount=(this.db.prepare("SELECT (SELECT count(*) FROM streams WHERE workspace_id=? AND stream_kind='run' AND stream_id=?) + (SELECT count(*) FROM events WHERE workspace_id=? AND stream_kind='run' AND stream_id=?) + (SELECT count(*) FROM snapshots WHERE workspace_id=? AND stream_kind='run' AND stream_id=?) + (SELECT count(*) FROM projection_metadata WHERE workspace_id=? AND stream_kind='run' AND stream_id=?) + (SELECT count(*) FROM command_dedup WHERE workspace_id=? AND scope_kind='run' AND scope_id=?) + (SELECT count(*) FROM authority_consumption WHERE workspace_id=? AND scope_kind='run' AND scope_id=?) AS count").get(cursor.workspaceId,cursor.runId,cursor.workspaceId,cursor.runId,cursor.workspaceId,cursor.runId,cursor.workspaceId,cursor.runId,cursor.workspaceId,cursor.runId,cursor.workspaceId,cursor.runId) as {count:number}).count;
    if(authorityStateCount!==0)throw new StoreConflictError("run authority state is not absent");
    const append:AppendRequest<RunCreatedV1>={streamKind:"run",workspaceId:cursor.workspaceId,streamId:cursor.runId,expectedSequence:0,expectedEnvelopeHash:null,events:[request.event]};
    if(request.event.envelope.eventType!=="RunCreatedV1")throw new StoreIntegrityError("run genesis must append exactly one RunCreatedV1");
    return this.writeAppend(append);
  }
  appendAtomic(request:AtomicAppendRequest):AppendResult {
    if(!request.workspace&&!request.run&&!request.runGenesis)throw new StoreIntegrityError("atomic append has no streams");
    if(request.run&&request.run.expectedSequence===0)throw new StoreIntegrityError("run genesis requires the explicit runGenesis operation");
    if(request.runGenesis&&(request.workspace||request.run))throw new StoreIntegrityError("run genesis must observe an existing workspace in a dedicated operation");
    if(request.workspace?.streamKind!==undefined&&request.workspace.streamKind!=="workspace")throw new StoreIntegrityError("workspace append kind mismatch");
    if(request.run?.streamKind!==undefined&&request.run.streamKind!=="run")throw new StoreIntegrityError("run append kind mismatch");
    const workspaceId=this.requestWorkspace(request);const scope=this.commandScope(request);const digest=domainDigest("horseness.store-append.v1",JSON.parse(canonicalJson(request as unknown as JsonValue)) as JsonValue);
    this.crash("transaction.begin.before");this.db.exec("BEGIN IMMEDIATE");this.crash("transaction.begin.after");
    try{
      const prior=this.db.prepare("SELECT request_digest,result_json FROM command_dedup WHERE workspace_id=? AND scope_kind=? AND scope_id=? AND command_id=?").get(workspaceId,scope.kind,scope.id,request.commandId) as {request_digest:string;result_json:string}|undefined;
      if(prior){if(prior.request_digest!==digest)throw new StoreConflictError("command id reused with different request");if(request.runGenesis&&this.db.prepare("SELECT 1 FROM streams WHERE workspace_id=? AND stream_kind='run' AND stream_id=?").get(workspaceId,scope.id)===undefined)throw new StoreConflictError("orphan run command dedup exists without run authority");const result=JSON.parse(prior.result_json) as AppendResult;this.db.exec("COMMIT");return{...result,deduplicated:true};}
      this.crash("transaction.write.before");const result:AppendResult={commandId:request.commandId,deduplicated:false};
      if(request.workspace)result.workspaceHead=this.writeAppend(request.workspace);
      if(request.run)result.runHead=this.writeAppend(request.run);
      if(request.runGenesis)result.runHead=this.writeRunGenesis(request.runGenesis);
      this.db.prepare("INSERT INTO command_dedup(workspace_id,scope_kind,scope_id,command_id,request_digest,result_json,created_at) VALUES(?,?,?,?,?,?,?)").run(workspaceId,scope.kind,scope.id,request.commandId,digest,canonicalJson(result as unknown as JsonValue),now());
      this.crash("transaction.write.after");this.crash("transaction.commit.before");this.db.exec("COMMIT");this.crash("transaction.commit.after");return result;
    }catch(error){if(this.db.isTransaction){this.crash("transaction.rollback.before");this.db.exec("ROLLBACK");this.crash("transaction.rollback.after");}throw error;}
  }
  private authenticatedRows(workspaceId:string,streamKind:EventStream,streamId:string):{raw:string;event:StoredEvent}[]{const head=this.db.prepare("SELECT head_sequence,head_hash FROM streams WHERE workspace_id=? AND stream_kind=? AND stream_id=?").get(workspaceId,streamKind,streamId) as {head_sequence:number;head_hash:string|null}|undefined;const rows=this.db.prepare("SELECT sequence,envelope_hash,prior_envelope_hash,envelope_json FROM events WHERE workspace_id=? AND stream_kind=? AND stream_id=? ORDER BY sequence").all(workspaceId,streamKind,streamId) as {sequence:number;envelope_hash:string;prior_envelope_hash:string|null;envelope_json:string}[];if(head===undefined){if(rows.length!==0)throw new StoreIntegrityError("events exist without stream head");return[];}try{const authenticated=rows.map(row=>{const event=JSON.parse(row.envelope_json) as StoredEvent;const envelope=event.envelope;if(envelope.workspaceId!==workspaceId||envelope.streamKind!==streamKind||envelope.streamId!==streamId||envelope.sequence!==row.sequence||event.envelopeHash!==row.envelope_hash||envelope.priorEnvelopeHash!==row.prior_envelope_hash)throw new StoreIntegrityError("event row does not match envelope");return{raw:row.envelope_json,event};});if(authenticated.length===0||authenticated[0]?.event.envelope.sequence!==1||authenticated[0].event.envelope.priorEnvelopeHash!==null)throw new StoreIntegrityError("invalid stream genesis");verifyEventChain(authenticated.map(item=>item.event));const last=authenticated.at(-1)?.event;if(last===undefined||head.head_sequence!==last.envelope.sequence||head.head_hash!==last.envelopeHash)throw new StoreIntegrityError("stored stream head mismatch");return authenticated;}catch(error){if(error instanceof StoreIntegrityError)throw error;throw new StoreIntegrityError(`event chain authentication failed: ${error instanceof Error?error.message:String(error)}`);}}
  replay(workspaceId:string,streamKind:EventStream,streamId:string,fromSequence=1):StoredEvent[]{if(!Number.isSafeInteger(fromSequence)||fromSequence<1)throw new StoreIntegrityError("invalid replay sequence");return this.authenticatedRows(workspaceId,streamKind,streamId).filter(item=>item.event.envelope.sequence>=fromSequence).map(item=>item.event);}
  replayRaw(workspaceId:string,streamKind:EventStream,streamId:string,fromSequence=1):readonly string[]{if(!Number.isSafeInteger(fromSequence)||fromSequence<1)throw new StoreIntegrityError("invalid replay sequence");return this.authenticatedRows(workspaceId,streamKind,streamId).filter(item=>item.event.envelope.sequence>=fromSequence).map(item=>item.raw);}
  latestSnapshot(workspaceId:string,streamKind:EventStream,streamId:string,projectionName:string,projectionVersion:string):SnapshotRecord|null{const row=this.db.prepare("SELECT sequence,envelope_hash,state_json FROM snapshots WHERE workspace_id=? AND stream_kind=? AND stream_id=? AND projection_name=? AND projection_version=? ORDER BY sequence DESC LIMIT 1").get(workspaceId,streamKind,streamId,projectionName,projectionVersion) as {sequence:number;envelope_hash:string;state_json:string}|undefined;return row?{workspaceId,streamKind,streamId,projectionName,projectionVersion,sequence:row.sequence,envelopeHash:row.envelope_hash,state:JSON.parse(row.state_json) as JsonValue}:null;}
  setProjectionMetadata(name:string,version:string,workspaceId:string,streamKind:EventStream,streamId:string,lastSequence:number,lastEnvelopeHash:string|null):void{this.db.prepare("INSERT INTO projection_metadata(projection_name,projection_version,workspace_id,stream_kind,stream_id,last_sequence,last_envelope_hash,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(projection_name,projection_version,workspace_id,stream_kind,stream_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_envelope_hash=excluded.last_envelope_hash,updated_at=excluded.updated_at").run(name,version,workspaceId,streamKind,streamId,lastSequence,lastEnvelopeHash,now());}
  publishAndAppendAtomic(request:PublishAndAppendRequest):AppendResult {
    const records=request.artifacts.map(publication=>({publication,record:this.artifacts.publish(publication.data,publication.mediaType??null)}));
    const available=new Set(records.map(item=>item.record.digest));
    const requiredArtifactDigests=request.requiredArtifactDigests??[];
    if(records.length>0&&requiredArtifactDigests.length===0)throw new StoreIntegrityError("authoritative artifact append requires artifact digests");
    if(records.length===0&&requiredArtifactDigests.length>0)throw new StoreIntegrityError(`required artifact was not published: ${requiredArtifactDigests[0]}`);
    for(const digest of requiredArtifactDigests)if(!available.has(digest))throw new StoreIntegrityError(`required artifact was not published: ${digest}`);
    if(!request.workspace&&!request.run)throw new StoreIntegrityError("atomic append has no streams");
    if(request.runGenesis)throw new StoreIntegrityError("run genesis cannot be combined with artifact publication");
    if(request.run?.expectedSequence===0)throw new StoreIntegrityError("run genesis requires the explicit runGenesis operation");
    if(request.workspace?.streamKind!==undefined&&request.workspace.streamKind!=="workspace")throw new StoreIntegrityError("workspace append kind mismatch");
    if(request.run?.streamKind!==undefined&&request.run.streamKind!=="run")throw new StoreIntegrityError("run append kind mismatch");
    const workspaceId=this.requestWorkspace(request);
    const scope=this.commandScope(request);
    for(const projection of request.projections??[])if(projection.workspaceId!==workspaceId)throw new StoreIntegrityError("projection workspace mismatch");
    for(const snapshot of request.snapshots??[])if(snapshot.workspaceId!==workspaceId)throw new StoreIntegrityError("snapshot workspace mismatch");
    const digestInput={commandId:request.commandId,workspace:request.workspace??null,run:request.run??null,artifacts:records.map(({publication,record})=>({record,references:publication.references??[],pins:publication.pins??[]})),requiredArtifactDigests,projections:request.projections??[],snapshots:request.snapshots??[]};
    const requestDigest=domainDigest("horseness.store-artifact-append.v1",JSON.parse(canonicalJson(digestInput as unknown as JsonValue)) as JsonValue);
    const insertedEventIds=new Set([...(request.workspace?.events??[]),...(request.run?.events??[])].map(event=>event.envelope.eventId));
    this.crash("transaction.begin.before");this.db.exec("BEGIN IMMEDIATE");this.crash("transaction.begin.after");
    try {
      const prior=this.db.prepare("SELECT request_digest,result_json FROM command_dedup WHERE workspace_id=? AND scope_kind=? AND scope_id=? AND command_id=?").get(workspaceId,scope.kind,scope.id,request.commandId) as {request_digest:string;result_json:string}|undefined;
      if(prior){if(prior.request_digest!==requestDigest)throw new StoreConflictError("command id reused with different request");this.db.exec("COMMIT");return{...(JSON.parse(prior.result_json) as AppendResult),deduplicated:true};}
      const verifiedExistingEventIds=new Set<string>();
      for(const {publication} of records)for(const reference of publication.references??[]){
        if(reference.ownerKind!=="event")throw new StoreIntegrityError(`unsupported artifact reference owner kind: ${reference.ownerKind}`);
        if(insertedEventIds.has(reference.ownerId))continue;
        if(reference.allowExistingEvent!==true)throw new StoreIntegrityError(`artifact reference owner is unrelated to this append: ${reference.ownerId}`);
        const owner=this.db.prepare("SELECT stream_kind,stream_id FROM events WHERE workspace_id=? AND event_id=?").get(workspaceId,reference.ownerId) as {stream_kind:EventStream;stream_id:string}|undefined;
        if(!owner)throw new StoreIntegrityError(`permitted existing artifact reference owner does not exist in workspace: ${reference.ownerId}`);
        if(!this.authenticatedRows(workspaceId,owner.stream_kind,owner.stream_id).some(row=>row.event.envelope.eventId===reference.ownerId))throw new StoreIntegrityError(`existing artifact reference owner is not authenticated: ${reference.ownerId}`);
        verifiedExistingEventIds.add(reference.ownerId);
      }
      for(const required of requiredArtifactDigests){
        const bound=records.some(({publication,record})=>record.digest===required&&(publication.references??[]).some(reference=>insertedEventIds.has(reference.ownerId)||verifiedExistingEventIds.has(reference.ownerId)));
        if(!bound)throw new StoreIntegrityError(`required artifact has no workspace event reference: ${required}`);
      }
      this.crash("transaction.write.before");
      const result:AppendResult={commandId:request.commandId,deduplicated:false};
      for(const {record} of records){this.artifacts.verifyRecord(record);this.artifacts.register(record);}
      if(request.workspace)result.workspaceHead=this.writeAppend(request.workspace);
      if(request.run)result.runHead=this.writeAppend(request.run);
      for(const {publication,record} of records){
        for(const reference of publication.references??[])this.artifacts.addReference(workspaceId,reference.ownerKind,reference.ownerId,record.digest);
        for(const pin of publication.pins??[])this.db.prepare("INSERT OR IGNORE INTO artifact_pins(pin_id,digest,created_at) VALUES(?,?,?)").run(pin.pinId,record.digest,now());
      }
      for(const required of requiredArtifactDigests){const record=records.find(item=>item.record.digest===required)?.record;if(!record)throw new StoreIntegrityError(`required artifact was not published: ${required}`);this.artifacts.verifyRecord(record);}
      for(const projection of request.projections??[]){const anchor=projection.lastSequence===0&&projection.lastEnvelopeHash===null?true:this.db.prepare("SELECT 1 FROM events WHERE workspace_id=? AND stream_kind=? AND stream_id=? AND sequence=? AND envelope_hash=?").get(projection.workspaceId,projection.streamKind,projection.streamId,projection.lastSequence,projection.lastEnvelopeHash)!==undefined;if(!anchor)throw new StoreIntegrityError(`projection is not anchored to an event: ${projection.name}`);this.db.prepare("INSERT INTO projection_metadata(projection_name,projection_version,workspace_id,stream_kind,stream_id,last_sequence,last_envelope_hash,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(projection_name,projection_version,workspace_id,stream_kind,stream_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_envelope_hash=excluded.last_envelope_hash,updated_at=excluded.updated_at").run(projection.name,projection.version,projection.workspaceId,projection.streamKind,projection.streamId,projection.lastSequence,projection.lastEnvelopeHash,now());}
      for(const snapshot of request.snapshots??[]){const anchor=this.db.prepare("SELECT 1 FROM events WHERE workspace_id=? AND stream_kind=? AND stream_id=? AND sequence=? AND envelope_hash=?").get(snapshot.workspaceId,snapshot.streamKind,snapshot.streamId,snapshot.sequence,snapshot.envelopeHash);if(anchor===undefined)throw new StoreIntegrityError(`snapshot is not anchored to an event: ${snapshot.projectionName}`);this.db.prepare("INSERT INTO snapshots(workspace_id,stream_kind,stream_id,sequence,envelope_hash,projection_name,projection_version,state_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(snapshot.workspaceId,snapshot.streamKind,snapshot.streamId,snapshot.sequence,snapshot.envelopeHash,snapshot.projectionName,snapshot.projectionVersion,canonicalJson(snapshot.state),now());}
      this.db.prepare("INSERT INTO command_dedup(workspace_id,scope_kind,scope_id,command_id,request_digest,result_json,created_at) VALUES(?,?,?,?,?,?,?)").run(workspaceId,scope.kind,scope.id,request.commandId,requestDigest,canonicalJson(result as unknown as JsonValue),now());
      this.crash("transaction.write.after");this.crash("transaction.commit.before");this.db.exec("COMMIT");this.crash("transaction.commit.after");return result;
    } catch(error){if(this.db.isTransaction){this.crash("transaction.rollback.before");this.db.exec("ROLLBACK");this.crash("transaction.rollback.after");}throw error;}
  }
}
