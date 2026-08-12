import { assertJsonValue, canonicalJson, domainDigest, DomainError, type JsonValue } from "./canonical.js";

export type Hash = string;
export interface AbsentWorkspaceGenesisCursorV1 { schemaVersion: "1"; kind: "absent-workspace-genesis"; workspaceId: string; expectedWorkspaceHead: "absent" }
export interface WorkspaceOnlyCursorV1 { schemaVersion: "1"; kind: "workspace-only"; workspaceId: string; workspaceSequence: number; workspaceEnvelopeHash: Hash; workspaceContextEpoch: number }
export interface AbsentRunGenesisCursorV1 extends Omit<WorkspaceOnlyCursorV1, "kind"> { kind: "absent-run-genesis"; runId: string; expectedRunHead: "absent" }
export interface RunOnlyCursorV1 { schemaVersion: "1"; kind: "run-only"; workspaceId: string; runId: string; runSequence: number; runEnvelopeHash: Hash; runContextEpoch: number }
export interface CompositeCursorV1 extends Omit<WorkspaceOnlyCursorV1, "kind"> { kind: "composite"; runId: string; runSequence: number; runEnvelopeHash: Hash; runContextEpoch: number }
export type ObservationCursorV1 = AbsentWorkspaceGenesisCursorV1 | WorkspaceOnlyCursorV1 | AbsentRunGenesisCursorV1 | RunOnlyCursorV1 | CompositeCursorV1;
export type ResultCursorV1 = WorkspaceOnlyCursorV1 | RunOnlyCursorV1 | CompositeCursorV1;
export type ContextVersionV1 =
  | { schemaVersion: "1"; kind: "workspace-only"; workspaceContextEpoch: number; observationCursor: WorkspaceOnlyCursorV1 }
  | { schemaVersion: "1"; kind: "run-only"; runContextEpoch: number; observationCursor: RunOnlyCursorV1 }
  | { schemaVersion: "1"; kind: "composite"; workspaceContextEpoch: number; runContextEpoch: number; observationCursor: CompositeCursorV1 };

