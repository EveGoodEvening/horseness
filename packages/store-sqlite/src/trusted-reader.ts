import type { CompositeCursorV1, JsonValue } from "@horseness/domain";
import type { SQLiteAuthority, SnapshotRecord, StoredEvent } from "./sqlite-authority.js";
import { StoreConflictError, StoreIntegrityError } from "./sqlite-authority.js";

const trustedReaders = new WeakSet<object>();

export interface AuthenticatedAuthorityViewV1 {
  readonly cursor: CompositeCursorV1;
  readonly workspaceEvents: readonly StoredEvent[];
  readonly runEvents: readonly StoredEvent[];
}

export class TrustedAuthorityReader {
  private constructor(private readonly authority: SQLiteAuthority) { trustedReaders.add(this); }

  static fromAuthenticatedAuthority(authority: SQLiteAuthority): TrustedAuthorityReader {
    return new TrustedAuthorityReader(authority);
  }

  authenticatedView(workspaceId: string, runId: string): AuthenticatedAuthorityViewV1 {
    requireReader(this);
    const workspaceEvents = this.authority.replay(workspaceId, "workspace", workspaceId);
    const runEvents = this.authority.replay(workspaceId, "run", runId);
    const workspaceHead = workspaceEvents.at(-1);
    const runHead = runEvents.at(-1);
    if (!workspaceHead || !runHead) throw new StoreIntegrityError("trusted authority requires existing workspace and run streams");
    return Object.freeze({
      cursor: Object.freeze({
        schemaVersion: "1", kind: "composite", workspaceId,
        workspaceSequence: workspaceHead.envelope.sequence,
        workspaceEnvelopeHash: workspaceHead.envelopeHash,
        workspaceContextEpoch: Math.max(0, workspaceHead.envelope.sequence - 1),
        runId,
        runSequence: runHead.envelope.sequence,
        runEnvelopeHash: runHead.envelopeHash,
        runContextEpoch: Math.max(0, runHead.envelope.sequence - 1),
      }),
      workspaceEvents: Object.freeze(workspaceEvents),
      runEvents: Object.freeze(runEvents),
    });
  }

  exactRunHeadSnapshot(workspaceId: string, runId: string, projectionName: string, projectionVersion = "1"): SnapshotRecord {
    const view = this.authenticatedView(workspaceId, runId);
    const snapshot = this.authority.latestSnapshot(workspaceId, "run", runId, projectionName, projectionVersion);
    if (!snapshot) throw new StoreIntegrityError(`trusted projection is missing: ${projectionName}`);
    if (snapshot.sequence !== view.cursor.runSequence || snapshot.envelopeHash !== view.cursor.runEnvelopeHash) throw new StoreConflictError(`trusted projection is stale: ${projectionName}`);
    return Object.freeze({ ...snapshot, state: structuredClone(snapshot.state) as JsonValue });
  }
}

function requireReader(reader: TrustedAuthorityReader): void {
  if (!trustedReaders.has(reader)) throw new StoreIntegrityError("untrusted authority reader");
}

export function trustedAuthorityReader(authority: SQLiteAuthority): TrustedAuthorityReader {
  return TrustedAuthorityReader.fromAuthenticatedAuthority(authority);
}
