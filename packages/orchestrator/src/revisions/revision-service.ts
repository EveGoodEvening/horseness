import { deterministicReplay, type JsonValue } from "@horseness/domain";
import type { SQLiteAuthority } from "@horseness/store-sqlite";

export interface RevisionView { workspaceId:string;runId:string;revision:number;document:JsonValue;stateHash:string;lastEventSequence:number }
export function loadRevision(authority:SQLiteAuthority,workspaceId:string,runId:string):RevisionView {
  const replay=deterministicReplay(authority.replay(workspaceId,"run",runId));
  return {workspaceId,runId,revision:replay.canonical.revision,document:replay.canonical.document,stateHash:replay.canonical.stateHash,lastEventSequence:replay.canonical.lastCanonicalEventSequence};
}