export interface EvaluationClockV1 { schemaVersion: "1"; authorityTime: string; observationCursor: ObservationCursorV1 }
export interface CreateWorkspaceCommandV1 { schemaVersion: "1"; commandType: "CreateWorkspaceV1"; commandId: string; observationCursor: AbsentWorkspaceGenesisCursorV1; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string }
export interface ChangePolicyReferenceCommandV1 { schemaVersion: "1"; commandType: "ChangePolicyReferenceV1"; commandId: string; observationCursor: WorkspaceOnlyCursorV1; principalId: string; activePolicyDigest: string }
export type WorkspaceCommandV1 = CreateWorkspaceCommandV1 | ChangePolicyReferenceCommandV1;
export interface CreateRunCommandV1 { schemaVersion: "1"; commandType: "CreateRunV1"; commandId: string; observationCursor: AbsentRunGenesisCursorV1; principalId: string; initialDocument: JsonValue }
export interface SubmitProposalCommandV1 { schemaVersion: "1"; commandType: "SubmitProposalV1"; commandId: string; observationCursor: CompositeCursorV1; principalId: string; proposalId: string; proposalDigest: string }
export interface RecordAttemptReceiptCommandV1 { schemaVersion: "1"; commandType: "RecordAttemptReceiptV1"; commandId: string; observationCursor: CompositeCursorV1; principalId: string; receiptId: string; receiptDigest: string; outcome: "succeeded" | "failed" | "cancelled" }
export interface AcceptDeltaCommandV1 { schemaVersion: "1"; commandType: "AcceptDeltaV1"; commandId: string; observationCursor: CompositeCursorV1; principalId: string; proposalId: string; proposalDigest: string; priorStateHash: string; resultingStateHash: string; resultingDocument: JsonValue }
export interface ResolveTaskCommandV1 { schemaVersion: "1"; commandType: "ResolveTaskV1"; commandId: string; observationCursor: CompositeCursorV1; principalId: string; taskId: string; resolution: "succeeded" | "failed" | "cancelled"; evaluationClock: EvaluationClockV1 }
export type RunCommandV1 = CreateRunCommandV1 | SubmitProposalCommandV1 | RecordAttemptReceiptCommandV1 | AcceptDeltaCommandV1 | ResolveTaskCommandV1;
export type DomainCommandV1 = WorkspaceCommandV1 | RunCommandV1;
export interface GetWorkspaceQueryV1 { schemaVersion: "1"; queryType: "GetWorkspaceV1"; observationCursor: WorkspaceOnlyCursorV1 }
export interface GetRunQueryV1 { schemaVersion: "1"; queryType: "GetRunV1"; observationCursor: CompositeCursorV1 }
export interface ListRunEventsQueryV1 { schemaVersion: "1"; queryType: "ListRunEventsV1"; afterObservationCursor: RunOnlyCursorV1 | CompositeCursorV1; limit: number }
export type WorkspaceQueryV1 = GetWorkspaceQueryV1;
export type RunQueryV1 = GetRunQueryV1 | ListRunEventsQueryV1;
export type DomainQueryV1 = WorkspaceQueryV1 | RunQueryV1;
export interface WorkspaceCommandResultV1 { schemaVersion: "1"; resultType: "WorkspaceCommandResultV1"; commandId: string; resultCursor: WorkspaceOnlyCursorV1; resultContextVersion: ContextVersionV1 }
export interface RunCommandResultV1 { schemaVersion: "1"; resultType: "RunCommandResultV1"; commandId: string; resultCursor: RunOnlyCursorV1 | CompositeCursorV1; resultContextVersion: ContextVersionV1 }
export interface DualStreamCommandResultV1 { schemaVersion: "1"; resultType: "DualStreamCommandResultV1"; commandId: string; resultCursor: CompositeCursorV1; resultContextVersion: ContextVersionV1 }
export type DomainCommandResultV1 = WorkspaceCommandResultV1 | RunCommandResultV1 | DualStreamCommandResultV1;
export interface WorkspaceQueryResultV1 { schemaVersion: "1"; resultType: "WorkspaceQueryResultV1"; observationCursor: WorkspaceOnlyCursorV1; state: JsonValue }
export interface RunQueryResultV1 { schemaVersion: "1"; resultType: "RunQueryResultV1"; observationCursor: RunOnlyCursorV1 | CompositeCursorV1; state: JsonValue }
export type QueryResultV1 = WorkspaceQueryResultV1 | RunQueryResultV1;
export interface WorkspaceCreatedV1 { eventType: "WorkspaceCreatedV1"; workspaceId: string; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string }
export interface PolicyReferenceChangedV1 { eventType: "PolicyReferenceChangedV1"; workspaceId: string; activePolicyDigest: string }
export interface WorkspaceAdmissionRecordedV1 { eventType: "WorkspaceAdmissionRecordedV1"; workspaceId: string; proposalDigest: string; decisionEventId: string; state: AdmissionDecisionStateV1; quotaId: string; quotaDigest: string; consumed: "yes" | "no" }
export interface RunCreatedV1 { eventType: "RunCreatedV1"; workspaceId: string; runId: string; initialDocument: JsonValue; canonicalizerVersion: "jcs-v1"; hashVersion: "sha256-v1" }
export interface ProposalSubmittedV1 { eventType: "ProposalSubmittedV1"; workspaceId: string; runId: string; proposalId: string; proposalDigest: string }
export type AdmissionDecisionStateV1 = "accepted" | "rejected" | "conflicted" | "quarantined" | "approval_required";
export type AdmissionTransitionV1 = "evaluate" | "approve" | "reject" | "release" | "rebase";
export interface AdmissionDecisionRecordedV1 { eventType: "AdmissionDecisionRecordedV1"; workspaceId: string; runId: string; proposalId: string; proposalDigest: string; transition: AdmissionTransitionV1; state: AdmissionDecisionStateV1; provenanceDigest: string; artifactDigest: string; observationCursor: CompositeCursorV1 }
export interface AttemptReceiptRecordedV1 { eventType: "AttemptReceiptRecordedV1"; workspaceId: string; runId: string; receiptId: string; receiptDigest: string; outcome: "succeeded" | "failed" | "cancelled" }
export interface DeltaAcceptedV1 { eventType: "DeltaAcceptedV1"; workspaceId: string; runId: string; proposalId: string; proposalDigest: string; priorStateHash: string; resultingStateHash: string; resultingDocument: JsonValue }
export interface TaskResolvedEventV1 { eventType: "TaskResolvedV1"; workspaceId: string; runId: string; taskId: string; resolution: "succeeded" | "failed" | "cancelled"; evaluationClock: EvaluationClockV1 }
export interface ForkCreatedEventV1 { eventType: "ForkCreatedV1"; workspaceId: string; runId: string; forkPinDigest: string }
export interface ContextManifestPublishedEventV1 { eventType: "ContextManifestPublishedV1"; workspaceId: string; runId: string; contextManifestCoreDigest: string }
export type WorkspaceEventPayloadV1 = WorkspaceCreatedV1 | PolicyReferenceChangedV1 | WorkspaceAdmissionRecordedV1;
export type RunEventPayloadV1 = RunCreatedV1 | ProposalSubmittedV1 | AdmissionDecisionRecordedV1 | AttemptReceiptRecordedV1 | DeltaAcceptedV1 | TaskResolvedEventV1 | ForkCreatedEventV1 | ContextManifestPublishedEventV1;
export type DomainEventPayloadV1 = WorkspaceEventPayloadV1 | RunEventPayloadV1;
type ProtocolRecord = Record<string, unknown>;

