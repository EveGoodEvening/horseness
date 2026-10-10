import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CoordinatorClientV1, SdkError, type CoordinatorCallV1 } from "@horseness/sdk";
import type { CliInvocationV1 } from "../src/registry.js";
import { withCliWorkspaceV1, type CliWorkspaceV1 } from "../src/workspace.js";
import { runCliV1 } from "../src/runtime.js";
import { cliSuccessV1, renderCliHumanV1 } from "../src/result.js";

function fixture(root: string): { state: CliWorkspaceV1; invocation: CliInvocationV1; directory: string } {
  const directory = join(root, ".horseness");
  mkdirSync(directory, { mode: 0o700 });
  const workspaceId = "workspace:regression";
  const state: CliWorkspaceV1 = {
    schemaVersion: "1", workspacePath: root, workspaceId, principalId: "authority:regression",
    endpointPath: join(directory, "daemon.sock"), databasePath: join(directory, "authority.sqlite"), artifactRoot: join(directory, "artifacts"),
    daemonExecutable: "/usr/bin/false", grantReferenceFile: join(directory, "cli-grant-reference.v1"),
    workspaceCursor: { schemaVersion: "1", kind: "workspace-only", workspaceId, workspaceSequence: 1, workspaceEnvelopeHash: "genesis-hash", workspaceContextEpoch: 0 },
    currentRunId: null, runs: {}, pending: null,
  };
  writeFileSync(join(directory, "cli-workspace.v1.json"), JSON.stringify(state), { mode: 0o600 });
  writeFileSync(state.grantReferenceFile, "grant:regression\n", { mode: 0o600 });
  const invocation: CliInvocationV1 = { command: "status", args: [], options: { workspace: root }, outputMode: "json" };
  return { state, invocation, directory };
}

