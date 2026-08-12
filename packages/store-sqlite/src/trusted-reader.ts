import type { CompositeCursorV1, JsonValue } from "@horseness/domain";
import type { SQLiteAuthority, SnapshotRecord, StoredEvent } from "./sqlite-authority.js";
import { StoreConflictError, StoreIntegrityError } from "./sqlite-authority.js";

const trustedReaders = new WeakSet<object>();
const readerIssuer = Object.freeze({});

export type TrustedSnapshotValidator = (snapshot: Readonly<SnapshotRecord>) => void;
export interface TrustedSnapshotReducerRegistrationV1 {
  readonly projectionName: string;
  readonly projectionVersion: string;
  readonly match: "exact" | "prefix";
  readonly validate: TrustedSnapshotValidator;
}

export interface AuthenticatedWorkspaceSessionV1 {
  readonly schemaVersion: "1";
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly snapshotReducers: readonly TrustedSnapshotReducerRegistrationV1[];
}

export interface AuthenticatedAuthorityViewV1 {
  readonly cursor: CompositeCursorV1;
  readonly workspaceEvents: readonly StoredEvent[];
  readonly runEvents: readonly StoredEvent[];
}

export class TrustedAuthorityReader {
  constructor(
    private readonly authority: SQLiteAuthority,
    private readonly session: AuthenticatedWorkspaceSessionV1,
    issuer: object,
  ) {
    if (issuer !== readerIssuer) throw new StoreIntegrityError("trusted authority reader issuer is not authenticated");
    trustedReaders.add(this);
  }

  authenticatedView(workspaceId: string, runId: string): AuthenticatedAuthorityViewV1 {
    requireReader(this);
    if (workspaceId !== this.session.workspaceId) throw new StoreIntegrityError("trusted authority reader workspace/session mismatch");
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
    const registration = this.session.snapshotReducers.find(candidate => candidate.projectionVersion === projectionVersion && (candidate.match === "exact" ? candidate.projectionName === projectionName : projectionName.startsWith(candidate.projectionName)));
    if (registration === undefined) throw new StoreIntegrityError(`trusted projection reducer is not registered: ${projectionName}@${projectionVersion}`);
    const copy = Object.freeze({ ...snapshot, state: structuredClone(snapshot.state) as JsonValue });
    registration.validate(copy);
    return copy;
  }
}

/** @internal Not exported from the package; only the authenticated authority open boundary calls this. */
export function issueTrustedAuthorityReader(authority: SQLiteAuthority, session: AuthenticatedWorkspaceSessionV1): TrustedAuthorityReader {
  return new TrustedAuthorityReader(authority, session, readerIssuer);
}

function requireReader(reader: TrustedAuthorityReader): void {
  if (!trustedReaders.has(reader)) throw new StoreIntegrityError("untrusted authority reader");
}
