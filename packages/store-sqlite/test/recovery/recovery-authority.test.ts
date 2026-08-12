import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceGenesis, NO_POLICY_DIGEST } from "@horseness/domain";
import { SQLiteAuthority } from "../../src/sqlite-authority.js";
import { verifyAuthority } from "../../src/recovery/index.js";

function authorityWithEvent(root:string):SQLiteAuthority{
  const store=new SQLiteAuthority(join(root,"authority.sqlite"),join(root,"artifacts"));
  const genesis=createWorkspaceGenesis({workspaceId:"workspace-a",authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"marker",activePolicyDigest:NO_POLICY_DIGEST,commandId:"create-workspace"});
  store.appendAtomic({commandId:"create-workspace",workspace:{streamKind:"workspace",workspaceId:"workspace-a",streamId:"workspace-a",expectedSequence:0,expectedEnvelopeHash:null,events:[genesis.event]}});
  return store;
}

for(const [column,value] of [
  ["sequence",2],
  ["envelope_hash","f".repeat(64)],
  ["prior_envelope_hash","f".repeat(64)],
  ["event_id","transplanted-event"],
  ["idempotency_key","transplanted-key"],
  ["command_id","transplanted-command"],
] as const)test(`recovery rejects divergent SQL event column ${column}`,()=>{
  const root=mkdtempSync(join(tmpdir(),"horseness-recovery-columns-"));
  try{const store=authorityWithEvent(root);store.db.prepare(`UPDATE events SET ${column}=?`).run(value);assert.throws(()=>verifyAuthority(store.db,join(root,"artifacts")),/raw event-chain verification failed/);store.close();}finally{rmSync(root,{recursive:true,force:true});}
});

test("recovery rejects an envelope transplanted from another authenticated stream",()=>{
  const root=mkdtempSync(join(tmpdir(),"horseness-recovery-stream-"));
  try{
    const store=authorityWithEvent(root);
    const other=createWorkspaceGenesis({workspaceId:"workspace-b",authorityPrincipalId:"authority",initialGrantDigest:"grant",authorityConsumptionMarker:"marker",activePolicyDigest:NO_POLICY_DIGEST,commandId:"create-workspace-b"});
    store.appendAtomic({commandId:"create-workspace-b",workspace:{streamKind:"workspace",workspaceId:"workspace-b",streamId:"workspace-b",expectedSequence:0,expectedEnvelopeHash:null,events:[other.event]}});
    const row=store.db.prepare("SELECT envelope_json FROM events WHERE workspace_id='workspace-b'").get();assert(row&&typeof row==="object"&&"envelope_json" in row&&typeof row.envelope_json==="string");
    store.db.prepare("UPDATE events SET envelope_json=? WHERE workspace_id='workspace-a'").run(row.envelope_json);
    assert.throws(()=>verifyAuthority(store.db,join(root,"artifacts")),/raw event-chain verification failed: event stream identity mismatch/);store.close();
  }finally{rmSync(root,{recursive:true,force:true});}
});
