import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAuthenticatedContextV1, methodDefinition, type AuthenticatedContextV1, type JsonRpcRequestV1, type JsonRpcResponseV1, type ProtocolMethodV1 } from "@horseness/protocol";
import { Daemon } from "../src/index.js";

interface WorkspaceCursorV1 {
  readonly schemaVersion: "1";
  readonly kind: "workspace-only";
  readonly workspaceId: string;
  readonly workspaceSequence: number;
  readonly workspaceEnvelopeHash: string;
  readonly workspaceContextEpoch: number;
}
const authorityTime = (): string => "2026-08-12T00:00:00.000Z";

function fixture(): { daemon: Daemon; context: AuthenticatedContextV1 } {
  const root = mkdtempSync(join(tmpdir(), "horseness-daemon-server-"));
  const daemon = new Daemon({ workspacePath: root, databasePath: join(root, "authority.sqlite"), artifactRoot: join(root, "artifacts"), transport: { kind: "stdio" }, authorityTime }, { identity: () => "owner" });
  const capability = daemon.createBootstrapCapability("principal:owner");
  const bootstrap = daemon.consumeBootstrapCapability(capability.secret);
  const grant = daemon.grants.activeByDigest(bootstrap.grantDigest);
  assert.notEqual(grant, null);
  const context = createAuthenticatedContextV1(
    { transport: "stdio", localOnly: true, peerVerified: true, peerIdentity: "owner", processInherited: true },
    grant!,
    authorityTime(),
  );
  return { daemon, context };
}

function workspaceCursor(daemon: Daemon): WorkspaceCursorV1 {
  const head = daemon.authority.replay(daemon.config.workspaceId, "workspace", daemon.config.workspaceId).at(-1);
  assert.notEqual(head, undefined);
  return { schemaVersion: "1", kind: "workspace-only", workspaceId: daemon.config.workspaceId, workspaceSequence: head!.envelope.sequence, workspaceEnvelopeHash: head!.envelopeHash, workspaceContextEpoch: Math.max(0, head!.envelope.sequence - 1) };
}

function request(method: ProtocolMethodV1, cursor: WorkspaceCursorV1, value: Readonly<Record<string, unknown>>): JsonRpcRequestV1 {
  return {
    jsonrpc: "2.0",
    id: method,
    method,
    params: {
      protocolVersion: "1",
      observationCursor: cursor,
      body: { schemaVersion: "1", workspaceId: cursor.workspaceId, input: { schemaVersion: "1", requestType: method, value } } as never,
    },
  };
}

function sdkCompatibleValue(response: JsonRpcResponseV1, method: ProtocolMethodV1): unknown {
  assert.ok("result" in response);
  assert.equal(response.result.method, method);
  const definition = methodDefinition(method);
  assert.notEqual(definition, undefined);
  return definition!.parseResult(response.result.data).value;
}

test("dispatch envelopes domain and local DTO handler values for protocol and SDK parsing", async () => {
  const { daemon, context } = fixture();
  try {
    const cursor = workspaceCursor(daemon);
    const workspaceResponse = await daemon.server.dispatch(context, request("workspace.get.v1", cursor, { schemaVersion: "1", queryType: "GetWorkspaceV1", observationCursor: cursor }));
    const workspace = sdkCompatibleValue(workspaceResponse, "workspace.get.v1") as { resultType: string; state: unknown };
    assert.equal(workspace.resultType, "WorkspaceQueryResultV1");
    assert.ok(workspace.state);

    const listResponse = await daemon.server.dispatch(context, request("grant.list.v1", cursor, { operationId: "list-grants", principalId: "principal:owner", includeRevoked: false, limit: 10 }));
    const list = sdkCompatibleValue(listResponse, "grant.list.v1") as { outcomeId: string; grants: unknown[] };
    assert.equal(list.outcomeId, "list-grants");
    assert.ok(list.grants.length > 0);
  } finally {
    daemon.close();
  }
});

test("dispatch fails closed when a registered handler returns a malformed raw result", async () => {
  const { daemon, context } = fixture();
  try {
    const cursor = workspaceCursor(daemon);
    daemon.server.register("grant.list.v1", () => ({ data: { outcomeId: "missing-required-fields" } }));
    const response = await daemon.server.dispatch(context, request("grant.list.v1", cursor, { operationId: "list-grants", principalId: "principal:owner", includeRevoked: false, limit: 10 }));
    assert.ok("error" in response);
    assert.equal(response.error.data.reasonCode, "INVALID_PARAMS");
  } finally {
    daemon.close();
  }
});