function protocolError(code: string): never { throw new DomainError(code); }
function exactRecord(value: unknown, keys: readonly string[], code: string): ProtocolRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) protocolError(code);
  const record = value as ProtocolRecord;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) protocolError(code);
  return record;
}
function protocolRecord(value: unknown, code: string): ProtocolRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) protocolError(code);
  return value as ProtocolRecord;
}
function literal(value: unknown, expected: string, code: string): void { if (value !== expected) protocolError(code); }
function nonEmpty(value: unknown, code: string): void { if (typeof value !== "string" || value.length === 0) protocolError(code); }
function natural(value: unknown, code: string): void { if (!Number.isSafeInteger(value) || (value as number) < 0) protocolError(code); }
function positive(value: unknown, code: string): void { if (!Number.isSafeInteger(value) || (value as number) < 1) protocolError(code); }
function oneOf(value: unknown, choices: readonly string[], code: string): void { if (typeof value !== "string" || !choices.includes(value)) protocolError(code); }
function json(value: unknown, code: string): void { try { assertJsonValue(value); } catch { protocolError(code); } }

const workspaceCursorKeys = ["schemaVersion", "kind", "workspaceId", "workspaceSequence", "workspaceEnvelopeHash", "workspaceContextEpoch"] as const;
const runCursorKeys = ["schemaVersion", "kind", "workspaceId", "runId", "runSequence", "runEnvelopeHash", "runContextEpoch"] as const;
const compositeCursorKeys = [...workspaceCursorKeys, "runId", "runSequence", "runEnvelopeHash", "runContextEpoch"] as const;

export function parseObservationCursorV1(value: unknown): ObservationCursorV1 {
  const header = protocolRecord(value, "CURSOR_INVALID");
  literal(header.schemaVersion, "1", "CURSOR_VERSION_UNSUPPORTED");
  switch (header.kind) {
    case "absent-workspace-genesis": { const r = exactRecord(value, ["schemaVersion", "kind", "workspaceId", "expectedWorkspaceHead"], "CURSOR_INVALID"); nonEmpty(r.workspaceId, "CURSOR_INVALID"); literal(r.expectedWorkspaceHead, "absent", "CURSOR_INVALID"); break; }
    case "workspace-only": { const r = exactRecord(value, workspaceCursorKeys, "CURSOR_INVALID"); nonEmpty(r.workspaceId, "CURSOR_INVALID"); positive(r.workspaceSequence, "CURSOR_INVALID"); nonEmpty(r.workspaceEnvelopeHash, "CURSOR_INVALID"); natural(r.workspaceContextEpoch, "CURSOR_INVALID"); break; }
    case "absent-run-genesis": { const r = exactRecord(value, [...workspaceCursorKeys.filter((key) => key !== "kind"), "kind", "runId", "expectedRunHead"], "CURSOR_INVALID"); nonEmpty(r.workspaceId, "CURSOR_INVALID"); positive(r.workspaceSequence, "CURSOR_INVALID"); nonEmpty(r.workspaceEnvelopeHash, "CURSOR_INVALID"); natural(r.workspaceContextEpoch, "CURSOR_INVALID"); nonEmpty(r.runId, "CURSOR_INVALID"); literal(r.expectedRunHead, "absent", "CURSOR_INVALID"); break; }
    case "run-only": { const r = exactRecord(value, runCursorKeys, "CURSOR_INVALID"); nonEmpty(r.workspaceId, "CURSOR_INVALID"); nonEmpty(r.runId, "CURSOR_INVALID"); positive(r.runSequence, "CURSOR_INVALID"); nonEmpty(r.runEnvelopeHash, "CURSOR_INVALID"); natural(r.runContextEpoch, "CURSOR_INVALID"); break; }
    case "composite": { const r = exactRecord(value, compositeCursorKeys, "CURSOR_INVALID"); nonEmpty(r.workspaceId, "CURSOR_INVALID"); positive(r.workspaceSequence, "CURSOR_INVALID"); nonEmpty(r.workspaceEnvelopeHash, "CURSOR_INVALID"); natural(r.workspaceContextEpoch, "CURSOR_INVALID"); nonEmpty(r.runId, "CURSOR_INVALID"); positive(r.runSequence, "CURSOR_INVALID"); nonEmpty(r.runEnvelopeHash, "CURSOR_INVALID"); natural(r.runContextEpoch, "CURSOR_INVALID"); break; }
    default: protocolError("CURSOR_KIND_UNSUPPORTED");
  }
  return value as ObservationCursorV1;
}
export function assertObservationCursorV1(value: unknown): asserts value is ObservationCursorV1 { parseObservationCursorV1(value); }
export function parseResultCursorV1(value: unknown): ResultCursorV1 { const cursor = parseObservationCursorV1(value); if (cursor.kind === "absent-workspace-genesis" || cursor.kind === "absent-run-genesis") protocolError("RESULT_CURSOR_INCOMPATIBLE"); return cursor; }
export function assertResultCursorV1(value: unknown): asserts value is ResultCursorV1 { parseResultCursorV1(value); }

