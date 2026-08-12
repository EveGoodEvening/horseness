import { assertObservationCursorV1, type CompositeCursorV1, type JsonValue } from "@horseness/domain";
import type { SQLiteAuthority, SnapshotRecord, StoredEvent } from "./sqlite-authority.js";
import { StoreConflictError, StoreIntegrityError } from "./sqlite-authority.js";

const trustedReaders = new WeakSet<object>();
const readerIssuer = Object.freeze({});

export interface AuthenticatedWorkspaceSessionV1 {
  readonly schemaVersion: "1";
  readonly workspaceId: string;
  readonly sessionId: string;
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
    const copy = Object.freeze({ ...snapshot, state: structuredClone(snapshot.state) as JsonValue });
    validateKnownProjection(copy);
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

function objectState(snapshot: Readonly<SnapshotRecord>): Record<string, JsonValue> {
  if (snapshot.projectionVersion !== "1" || snapshot.state === null || typeof snapshot.state !== "object" || Array.isArray(snapshot.state)) throw new StoreIntegrityError(`invalid trusted projection state: ${snapshot.projectionName}@${snapshot.projectionVersion}`);
  return snapshot.state as Record<string, JsonValue>;
}

function stringField(state: Record<string, JsonValue>, name: string): string {
  const value = state[name];
  if (typeof value !== "string" || value.length === 0) throw new StoreIntegrityError(`invalid trusted projection field: ${name}`);
  return value;
}

function cursorField(state: Record<string, JsonValue>, name: string): void {
  try { assertObservationCursorV1(state[name]); } catch { throw new StoreIntegrityError(`invalid trusted projection cursor: ${name}`); }
}

/** Closed, versioned registry. Callers cannot install validators or turn validation into a no-op. */
function validateKnownProjection(snapshot: Readonly<SnapshotRecord>): void {
  const state = objectState(snapshot), name = snapshot.projectionName;
  if (name === "fork-source" || name === "fork-authorization") {
    if (state.schemaVersion !== "1") throw new StoreIntegrityError("invalid fork authority schema");
    stringField(state, "workspaceId"); stringField(state, "runId"); cursorField(state, "observationCursor");
    return;
  }
  if (["receipt-event", "receipt-authority", "receipt-retry-decision", "receipt-cancellation"].includes(name)) {
    if (name !== "receipt-authority") { const sequence = state.eventSequence; if (!Number.isSafeInteger(sequence) || (sequence as number) < 1) throw new StoreIntegrityError("invalid receipt projection sequence"); }
    return;
  }
  if (name.startsWith("durable-authority-event/")) {
    if (state.envelope === null || typeof state.envelope !== "object" || state.resultCursor === null || typeof state.resultCursor !== "object") throw new StoreIntegrityError("invalid durable authority projection");
    cursorField(state, "resultCursor"); stringField(state, "envelopeHash"); return;
  }
  if (name.startsWith("task-resolution/")) {
    stringField(state, "workspaceId"); stringField(state, "runId"); stringField(state, "taskId"); stringField(state, "eventDigest");
    if (!Number.isSafeInteger(state.eventSequence) || (state.eventSequence as number) < 1) throw new StoreIntegrityError("invalid task resolution sequence"); return;
  }
  if (name.startsWith("task-authority/")) {
    stringField(state, "taskId"); stringField(state, "kind"); return;
  }
  throw new StoreIntegrityError(`trusted projection family is not registered: ${name}@${snapshot.projectionVersion}`);
}
