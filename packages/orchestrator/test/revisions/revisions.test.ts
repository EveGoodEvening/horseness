import assert from "node:assert/strict";
import test from "node:test";
import { reduceCanonicalDocument, domainDigest } from "@horseness/domain";

test("genesis precedes the first acceptance and only DeltaAccepted changes canonical revision",()=>{
  assert.throws(()=>reduceCanonicalDocument(null,{eventType:"DeltaAcceptedV1",sequence:1,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:"missing",resultingStateHash:"missing",resultingDocument:{a:2}}),/EVENT_SEQUENCE_INVALID/);
  const initial=reduceCanonicalDocument(null,{eventType:"RunCreatedV1",sequence:1,workspaceId:"w",runId:"r",initialDocument:{a:1}});
  assert.equal(initial.revision,0);
  const document={a:2};
  const next=reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:4,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:domainDigest("horseness.canonical-document.v1",document),resultingDocument:document});
  assert.equal(next.revision,1);assert.deepEqual(next.document,document);
});

test("canonical replay binds sequence, aggregate identity, prior hash, and resulting document hash",()=>{
  const initial=reduceCanonicalDocument(null,{eventType:"RunCreatedV1",sequence:1,workspaceId:"w",runId:"r",initialDocument:{a:1}});
  const document={a:2}; const stateHash=domainDigest("horseness.canonical-document.v1",document);
  assert.throws(()=>reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:1,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:stateHash,resultingDocument:document}),/EVENT_SEQUENCE_INVALID/);
  assert.throws(()=>reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:2,workspaceId:"other",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:stateHash,resultingDocument:document}),/AGGREGATE_IDENTITY_MISMATCH/);
  assert.throws(()=>reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:2,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:"substituted",resultingStateHash:stateHash,resultingDocument:document}),/STALE_BASE/);
  assert.throws(()=>reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:2,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:"substituted",resultingDocument:document}),/STALE_BASE/);
});
