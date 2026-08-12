import assert from "node:assert/strict";
import test from "node:test";
import { reduceCanonicalDocument, domainDigest } from "@horseness/domain";
test("only DeltaAccepted changes canonical revision",()=>{const initial=reduceCanonicalDocument(null,{eventType:"RunCreatedV1",sequence:1,workspaceId:"w",runId:"r",initialDocument:{a:1}});assert.equal(initial.revision,0);const document={a:2};const next=reduceCanonicalDocument(initial,{eventType:"DeltaAcceptedV1",sequence:4,workspaceId:"w",runId:"r",proposalId:"p",priorStateHash:initial.stateHash,resultingStateHash:domainDigest("horseness.canonical-document.v1",document),resultingDocument:document});assert.equal(next.revision,1);assert.deepEqual(next.document,document);});
