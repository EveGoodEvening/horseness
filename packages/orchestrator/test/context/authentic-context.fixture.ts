import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, createRunGenesis, createWorkspaceGenesis, domainDigest, sealForkPin, type ContextVersionV1, type JsonValue } from "@horseness/domain";
import { SQLiteAuthority, createOrLoadAuthorityCredential } from "@horseness/store-sqlite";
import { authenticateContextSnapshot, contextSourceDigest, reconstructPinnedContext } from "../../src/context/index.js";

export function authenticContextFixture(attemptId = "a", generation = 1) {
  const root=mkdtempSync(join(tmpdir(),"horseness-attempt-context-")),database=join(root,"db.sqlite"),artifactRoot=join(root,"artifacts"),bootstrap=SQLiteAuthority.open(database,artifactRoot);
  const workspace=createWorkspaceGenesis({workspaceId:"w",authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"marker",activePolicyDigest:"policy",commandId:"workspace"});
  bootstrap.appendAtomic({commandId:"workspace",workspace:{streamKind:"workspace",workspaceId:"w",streamId:"w",expectedSequence:0,expectedEnvelopeHash:null,events:[workspace.event]}});
  const absent={schemaVersion:"1" as const,kind:"absent-run-genesis" as const,workspaceId:"w",workspaceSequence:1,workspaceEnvelopeHash:workspace.event.envelopeHash,workspaceContextEpoch:0,runId:"r",expectedRunHead:"absent" as const};
  const run=createRunGenesis({observationCursor:absent,initialDocument:{objective:"ship"},principalId:"authority",commandId:"run"});
  bootstrap.appendAtomic({commandId:"run",runGenesis:{observationCursor:absent,event:run.event}});
  const cursor=run.resultCursor,version:ContextVersionV1={schemaVersion:"1",kind:"composite",workspaceContextEpoch:0,runContextEpoch:0,observationCursor:cursor};
  const pin=sealForkPin({schemaVersion:"1",forkId:"fork",pinVersion:1,workspaceId:"w",runId:"r",parentForkPinDigest:null,refreshesForkPinDigest:null,canonicalRevision:0,canonicalStateHash:domainDigest("horseness.canonical-document.v1",{objective:"ship"}),canonicalizerVersion:"jcs-v1",hashVersion:"sha256-v1",sourceObservationCursor:cursor,sourceContextVersion:version,dependencyJoinSnapshotDigest:"join",deltaAuthorityScopeDigest:"scope",pinnedPolicyDigest:"policy",ancestry:[],createdByPrincipalId:"authority",createdByGrantDigest:"grant"});
  const artifact=bootstrap.artifacts.publish("trusted");bootstrap.artifacts.register(artifact);bootstrap.artifacts.addReference("w","event",run.event.envelope.eventId,artifact.digest);
  const insert=bootstrap.db.prepare("INSERT INTO snapshots(workspace_id,stream_kind,stream_id,sequence,envelope_hash,projection_name,projection_version,state_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)"),createdAt=new Date().toISOString();
  insert.run("w","run","r",1,run.event.envelopeHash,"context-sources","1",canonicalJson({schemaVersion:"1",workspaceId:"w",runId:"r",observationCursor:cursor,contextVersion:version,forkPinDigest:pin.forkPinDigest,sources:[{sourceId:"trusted",kind:"system",priority:1,digest:contextSourceDigest("trusted"),activationEpoch:0,deactivationEpoch:null,artifactDigest:artifact.digest,eventId:run.event.envelope.eventId}]} as unknown as JsonValue),createdAt);
  insert.run("w","run","r",1,run.event.envelopeHash,"context-authorization","1",canonicalJson({schemaVersion:"1",workspaceId:"w",runId:"r",observationCursor:cursor,contextVersion:version,policyDigest:"policy",grantDigest:"grant",quotaDigest:"quota",grantRevoked:false,quotaAvailable:true} as unknown as JsonValue),createdAt);bootstrap.close();
  const opened=SQLiteAuthority.openAuthenticatedWorkspace(database,artifactRoot,{workspaceId:"w",sessionId:`attempt-${root}`,credential:createOrLoadAuthorityCredential(database,artifactRoot,"w")});
  const context=reconstructPinnedContext({snapshot:authenticateContextSnapshot(opened.reader,{pin}),attemptId,generation,byteBudget:100,rendererVersion:"renderer-v1",providerIdempotencyKey:"key",allowedProducerPrincipalId:"worker",allowedProducerGrantDigest:"wg"});
  return {context,pin,close(){opened.authority.close();rmSync(root,{recursive:true,force:true});}};
}