export function parseContextVersionV1(value: unknown): ContextVersionV1 {
  const header = protocolRecord(value, "CONTEXT_VERSION_INVALID"); literal(header.schemaVersion, "1", "CONTEXT_VERSION_UNSUPPORTED");
  const cursor = parseResultCursorV1(header.observationCursor);
  switch (header.kind) {
    case "workspace-only": { const r = exactRecord(value, ["schemaVersion", "kind", "workspaceContextEpoch", "observationCursor"], "CONTEXT_VERSION_INVALID"); natural(r.workspaceContextEpoch, "CONTEXT_VERSION_INVALID"); if (cursor.kind !== "workspace-only" || r.workspaceContextEpoch !== cursor.workspaceContextEpoch) protocolError("CONTEXT_CURSOR_INCOMPATIBLE"); break; }
    case "run-only": { const r = exactRecord(value, ["schemaVersion", "kind", "runContextEpoch", "observationCursor"], "CONTEXT_VERSION_INVALID"); natural(r.runContextEpoch, "CONTEXT_VERSION_INVALID"); if (cursor.kind !== "run-only" || r.runContextEpoch !== cursor.runContextEpoch) protocolError("CONTEXT_CURSOR_INCOMPATIBLE"); break; }
    case "composite": { const r = exactRecord(value, ["schemaVersion", "kind", "workspaceContextEpoch", "runContextEpoch", "observationCursor"], "CONTEXT_VERSION_INVALID"); natural(r.workspaceContextEpoch, "CONTEXT_VERSION_INVALID"); natural(r.runContextEpoch, "CONTEXT_VERSION_INVALID"); if (cursor.kind !== "composite" || r.workspaceContextEpoch !== cursor.workspaceContextEpoch || r.runContextEpoch !== cursor.runContextEpoch) protocolError("CONTEXT_CURSOR_INCOMPATIBLE"); break; }
    default: protocolError("CONTEXT_VERSION_KIND_UNSUPPORTED");
  }
  return value as ContextVersionV1;
}
export function assertContextVersionV1(value: unknown): asserts value is ContextVersionV1 { parseContextVersionV1(value); }