void test("workspace persistence keeps pending intent across sessions and excludes grant from metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-state-"));
  try {
    const { state, invocation, directory } = fixture(root);
    const absent = { ...state.workspaceCursor, kind: "absent-run-genesis" as const, runId: "run:one", expectedRunHead: "absent" as const };
    const call: CoordinatorCallV1<"run.create.v1"> = { method: "run.create.v1", workspaceId: state.workspaceId, runId: "run:one", observationCursor: absent, idempotencyKey: "operation:one", input: { schemaVersion: "1", commandType: "CreateRunV1", commandId: "operation:one", observationCursor: absent, principalId: state.principalId, initialDocument: { title: "Durable intent" } } };
    await withCliWorkspaceV1(invocation, (session) => {
      session.save({ ...session.state, pending: { command: "run create", title: "Durable intent", runId: "run:one", call } });
      assert.equal(session.state.pending?.title, "Durable intent");
      return Promise.resolve();
    });
    await withCliWorkspaceV1(invocation, (session) => { assert.equal(session.state.pending?.call.idempotencyKey, "operation:one"); return Promise.resolve(); });
    assert.doesNotMatch(readFileSync(join(directory, "cli-workspace.v1.json"), "utf8"), /grant:regression/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test("workspace rejects a symlinked state file without reading or overwriting its target", async () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-symlink-"));
  try {
    const { invocation, directory } = fixture(root);
    const stateFile = join(directory, "cli-workspace.v1.json");
    const target = join(root, "user-project-file");
    writeFileSync(target, "unchanged");
    rmSync(stateFile);
    symlinkSync(target, stateFile);
    await assert.rejects(withCliWorkspaceV1(invocation, () => Promise.reject(new Error("unexpected workspace access"))), { code: "WORKSPACE_STATE_INVALID" });
    assert.equal(readFileSync(target, "utf8"), "unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

void test("changed execution options cannot replay a saved mutation; definitive denial clears it", async () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-execution-pending-"));
  const original = Object.getOwnPropertyDescriptor(CoordinatorClientV1.prototype, "call");
  assert.ok(original);
  try {
    const { state, directory } = fixture(root);
    const runId = "run:one", taskId = "task:one";
    const cursor = { ...state.workspaceCursor, kind: "composite" as const, runId, runSequence: 1, runEnvelopeHash: "run-genesis", runContextEpoch: 0 };
    const options = { taskId, adapterId: "pi", model: "concrete", effort: "high", autoPlan: true, plannerAdapterId: "claude", plannerModel: "planner-concrete", plannerEffort: "medium" };
    const call = { method: "task.execute.v1", workspaceId: state.workspaceId, runId, taskId, observationCursor: cursor, idempotencyKey: "operation:retained", input: { operationId: "operation:retained", ...options } } as CoordinatorCallV1;
    const pending = { command: "task execute", title: taskId, runId, taskId, fingerprint: JSON.stringify({ runId, ...options }), call };
    const file = join(directory, "cli-workspace.v1.json");
    writeFileSync(file, JSON.stringify({ ...state, currentRunId: runId, runs: { [runId]: cursor }, pending }));
    let calls = 0;
    const received: CoordinatorCallV1[] = [];
    CoordinatorClientV1.prototype.call = (request) => { calls += 1; received.push(request); return Promise.reject(new SdkError("TRANSPORT_FAILURE", "AUTHORIZATION_DENIED: denied")); };
    const output: string[] = [];
    const dependencies = { transport: { request(): Promise<never> { return Promise.reject(new Error("unused")); } }, credential: { schemaVersion: "1" as const, kind: "host-reference" as const, reference: "grant:test", scope: { workspaceId: state.workspaceId, adapterId: "cli", purpose: "workspace" } }, stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };
    const argv = ["task", "execute", "--workspace", root, "--task", taskId, "--adapter", "pi", "--model", "concrete", "--effort", "high", "--auto-plan", "--planner", "claude", "--planner-model", "planner-concrete", "--json"];
    for (const [name, value] of [["--model", "different"], ["--adapter", "omp"], ["--planner", "codex"], ["--planner-model", "different"], ["--effort", "low"], ["--planner-effort", "high"]] as const) {
      const changed = [...argv]; if (changed.includes(name)) changed[changed.indexOf(name) + 1] = value; else changed.push(name, value);
      assert.equal(await runCliV1(changed, dependencies), 1, output.at(-1));
      assert.equal((JSON.parse(output.pop() ?? "") as { error: { code: string } }).error.code, "OPERATION_PENDING");
      assert.deepEqual((JSON.parse(readFileSync(file, "utf8")) as CliWorkspaceV1).pending, pending);
    }
    assert.equal(calls, 0);
    const manual = argv.filter((value) => value !== "--auto-plan");
    manual.splice(manual.indexOf("--planner"), 4);
    assert.equal(await runCliV1(manual, dependencies), 1);
    assert.equal((JSON.parse(output.pop() ?? "") as { error: { code: string } }).error.code, "OPERATION_PENDING");
    assert.equal(calls, 0);
    assert.equal(await runCliV1(["task", "show", "--workspace", root, "--task", taskId, "--json"], dependencies), 1);
    assert.equal((JSON.parse(output.pop() ?? "") as { error: { code: string } }).error.code, "AUTHORIZATION_DENIED");
    assert.equal(calls, 1);
    assert.deepEqual((JSON.parse(readFileSync(file, "utf8")) as CliWorkspaceV1).pending, pending);
    assert.equal(await runCliV1(argv, dependencies), 1);
    assert.equal((JSON.parse(output.pop() ?? "") as { error: { code: string } }).error.code, "AUTHORIZATION_DENIED");
    assert.equal(calls, 2);
    assert.deepEqual(received[1], call);
    assert.equal((JSON.parse(readFileSync(file, "utf8")) as CliWorkspaceV1).pending, null);
    const adoption = { command: "task adopt", title: taskId, runId, taskId, fingerprint: JSON.stringify({ runId, taskId, planDigest: "reviewed-plan" }), call: { ...call, method: "task.adoptPlan.v1", input: { operationId: "operation:retained", taskId, planDigest: "reviewed-plan" } } };
    writeFileSync(file, JSON.stringify({ ...state, currentRunId: runId, runs: { [runId]: cursor }, pending: adoption }));
    assert.equal(await runCliV1(["task", "adopt", "--workspace", root, "--task", taskId, "--plan", "different-plan", "--json"], dependencies), 1);
    assert.equal((JSON.parse(output.pop() ?? "") as { error: { code: string } }).error.code, "OPERATION_PENDING");
    assert.equal(calls, 2);
    assert.deepEqual((JSON.parse(readFileSync(file, "utf8")) as CliWorkspaceV1).pending, adoption);
    const upgrade = { command: "workspace enable-execution", title: "enable-execution", runId: "", fingerprint: "enable-execution:v1", call: { method: "grant.issue.v1", workspaceId: state.workspaceId, observationCursor: state.workspaceCursor, idempotencyKey: "operation:upgrade", input: { operationId: "operation:upgrade", principalId: state.principalId, principalRole: "authority", actions: ["task.execute.v1"], resourceScope: { workspaceId: state.workspaceId, peerIdentity: state.principalId }, expiresAt: "2099-01-01T00:00:00.000Z" } } };
    writeFileSync(file, JSON.stringify({ ...state, pending: upgrade }));
    assert.equal(await runCliV1(["workspace", "enable-execution", "--workspace", root, "--json"], dependencies), 1);
    assert.equal((JSON.parse(output.pop() ?? "") as { error: { code: string } }).error.code, "AUTHORIZATION_DENIED");
    assert.equal(readFileSync(state.grantReferenceFile, "utf8"), "grant:regression\n");
    assert.equal((JSON.parse(readFileSync(file, "utf8")) as CliWorkspaceV1).pending, null);
  } finally { Object.defineProperty(CoordinatorClientV1.prototype, "call", original); rmSync(root, { recursive: true, force: true }); }
});

void test("execution flags reject malformed and unrelated automatic planning before workspace access", async () => {
  const output: string[] = [];
  const dependencies = { transport: { request(): Promise<never> { return Promise.reject(new Error("unused")); } }, credential: { schemaVersion: "1" as const, kind: "host-reference" as const, reference: "grant:test", scope: { workspaceId: "workspace:test", adapterId: "cli", purpose: "workspace" } }, stdout(text: string) { output.push(text); }, stderr(text: string) { output.push(text); } };
  for (const args of [
    ["task", "dispatch", "--task", "task:one", "--adapter", "pi", "--auto-plan"],
    ["task", "execute", "--task", "task:one", "--adapter", "pi", "--auto-plan=false"],
    ["task", "execute", "--task", "task:one", "--adapter", "pi", "--planner", "claude"],
    ["task", "dispatch", "--task", "task:one", "--adapter", "other"],
    ["task", "dispatch", "--task", "task:one", "--adapter", "pi", "--effort"],
    ["task", "breakdown", "--task", "task:one", "--planner", "pi", "--effort", "HIGH"],
    ["task", "execute", "--task", "task:one", "--adapter", "pi", "--effort", ""],
    ["task", "execute", "--task", "task:one", "--adapter", "pi", "--planner-effort", "medium"],
    ["task", "execute", "--task", "task:one", "--adapter", "pi", "--auto-plan", "--planner-effort"],
    ["task", "execute", "--task", "task:one", "--adapter", "pi", "--auto-plan", "--planner-effort", "turbo"],
  ]) assert.equal(await runCliV1(args, dependencies), 2);
});

void test("omitted task effort recovers the same explicit medium pending operation", async () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-effort-default-"));
  const original = Object.getOwnPropertyDescriptor(CoordinatorClientV1.prototype, "call");
  assert.ok(original);
  try {
    const { state, directory } = fixture(root);
    const runId = "run:one", taskId = "task:one";
    const cursor = { ...state.workspaceCursor, kind: "composite" as const, runId, runSequence: 1, runEnvelopeHash: "run-genesis", runContextEpoch: 0 };
    const options = { taskId, adapterId: "pi", model: "", effort: "medium" };
    const call = { method: "task.dispatch.v1", workspaceId: state.workspaceId, runId, taskId, observationCursor: cursor, idempotencyKey: "retained", input: { operationId: "retained", ...options } } as CoordinatorCallV1;
    const pending = { command: "task dispatch", title: taskId, runId, taskId, fingerprint: JSON.stringify({ runId, ...options }), call };
    const file = join(directory, "cli-workspace.v1.json");
    writeFileSync(file, JSON.stringify({ ...state, currentRunId: runId, runs: { [runId]: cursor }, pending }));
    let calls = 0;
    CoordinatorClientV1.prototype.call = () => { calls++; return Promise.reject(new SdkError("TRANSPORT_FAILURE", "AUTHORIZATION_DENIED: denied")); };
    const output: string[] = [];
    const dependencies = { transport: { request(): Promise<never> { return Promise.reject(new Error("unused")); } }, credential: { schemaVersion: "1" as const, kind: "host-reference" as const, reference: "grant:test", scope: { workspaceId: state.workspaceId, adapterId: "cli", purpose: "workspace" } }, stdout: (text: string) => output.push(text), stderr: (text: string) => output.push(text) };
    const args = ["task", "dispatch", "--workspace", root, "--task", taskId, "--adapter", "pi", "--json"];
    assert.equal(await runCliV1([...args, "--effort", "none"], dependencies), 1);
    assert.equal((JSON.parse(output.pop() ?? "") as { error: { code: string } }).error.code, "OPERATION_PENDING");
    assert.equal(calls, 0);
    assert.deepEqual((JSON.parse(readFileSync(file, "utf8")) as CliWorkspaceV1).pending, pending);
    assert.equal(await runCliV1(args, dependencies), 1);
    assert.equal((JSON.parse(output.pop() ?? "") as { error: { code: string } }).error.code, "AUTHORIZATION_DENIED");
    assert.equal(calls, 1);
    assert.equal((JSON.parse(readFileSync(file, "utf8")) as CliWorkspaceV1).pending, null);
  } finally { Object.defineProperty(CoordinatorClientV1.prototype, "call", original); rmSync(root, { recursive: true, force: true }); }
});

void test("task detail exposes dependency, receipt, stopped workflow and unadopted plan state", () => {
  const rendered = renderCliHumanV1(cliSuccessV1("task show", { runId: "run:one", task: { taskId: "task:one", title: "Integration", lifecycle: "active", schedulability: "blocked", dependencies: ["task:dependency"], attempts: [{ attemptId: "attempt:one", generation: 1, adapterId: "pi", model: "concrete", state: "receipt-recorded", providerOperationId: "native:one", receiptDigest: "receipt-digest", outputDigest: "output-digest", failureCode: null }], workflow: { workflowId: "workflow:one", state: "stopped", reasonCode: "UNKNOWN_OUTCOME" }, plan: { planDigest: "plan-digest", sourceTaskId: "task:one", sourceContractDigest: "source-digest", tasks: [{ key: "child", title: "Child", instructions: "Do work", acceptanceCriteria: ["Reviewed"], dependsOn: [] }], adoptedTaskIds: [] }, output: "Actual published output" } }));
  for (const value of ["task:dependency", "receipt-digest", "output-digest", "UNKNOWN_OUTCOME", "plan-digest", "Do work", "Reviewed", "Actual published output"]) assert.ok(rendered.includes(value));
});

void test("replacement execution grant stays private and survives a new workspace session", async () => {
  const root = mkdtempSync(join(tmpdir(), "horseness-private-grant-"));
  try {
    const { state, invocation, directory } = fixture(root);
    await withCliWorkspaceV1(invocation, (session) => { session.replaceGrant("grant:replacement"); return Promise.resolve(); });
    assert.equal(readFileSync(state.grantReferenceFile, "utf8"), "grant:replacement");
    await withCliWorkspaceV1(invocation, (session) => { assert.equal(session.state.workspaceId, state.workspaceId); return Promise.resolve(); });
    assert.doesNotMatch(readFileSync(join(directory, "cli-workspace.v1.json"), "utf8"), /grant:replacement/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
