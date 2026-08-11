import assert from "node:assert/strict";
import test from "node:test";
import {
  DomainError,
  parseDomainCommandResultV1,
  parseDomainCommandV1,
  parseDomainEventPayloadV1,
  parseDomainQueryV1,
  parseObservationCursorV1,
  parseQueryResultV1,
  parseResultCursorV1,
} from "../src/index.js";

const absentWorkspace = { schemaVersion: "1", kind: "absent-workspace-genesis", workspaceId: "ws", expectedWorkspaceHead: "absent" } as const;
const workspace = { schemaVersion: "1", kind: "workspace-only", workspaceId: "ws", workspaceSequence: 1, workspaceEnvelopeHash: "wh", workspaceContextEpoch: 2 } as const;
const absentRun = { ...workspace, kind: "absent-run-genesis", runId: "run", expectedRunHead: "absent" } as const;
const run = { schemaVersion: "1", kind: "run-only", workspaceId: "ws", runId: "run", runSequence: 3, runEnvelopeHash: "rh", runContextEpoch: 4 } as const;
const composite = { ...workspace, kind: "composite", runId: "run", runSequence: 3, runEnvelopeHash: "rh", runContextEpoch: 4 } as const;
const clock = { schemaVersion: "1", authorityTime: "2026-01-01T00:00:00Z", observationCursor: composite } as const;
const contexts = {
  workspace: { schemaVersion: "1", kind: "workspace-only", workspaceContextEpoch: 2, observationCursor: workspace },
  run: { schemaVersion: "1", kind: "run-only", runContextEpoch: 4, observationCursor: run },
  composite: { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 2, runContextEpoch: 4, observationCursor: composite },
} as const;

function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof DomainError && error.code === expected;
}

test("all observation and result cursor variants are exact and closed", () => {
  for (const cursor of [absentWorkspace, workspace, absentRun, run, composite]) assert.equal(parseObservationCursorV1(cursor), cursor);
  for (const cursor of [workspace, run, composite]) assert.equal(parseResultCursorV1(cursor), cursor);
  assert.throws(() => parseObservationCursorV1({ ...workspace, schemaVersion: "2" }), code("CURSOR_VERSION_UNSUPPORTED"));
  assert.throws(() => parseObservationCursorV1({ ...workspace, kind: "future" }), code("CURSOR_KIND_UNSUPPORTED"));
  assert.throws(() => parseObservationCursorV1({ ...workspace, extra: true }), code("CURSOR_INVALID"));
  assert.throws(() => parseObservationCursorV1({ ...workspace, workspaceSequence: 0 }), code("CURSOR_INVALID"));
  assert.throws(() => parseResultCursorV1(absentRun), code("RESULT_CURSOR_INCOMPATIBLE"));
});

test("every DomainCommandV1 member parses and incompatible cursors fail closed", () => {
  const commands = [
    { schemaVersion: "1", commandType: "CreateWorkspaceV1", commandId: "c1", observationCursor: absentWorkspace, authorityPrincipalId: "authority", initialGrantDigest: "g", authorityConsumptionMarker: "m", activePolicyDigest: "p" },
    { schemaVersion: "1", commandType: "ChangePolicyReferenceV1", commandId: "c2", observationCursor: workspace, principalId: "principal", activePolicyDigest: "p2" },
    { schemaVersion: "1", commandType: "CreateRunV1", commandId: "c3", observationCursor: absentRun, principalId: "principal", initialDocument: { value: 1 } },
    { schemaVersion: "1", commandType: "SubmitProposalV1", commandId: "c4", observationCursor: composite, principalId: "principal", proposalId: "proposal", proposalDigest: "pd" },
    { schemaVersion: "1", commandType: "RecordAttemptReceiptV1", commandId: "c5", observationCursor: composite, principalId: "principal", receiptId: "receipt", receiptDigest: "rd", outcome: "succeeded" },
    { schemaVersion: "1", commandType: "AcceptDeltaV1", commandId: "c6", observationCursor: composite, principalId: "principal", proposalId: "proposal", proposalDigest: "pd", priorStateHash: "before", resultingStateHash: "after", resultingDocument: [1, 2] },
    { schemaVersion: "1", commandType: "ResolveTaskV1", commandId: "c7", observationCursor: composite, principalId: "principal", taskId: "task", resolution: "failed", evaluationClock: clock },
  ];
  for (const command of commands) assert.equal(parseDomainCommandV1(command), command);
  assert.throws(() => parseDomainCommandV1({ ...commands[0], schemaVersion: "2" }), code("COMMAND_VERSION_UNSUPPORTED"));
  assert.throws(() => parseDomainCommandV1({ ...commands[0], commandType: "FutureV1" }), code("COMMAND_TYPE_UNSUPPORTED"));
  assert.throws(() => parseDomainCommandV1({ ...commands[1], extra: 1 }), code("COMMAND_INVALID"));
  assert.throws(() => parseDomainCommandV1({ ...commands[3], observationCursor: run }), code("COMMAND_CURSOR_INCOMPATIBLE"));
});