function commandBase(value: unknown, keys: readonly string[], cursorKind: ObservationCursorV1["kind"]): ProtocolRecord {
  const r = exactRecord(value, keys, "COMMAND_INVALID"); literal(r.schemaVersion, "1", "COMMAND_VERSION_UNSUPPORTED"); nonEmpty(r.commandId, "COMMAND_INVALID"); const cursor = parseObservationCursorV1(r.observationCursor); if (cursor.kind !== cursorKind) protocolError("COMMAND_CURSOR_INCOMPATIBLE"); return r;
}
export function parseDomainCommandV1(value: unknown): DomainCommandV1 {
  const h = protocolRecord(value, "COMMAND_INVALID"); if (h.schemaVersion !== "1") protocolError("COMMAND_VERSION_UNSUPPORTED");
  switch (h.commandType) {
    case "CreateWorkspaceV1": { const r = commandBase(value, ["schemaVersion","commandType","commandId","observationCursor","authorityPrincipalId","initialGrantDigest","authorityConsumptionMarker","activePolicyDigest"], "absent-workspace-genesis"); [r.authorityPrincipalId,r.initialGrantDigest,r.authorityConsumptionMarker,r.activePolicyDigest].forEach((x) => nonEmpty(x,"COMMAND_INVALID")); break; }
    case "ChangePolicyReferenceV1": { const r = commandBase(value, ["schemaVersion","commandType","commandId","observationCursor","principalId","activePolicyDigest"], "workspace-only"); nonEmpty(r.principalId,"COMMAND_INVALID"); nonEmpty(r.activePolicyDigest,"COMMAND_INVALID"); break; }
    case "CreateRunV1": { const r = commandBase(value, ["schemaVersion","commandType","commandId","observationCursor","principalId","initialDocument"], "absent-run-genesis"); nonEmpty(r.principalId,"COMMAND_INVALID"); json(r.initialDocument,"COMMAND_INVALID"); break; }
    case "SubmitProposalV1": { const r = commandBase(value, ["schemaVersion","commandType","commandId","observationCursor","principalId","proposalId","proposalDigest"], "composite"); [r.principalId,r.proposalId,r.proposalDigest].forEach((x) => nonEmpty(x,"COMMAND_INVALID")); break; }
    case "RecordAttemptReceiptV1": { const r = commandBase(value, ["schemaVersion","commandType","commandId","observationCursor","principalId","receiptId","receiptDigest","outcome"], "composite"); [r.principalId,r.receiptId,r.receiptDigest].forEach((x) => nonEmpty(x,"COMMAND_INVALID")); oneOf(r.outcome,["succeeded","failed","cancelled"],"COMMAND_INVALID"); break; }
    case "AcceptDeltaV1": { const r = commandBase(value, ["schemaVersion","commandType","commandId","observationCursor","principalId","proposalId","proposalDigest","priorStateHash","resultingStateHash","resultingDocument"], "composite"); [r.principalId,r.proposalId,r.proposalDigest,r.priorStateHash,r.resultingStateHash].forEach((x) => nonEmpty(x,"COMMAND_INVALID")); json(r.resultingDocument,"COMMAND_INVALID"); break; }
    case "ResolveTaskV1": { const r = commandBase(value, ["schemaVersion","commandType","commandId","observationCursor","principalId","taskId","resolution","evaluationClock"], "composite"); nonEmpty(r.principalId,"COMMAND_INVALID"); nonEmpty(r.taskId,"COMMAND_INVALID"); oneOf(r.resolution,["succeeded","failed","cancelled"],"COMMAND_INVALID"); const c = exactRecord(r.evaluationClock,["schemaVersion","authorityTime","observationCursor"],"COMMAND_INVALID"); literal(c.schemaVersion,"1","COMMAND_VERSION_UNSUPPORTED"); nonEmpty(c.authorityTime,"COMMAND_INVALID"); parseObservationCursorV1(c.observationCursor); break; }
    default: protocolError("COMMAND_TYPE_UNSUPPORTED");
  }
  return value as DomainCommandV1;
}
export function assertDomainCommandV1(value: unknown): asserts value is DomainCommandV1 { parseDomainCommandV1(value); }

export function parseDomainEventPayloadV1(value: unknown): DomainEventPayloadV1 {
  const h = protocolRecord(value, "EVENT_PAYLOAD_INVALID");
  const specs: Record<string, readonly string[]> = { WorkspaceCreatedV1:["eventType","workspaceId","authorityPrincipalId","initialGrantDigest","authorityConsumptionMarker","activePolicyDigest"], PolicyReferenceChangedV1:["eventType","workspaceId","activePolicyDigest"], WorkspaceAdmissionRecordedV1:["eventType","workspaceId","proposalDigest","decisionEventId","state","quotaId","quotaDigest","consumed"], RunCreatedV1:["eventType","workspaceId","runId","initialDocument","canonicalizerVersion","hashVersion"], ProposalSubmittedV1:["eventType","workspaceId","runId","proposalId","proposalDigest"], AdmissionDecisionRecordedV1:["eventType","workspaceId","runId","proposalId","proposalDigest","transition","state","provenanceDigest","artifactDigest","observationCursor"], AttemptReceiptRecordedV1:["eventType","workspaceId","runId","receiptId","receiptDigest","outcome"], DeltaAcceptedV1:["eventType","workspaceId","runId","proposalId","proposalDigest","priorStateHash","resultingStateHash","resultingDocument"], TaskResolvedV1:["eventType","workspaceId","runId","taskId","resolution","evaluationClock"], ForkCreatedV1:["eventType","workspaceId","runId","forkPinDigest"], ContextManifestPublishedV1:["eventType","workspaceId","runId","contextManifestCoreDigest"] };
  if (typeof h.eventType !== "string" || !(h.eventType in specs)) protocolError("UNSUPPORTED_EVENT_TYPE"); const r = exactRecord(value, specs[h.eventType]!, "EVENT_PAYLOAD_INVALID"); for (const key of specs[h.eventType]!) if (!["initialDocument","resultingDocument","evaluationClock","observationCursor","outcome","resolution","canonicalizerVersion","hashVersion","eventType"].includes(key)) nonEmpty(r[key],"EVENT_PAYLOAD_INVALID");
  if (h.eventType === "RunCreatedV1") { json(r.initialDocument,"EVENT_PAYLOAD_INVALID"); literal(r.canonicalizerVersion,"jcs-v1","EVENT_PAYLOAD_INVALID"); literal(r.hashVersion,"sha256-v1","EVENT_PAYLOAD_INVALID"); }
  if (h.eventType === "DeltaAcceptedV1") json(r.resultingDocument,"EVENT_PAYLOAD_INVALID");
  if (h.eventType === "AdmissionDecisionRecordedV1") { oneOf(r.transition,["evaluate","approve","reject","release","rebase"],"EVENT_PAYLOAD_INVALID"); oneOf(r.state,["accepted","rejected","conflicted","quarantined","approval_required"],"EVENT_PAYLOAD_INVALID"); if(parseObservationCursorV1(r.observationCursor).kind!=="composite") protocolError("EVENT_PAYLOAD_INVALID"); }
  if (h.eventType === "WorkspaceAdmissionRecordedV1") { oneOf(r.state,["accepted","rejected","conflicted","quarantined","approval_required"],"EVENT_PAYLOAD_INVALID"); oneOf(r.consumed,["yes","no"],"EVENT_PAYLOAD_INVALID"); }
  if (h.eventType === "AttemptReceiptRecordedV1") oneOf(r.outcome,["succeeded","failed","cancelled"],"EVENT_PAYLOAD_INVALID");
  if (h.eventType === "TaskResolvedV1") { oneOf(r.resolution,["succeeded","failed","cancelled"],"EVENT_PAYLOAD_INVALID"); const c=exactRecord(r.evaluationClock,["schemaVersion","authorityTime","observationCursor"],"EVENT_PAYLOAD_INVALID"); literal(c.schemaVersion,"1","EVENT_VERSION_UNSUPPORTED"); nonEmpty(c.authorityTime,"EVENT_PAYLOAD_INVALID"); parseObservationCursorV1(c.observationCursor); }
  return value as DomainEventPayloadV1;
}
export function assertDomainEventPayloadV1(value: unknown): asserts value is DomainEventPayloadV1 { parseDomainEventPayloadV1(value); }

