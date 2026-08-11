import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createRunGenesis, createWorkspaceGenesis, NO_POLICY_DIGEST } from "@horseness/domain";
import { SQLiteAuthority, StoreConflictError, StoreIntegrityError } from "../src/index.js";

const temporary=()=>mkdtempSync(join(tmpdir(),"horseness-store-"));
type SQLiteRow = Record<string, unknown>;

function isSQLiteRow(value: unknown): value is SQLiteRow {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rowValue(row: unknown, key: "journal_mode"): string;
function rowValue(row: unknown, key: "count"): number;
function rowValue(row: unknown, key: "journal_mode" | "count"): string | number {
  assert(isSQLiteRow(row), "node:sqlite must return a row record");
  const value = row[key];
  if (key === "journal_mode") {
    assert(typeof value === "string", "journal_mode must be a string");
    return value;
  }
  assert(typeof value === "number", "count must be a number");
  return value;
}

function genesis(workspaceId:string,runId="run",commandId="atomic-command") {
  const ws=createWorkspaceGenesis({workspaceId,authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"marker",activePolicyDigest:NO_POLICY_DIGEST,commandId:"workspace-command"});
  const run=createRunGenesis({observationCursor:{...ws.resultCursor,kind:"absent-run-genesis",runId,expectedRunHead:"absent"},initialDocument:{items:[]},principalId:"authority",commandId:"run-command"});
  return {commandId,workspace:{streamKind:"workspace" as const,workspaceId,streamId:workspaceId,expectedSequence:0,expectedEnvelopeHash:null,events:[ws.event]},run:{streamKind:"run" as const,workspaceId,streamId:runId,expectedSequence:0,expectedEnvelopeHash:null,events:[run.event]}};
}

test("migration 0001 is transactional, idempotent, and creates its complete authority ledger",()=>{const root=temporary();try{const path=join(root,"db.sqlite");const store=new SQLiteAuthority(path,join(root,"artifacts"));assert.deepEqual(store.migrationVersions(),[1]);store.close();const reopened=new SQLiteAuthority(path,join(root,"artifacts"));assert.deepEqual(reopened.migrationVersions(),[1]);const tables=(reopened.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(r=>r.name);for(const table of ["artifact_pins","artifact_refs","artifacts","command_dedup","events","projection_metadata","schema_migrations","snapshots","streams"])assert(tables.includes(table));const streamPk=reopened.db.prepare("PRAGMA table_info(streams)").all() as {name:string;pk:number}[];assert.deepEqual(streamPk.filter(column=>column.pk>0).sort((a,b)=>a.pk-b.pk).map(column=>column.name),["workspace_id","stream_kind","stream_id"]);reopened.close();const failedPath=join(root,"failed.sqlite");const failed=new DatabaseSync(failedPath);failed.exec("CREATE TABLE streams(unrelated TEXT)");assert.throws(()=>new SQLiteAuthority(failedPath,join(root,"failed-artifacts")));assert.equal(failed.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get(),undefined);assert.equal(failed.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artifacts'").get(),undefined);failed.close();}finally{rmSync(root,{recursive:true,force:true});}});

test("unsupported newer schema is rejected before mutable PRAGMAs",()=>{const root=temporary();try{const path=join(root,"future.sqlite");const db=new DatabaseSync(path);db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(2,'future','now')");assert.equal(rowValue(db.prepare("PRAGMA journal_mode").get(),"journal_mode"),"delete");db.close();assert.throws(()=>new SQLiteAuthority(path,join(root,"artifacts")),/unsupported newer schema version 2/);const inspect=new DatabaseSync(path);assert.equal(rowValue(inspect.prepare("PRAGMA journal_mode").get(),"journal_mode"),"delete");assert.equal(rowValue(inspect.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get(),"count"),1);inspect.close();}finally{rmSync(root,{recursive:true,force:true});}});

test("deduplication is workspace-scoped and conflicting retries reject",()=>{const root=temporary();try{const store=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"));const first=genesis("ws-a","same-run","same-command");const original=store.appendAtomic(first);assert.equal(original.deduplicated,false);assert.deepEqual(store.appendAtomic(first),{...original,deduplicated:true});const {run: _run,...withoutRun}=first;assert.throws(()=>store.appendAtomic(withoutRun),StoreConflictError);const second=genesis("ws-b","same-run","same-command");assert.equal(store.appendAtomic(second).deduplicated,false);assert.equal(store.replay("ws-a","run","same-run").length,1);assert.equal(store.replay("ws-b","run","same-run").length,1);assert.notEqual(store.replay("ws-a","run","same-run")[0]?.envelope.workspaceId,store.replay("ws-b","run","same-run")[0]?.envelope.workspaceId);store.close();}finally{rmSync(root,{recursive:true,force:true});}});

test("replay and raw partial replay authenticate JSON, sequence, prior hash, envelope hash, and stored head",()=>{const corruptions=[
  ["invalid JSON","UPDATE events SET envelope_json='{' WHERE workspace_id='ws' AND stream_kind='run'"],
  ["sequence","UPDATE events SET sequence=2 WHERE workspace_id='ws' AND stream_kind='run'"],
  ["prior hash","UPDATE events SET prior_envelope_hash='bad' WHERE workspace_id='ws' AND stream_kind='run'"],
  ["envelope hash","UPDATE events SET envelope_hash='bad' WHERE workspace_id='ws' AND stream_kind='run'"],
  ["stored head","UPDATE streams SET head_hash='bad' WHERE workspace_id='ws' AND stream_kind='run'"],
] as const;for(const [name,sql] of corruptions){const root=temporary();try{const store=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"));store.appendAtomic(genesis("ws"));store.db.exec("PRAGMA foreign_keys=OFF");store.db.exec(sql);assert.throws(()=>store.replay("ws","run","run"),StoreIntegrityError,name);assert.throws(()=>store.replayRaw("ws","run","run",2),StoreIntegrityError,`${name} raw partial`);store.close();}finally{rmSync(root,{recursive:true,force:true});}}});

test("snapshots cannot cross workspace identity",()=>{const root=temporary();try{const store=new SQLiteAuthority(join(root,"db.sqlite"),join(root,"artifacts"));store.appendAtomic(genesis("ws-a","same-run","a"));store.appendAtomic(genesis("ws-b","same-run","b"));const event=store.replay("ws-a","run","same-run")[0];assert(event);store.putSnapshot({workspaceId:"ws-a",streamKind:"run",streamId:"same-run",sequence:1,envelopeHash:event.envelopeHash,projectionName:"run",projectionVersion:"1",state:{workspace:"a"}});assert.equal(store.latestSnapshot("ws-b","run","same-run","run","1"),null);assert.deepEqual(store.latestSnapshot("ws-a","run","same-run","run","1")?.state,{workspace:"a"});assert.throws(()=>store.putSnapshot({workspaceId:"ws-b",streamKind:"run",streamId:"same-run",sequence:1,envelopeHash:event.envelopeHash,projectionName:"run",projectionVersion:"1",state:null}),StoreIntegrityError);store.close();}finally{rmSync(root,{recursive:true,force:true});}});