test("every DomainEventPayloadV1 member parses and unknown or malformed payloads fail", () => {
  const events = [
    { eventType: "WorkspaceCreatedV1", workspaceId: "ws", authorityPrincipalId: "authority", initialGrantDigest: "g", authorityConsumptionMarker: "m", activePolicyDigest: "p" },
    { eventType: "PolicyReferenceChangedV1", workspaceId: "ws", activePolicyDigest: "p2" },
    { eventType: "RunCreatedV1", workspaceId: "ws", runId: "run", initialDocument: {}, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1" },
    { eventType: "ProposalSubmittedV1", workspaceId: "ws", runId: "run", proposalId: "proposal", proposalDigest: "pd" },
    { eventType: "AttemptReceiptRecordedV1", workspaceId: "ws", runId: "run", receiptId: "receipt", receiptDigest: "rd", outcome: "cancelled" },
    { eventType: "DeltaAcceptedV1", workspaceId: "ws", runId: "run", proposalId: "proposal", proposalDigest: "pd", priorStateHash: "before", resultingStateHash: "after", resultingDocument: { ok: true } },
    { eventType: "TaskResolvedV1", workspaceId: "ws", runId: "run", taskId: "task", resolution: "succeeded", evaluationClock: clock },
    { eventType: "ForkCreatedV1", workspaceId: "ws", runId: "run", forkPinDigest: "fd" },
    { eventType: "ContextManifestPublishedV1", workspaceId: "ws", runId: "run", contextManifestCoreDigest: "cd" },
  ];
  for (const event of events) assert.equal(parseDomainEventPayloadV1(event), event);
  assert.throws(() => parseDomainEventPayloadV1({ eventType: "FutureEventV2" }), code("UNSUPPORTED_EVENT_TYPE"));
  assert.throws(() => parseDomainEventPayloadV1({ ...events[0], extra: true }), code("EVENT_PAYLOAD_INVALID"));
  assert.throws(() => parseDomainEventPayloadV1({ ...events[2], hashVersion: "sha512-v2" }), code("EVENT_PAYLOAD_INVALID"));
});

test("all command result variants require matching result and context cursor variants", () => {
  const results = [
    { schemaVersion: "1", resultType: "WorkspaceCommandResultV1", commandId: "c1", resultCursor: workspace, resultContextVersion: contexts.workspace },
    { schemaVersion: "1", resultType: "RunCommandResultV1", commandId: "c2", resultCursor: run, resultContextVersion: contexts.run },
    { schemaVersion: "1", resultType: "RunCommandResultV1", commandId: "c3", resultCursor: composite, resultContextVersion: contexts.composite },
    { schemaVersion: "1", resultType: "DualStreamCommandResultV1", commandId: "c4", resultCursor: composite, resultContextVersion: contexts.composite },
  ];
  for (const result of results) assert.equal(parseDomainCommandResultV1(result), result);
  assert.throws(() => parseDomainCommandResultV1({ ...results[0], schemaVersion: "2" }), code("COMMAND_RESULT_VERSION_UNSUPPORTED"));
  assert.throws(() => parseDomainCommandResultV1({ ...results[0], resultType: "FutureResultV1" }), code("COMMAND_RESULT_TYPE_UNSUPPORTED"));
  assert.throws(() => parseDomainCommandResultV1({ ...results[0], resultCursor: run }), code("COMMAND_RESULT_CURSOR_INCOMPATIBLE"));
  assert.throws(() => parseDomainCommandResultV1({ ...results[1], resultContextVersion: contexts.composite }), code("COMMAND_RESULT_CURSOR_INCOMPATIBLE"));
});

test("all query and query-result members reject unknown shapes and cursor mismatches", () => {
  const queries = [
    { schemaVersion: "1", queryType: "GetWorkspaceV1", observationCursor: workspace },
    { schemaVersion: "1", queryType: "GetRunV1", observationCursor: composite },
    { schemaVersion: "1", queryType: "ListRunEventsV1", afterObservationCursor: run, limit: 10 },
    { schemaVersion: "1", queryType: "ListRunEventsV1", afterObservationCursor: composite, limit: 10 },
  ];
  const results = [
    { schemaVersion: "1", resultType: "WorkspaceQueryResultV1", observationCursor: workspace, state: { name: "workspace" } },
    { schemaVersion: "1", resultType: "RunQueryResultV1", observationCursor: run, state: null },
    { schemaVersion: "1", resultType: "RunQueryResultV1", observationCursor: composite, state: [] },
  ];
  for (const query of queries) assert.equal(parseDomainQueryV1(query), query);
  for (const result of results) assert.equal(parseQueryResultV1(result), result);
  assert.throws(() => parseDomainQueryV1({ ...queries[0], queryType: "FutureQueryV1" }), code("QUERY_TYPE_UNSUPPORTED"));
  assert.throws(() => parseDomainQueryV1({ ...queries[0], observationCursor: composite }), code("QUERY_CURSOR_INCOMPATIBLE"));
  assert.throws(() => parseDomainQueryV1({ ...queries[2], limit: 0 }), code("QUERY_INVALID"));
  assert.throws(() => parseQueryResultV1({ ...results[0], schemaVersion: "2" }), code("QUERY_RESULT_VERSION_UNSUPPORTED"));
  assert.throws(() => parseQueryResultV1({ ...results[0], resultType: "FutureResultV1" }), code("QUERY_RESULT_TYPE_UNSUPPORTED"));
  assert.throws(() => parseQueryResultV1({ ...results[0], observationCursor: composite }), code("QUERY_RESULT_CURSOR_INCOMPATIBLE"));
  assert.throws(() => parseQueryResultV1({ ...results[0], extra: true }), code("QUERY_RESULT_INVALID"));
});