export function parseDomainQueryV1(value: unknown): DomainQueryV1 { const h=protocolRecord(value,"QUERY_INVALID"); literal(h.schemaVersion,"1","QUERY_VERSION_UNSUPPORTED"); switch(h.queryType){ case "GetWorkspaceV1": {const r=exactRecord(value,["schemaVersion","queryType","observationCursor"],"QUERY_INVALID"); if(parseObservationCursorV1(r.observationCursor).kind!=="workspace-only") protocolError("QUERY_CURSOR_INCOMPATIBLE"); break;} case "GetRunV1": {const r=exactRecord(value,["schemaVersion","queryType","observationCursor"],"QUERY_INVALID"); if(parseObservationCursorV1(r.observationCursor).kind!=="composite") protocolError("QUERY_CURSOR_INCOMPATIBLE"); break;} case "ListRunEventsV1": {const r=exactRecord(value,["schemaVersion","queryType","afterObservationCursor","limit"],"QUERY_INVALID"); const c=parseObservationCursorV1(r.afterObservationCursor); if(c.kind!=="run-only"&&c.kind!=="composite") protocolError("QUERY_CURSOR_INCOMPATIBLE"); positive(r.limit,"QUERY_INVALID"); break;} default: protocolError("QUERY_TYPE_UNSUPPORTED"); } return value as DomainQueryV1; }
export function assertDomainQueryV1(value: unknown): asserts value is DomainQueryV1 { parseDomainQueryV1(value); }

export function parseDomainCommandResultV1(value: unknown): DomainCommandResultV1 { const h=protocolRecord(value,"COMMAND_RESULT_INVALID"); literal(h.schemaVersion,"1","COMMAND_RESULT_VERSION_UNSUPPORTED"); const r=exactRecord(value,["schemaVersion","resultType","commandId","resultCursor","resultContextVersion"],"COMMAND_RESULT_INVALID"); nonEmpty(r.commandId,"COMMAND_RESULT_INVALID"); const cursor=parseResultCursorV1(r.resultCursor); const context=parseContextVersionV1(r.resultContextVersion); switch(h.resultType){case "WorkspaceCommandResultV1": if(cursor.kind!=="workspace-only"||context.kind!=="workspace-only") protocolError("COMMAND_RESULT_CURSOR_INCOMPATIBLE"); break; case "RunCommandResultV1": if((cursor.kind!=="run-only"&&cursor.kind!=="composite")||context.kind!==cursor.kind) protocolError("COMMAND_RESULT_CURSOR_INCOMPATIBLE"); break; case "DualStreamCommandResultV1": if(cursor.kind!=="composite"||context.kind!=="composite") protocolError("COMMAND_RESULT_CURSOR_INCOMPATIBLE"); break; default: protocolError("COMMAND_RESULT_TYPE_UNSUPPORTED");} return value as DomainCommandResultV1; }
export function assertDomainCommandResultV1(value: unknown): asserts value is DomainCommandResultV1 { parseDomainCommandResultV1(value); }

export function parseQueryResultV1(value: unknown): QueryResultV1 { const h=protocolRecord(value,"QUERY_RESULT_INVALID"); literal(h.schemaVersion,"1","QUERY_RESULT_VERSION_UNSUPPORTED"); const r=exactRecord(value,["schemaVersion","resultType","observationCursor","state"],"QUERY_RESULT_INVALID"); const cursor=parseResultCursorV1(r.observationCursor); json(r.state,"QUERY_RESULT_INVALID"); switch(h.resultType){case "WorkspaceQueryResultV1": if(cursor.kind!=="workspace-only") protocolError("QUERY_RESULT_CURSOR_INCOMPATIBLE"); break; case "RunQueryResultV1": if(cursor.kind!=="run-only"&&cursor.kind!=="composite") protocolError("QUERY_RESULT_CURSOR_INCOMPATIBLE"); break; default: protocolError("QUERY_RESULT_TYPE_UNSUPPORTED");} return value as QueryResultV1; }
export function assertQueryResultV1(value: unknown): asserts value is QueryResultV1 { parseQueryResultV1(value); }
export interface StreamAppendV1<T extends DomainEventPayloadV1 = DomainEventPayloadV1> { streamKind: "workspace" | "run"; expectedSequence: number; expectedEnvelopeHash: Hash | null; events: readonly HashedEventEnvelopeV1<T>[] }
export type AtomicAppendContractV1 = { schemaVersion: "1"; appendKind: "single-stream"; observationCursor: ObservationCursorV1; append: StreamAppendV1 } | { schemaVersion: "1"; appendKind: "dual-stream"; observationCursor: CompositeCursorV1; workspaceAppend: StreamAppendV1<WorkspaceEventPayloadV1>; runAppend: StreamAppendV1<RunEventPayloadV1> };
export function assertAtomicAppendContract(contract: AtomicAppendContractV1): void {
  if (contract.schemaVersion !== "1") throw new DomainError("ATOMIC_APPEND_VERSION_UNSUPPORTED");
  const validate = (append: StreamAppendV1): void => { if (!Number.isSafeInteger(append.expectedSequence) || append.expectedSequence < 0 || append.events.some((item, index) => item.envelope.streamKind !== append.streamKind || item.envelope.sequence !== append.expectedSequence + index + 1)) throw new DomainError("ATOMIC_APPEND_INVALID"); };
  switch (contract.appendKind) { case "single-stream": validate(contract.append); return; case "dual-stream": if (contract.workspaceAppend.streamKind !== "workspace" || contract.runAppend.streamKind !== "run") throw new DomainError("ATOMIC_APPEND_INVALID"); validate(contract.workspaceAppend); validate(contract.runAppend); return; default: throw new DomainError("ATOMIC_APPEND_KIND_UNSUPPORTED"); }
}

export interface EventEnvelopeV1<T = JsonValue> {
  schemaVersion: "1";
  streamKind: "workspace" | "run";
  workspaceId: string;
  streamId: string;
  sequence: number;
  eventId: string;
  eventType: string;
  principalId: string;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  priorEnvelopeHash: Hash | null;
  payloadHash: Hash;
  payload: T;
}
export interface HashedEventEnvelopeV1<T = JsonValue> { envelope: EventEnvelopeV1<T>; envelopeHash: Hash }

export function sealEventEnvelope<T>(envelope: Omit<EventEnvelopeV1<T>, "payloadHash">): HashedEventEnvelopeV1<T> {
  const full: EventEnvelopeV1<T> = { ...envelope, payloadHash: domainDigest("horseness.event-payload.v1", envelope.payload) };
  return { envelope: full, envelopeHash: domainDigest("horseness.event-envelope.v1", full as unknown as JsonValue) };
}


export function createWorkspaceGenesis(input: { workspaceId: string; authorityPrincipalId: string; initialGrantDigest: string; authorityConsumptionMarker: string; activePolicyDigest: string; commandId: string }): { event: HashedEventEnvelopeV1<WorkspaceCreatedV1>; resultCursor: WorkspaceOnlyCursorV1 } {
  const payload: WorkspaceCreatedV1 = { eventType: "WorkspaceCreatedV1", workspaceId: input.workspaceId, authorityPrincipalId: input.authorityPrincipalId, initialGrantDigest: input.initialGrantDigest, authorityConsumptionMarker: input.authorityConsumptionMarker, activePolicyDigest: input.activePolicyDigest };
  const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "workspace", workspaceId: input.workspaceId, streamId: input.workspaceId, sequence: 1, eventId: `${input.commandId}:1`, eventType: payload.eventType, principalId: input.authorityPrincipalId, causationId: input.commandId, correlationId: input.commandId, idempotencyKey: input.commandId, priorEnvelopeHash: null, payload });
  return { event, resultCursor: { schemaVersion: "1", kind: "workspace-only", workspaceId: input.workspaceId, workspaceSequence: 1, workspaceEnvelopeHash: event.envelopeHash, workspaceContextEpoch: 0 } };
}

export function createRunGenesis(input: { observationCursor: AbsentRunGenesisCursorV1; initialDocument: JsonValue; principalId: string; commandId: string }): { event: HashedEventEnvelopeV1<RunCreatedV1>; resultCursor: CompositeCursorV1 } {
  const cursor = input.observationCursor;
  const payload: RunCreatedV1 = { eventType: "RunCreatedV1", workspaceId: cursor.workspaceId, runId: cursor.runId, initialDocument: input.initialDocument, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1" };
  const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "run", workspaceId: cursor.workspaceId, streamId: cursor.runId, sequence: 1, eventId: `${input.commandId}:1`, eventType: payload.eventType, principalId: input.principalId, causationId: input.commandId, correlationId: input.commandId, idempotencyKey: input.commandId, priorEnvelopeHash: null, payload });
  return { event, resultCursor: { schemaVersion: "1", kind: "composite", workspaceId: cursor.workspaceId, workspaceSequence: cursor.workspaceSequence, workspaceEnvelopeHash: cursor.workspaceEnvelopeHash, workspaceContextEpoch: cursor.workspaceContextEpoch, runId: cursor.runId, runSequence: 1, runEnvelopeHash: event.envelopeHash, runContextEpoch: 0 } };
}

function eventError(code: string): never { throw new DomainError(code); }

function assertNonEmpty(value: unknown, code: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) eventError(code);
}

export function verifyEventChain(events: readonly HashedEventEnvelopeV1<unknown>[]): void {
  if (events.length === 0) eventError("EVENT_CHAIN_EMPTY");
  const first = events[0];
  if (first === undefined) eventError("EVENT_CHAIN_EMPTY");
  const streamKind = first.envelope.streamKind;
  const workspaceId = first.envelope.workspaceId;
  const streamId = first.envelope.streamId;
  if (streamKind !== "workspace" && streamKind !== "run") eventError("EVENT_VERSION_UNSUPPORTED");
  if (first.envelope.schemaVersion !== "1") eventError("EVENT_VERSION_UNSUPPORTED");
  if (streamKind === "workspace" && streamId !== workspaceId) eventError("EVENT_IDENTITY_INVALID");
  let prior: string | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const item = events[index];
    if (item === undefined) eventError("EVENT_CHAIN_INVALID");
    const envelope = item.envelope;
    if (envelope.schemaVersion !== "1") eventError("EVENT_VERSION_UNSUPPORTED");
    if (envelope.streamKind !== streamKind || envelope.workspaceId !== workspaceId || envelope.streamId !== streamId) eventError("EVENT_IDENTITY_INVALID");
    if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence !== index + 1 || envelope.priorEnvelopeHash !== prior) eventError("EVENT_CHAIN_INVALID");
    assertNonEmpty(envelope.eventId, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.eventType, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.principalId, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.causationId, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.correlationId, "EVENT_ENVELOPE_INVALID");
    assertNonEmpty(envelope.idempotencyKey, "EVENT_ENVELOPE_INVALID");
    if (domainDigest("horseness.event-payload.v1", envelope.payload) !== envelope.payloadHash) eventError("EVENT_PAYLOAD_HASH_INVALID");
    if (domainDigest("horseness.event-envelope.v1", envelope as unknown as JsonValue) !== item.envelopeHash) eventError("EVENT_ENVELOPE_HASH_INVALID");
    let payload: DomainEventPayloadV1;
    try { payload = parseDomainEventPayloadV1(envelope.payload); } catch (error) { if (error instanceof DomainError && error.code === "UNSUPPORTED_EVENT_TYPE") throw error; eventError("MALFORMED_EVENT"); }
    if (payload.eventType !== envelope.eventType) eventError("EVENT_PAYLOAD_INVALID");
    prior = item.envelopeHash;
  }
  const genesisType = streamKind === "workspace" ? "WorkspaceCreatedV1" : "RunCreatedV1";
  if (first.envelope.eventType !== genesisType || first.envelope.priorEnvelopeHash !== null || first.envelope.sequence !== 1) eventError("INVALID_GENESIS");
}

export function eventCanonicalBytes(event: HashedEventEnvelopeV1): string { return canonicalJson(event as unknown as JsonValue); }
