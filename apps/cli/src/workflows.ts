import { randomUUID } from "node:crypto";
import type { CoordinatorCallV1, CoordinatorCursorV1 } from "@horseness/sdk";
import { CliParseErrorV1 } from "./parser.js";
import type { CliCommandDefinitionV1, CliCommandRegistryV1, CliInvocationV1 } from "./registry.js";
import { cliFailureV1, cliSuccessV1, type CliResultV1, type JsonValue } from "./result.js";
import { initializeCliWorkspaceV1, withCliWorkspaceV1, type CliWorkspaceSessionV1, type CliWorkspaceV1 } from "./workspace.js";

type WorkspaceCursor = Extract<CoordinatorCursorV1<"workspace.get.v1">, { kind: "workspace-only" }>;
type RunCursor = Extract<CoordinatorCursorV1<"run.get.v1">, { kind: "composite" }>;
type PendingOperation = NonNullable<CliWorkspaceV1["pending"]>;
interface RunSummary { readonly runId: string; readonly title: string; readonly observationCursor: RunCursor }

function text(invocation: CliInvocationV1, name: string, fallback?: string): string {
  const value = invocation.options[name] ?? fallback;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliParseErrorV1("INVALID_INVOCATION", `--${name} requires a value. Run horseness ${invocation.command} --help.`, invocation.command);
  }
  return value;
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid coordinator response.");
  return value as Record<string, unknown>;
}
function codeOf(error: unknown): string {
  if (!(error instanceof Error)) return "WORKFLOW_FAILED";
  if ("reasonCode" in error && typeof error.reasonCode === "string") return error.reasonCode;
  if ("code" in error && typeof error.code === "string") {
    if (error.code === "TRANSPORT_FAILURE") return /^([A-Z_]+):/u.exec(error.message)?.[1] ?? error.code;
    return error.code;
  }
  return "WORKFLOW_FAILED";
}
const REMEDIATION: Readonly<Record<string, string>> = {
  STALE_OBSERVATION: "State changed before the operation committed. Review horseness status, then run the command again. No automatic retry was made.",
  METHOD_NOT_AUTHORIZED: "This account is not allowed to perform the operation. Ask the workspace authority for the required access.",
  AUTH_SCOPE_MISMATCH: "The selected account cannot access this workspace or run. Select the intended workspace and account.",
  GRANT_INVALID: "Workspace access is no longer valid. Ask the workspace authority to restore access; do not delete workspace state.",
  GRANT_EXPIRED: "Workspace access has expired. Ask the workspace authority to renew access.",
  TRANSPORT_CONNECTION_FAILED: "Cannot reach the workspace daemon. Run horseness init in the workspace to start it, then repeat the command.",
  TRANSPORT_PROTOCOL_INVALID: "The daemon connection ended without a verified result. Check daemon health and workspace access, then repeat the same command.",
  INVALID_RESPONSE: "The daemon returned an invalid result. The saved operation was retained; inspect status before repeating the same command.",
};
function workflowFailure(command: string, error: unknown): CliResultV1 {
  const code = codeOf(error);
  const message = REMEDIATION[code] ?? (error instanceof Error ? error.message : "The operation failed.");
  return cliFailureV1(command, code, message, null, error instanceof CliParseErrorV1 ? 2 : 1);
}

async function observeWorkspace(session: CliWorkspaceSessionV1): Promise<WorkspaceCursor> {
  const cursor = session.state.workspaceCursor;
  const result = await session.client.call({ method: "workspace.get.v1", workspaceId: session.state.workspaceId, observationCursor: cursor,
    input: { schemaVersion: "1", queryType: "GetWorkspaceV1", observationCursor: cursor } });
  const observed = record(result.value).observationCursor as WorkspaceCursor;
  if (observed.kind !== "workspace-only" || observed.workspaceId !== session.state.workspaceId) throw new Error("Workspace observation identity mismatch.");
  session.save({ ...session.state, workspaceCursor: observed });
  return observed;
}
async function listRuns(session: CliWorkspaceSessionV1): Promise<readonly RunSummary[]> {
  const cursor = await observeWorkspace(session);
  const runs: RunSummary[] = [];
  let continuationToken = "";
  do {
    const result = await session.client.call({ method: "run.list.v1", workspaceId: session.state.workspaceId, observationCursor: cursor,
      input: { operationId: `query:${randomUUID()}`, limit: 100, continuationToken } });
    const value = record(result.value);
    for (const item of value.runs as readonly RunSummary[]) {
      if (item.observationCursor.kind !== "composite" || item.observationCursor.workspaceId !== session.state.workspaceId || item.observationCursor.runId !== item.runId) throw new Error("Run observation identity mismatch.");
      runs.push(item);
    }
    continuationToken = value.nextContinuationToken as string;
  } while (continuationToken !== "");
  session.save({ ...session.state, runs: Object.fromEntries(runs.map((run) => [run.runId, run.observationCursor])) });
  return runs;
}
function selectedRun(invocation: CliInvocationV1, state: CliWorkspaceV1): string {
  const selected = text(invocation, "run", "current");
  if (selected !== "current") return selected;
  if (state.currentRunId !== null) return state.currentRunId;
  throw new CliParseErrorV1("INVALID_INVOCATION", "No current run. Create one with horseness run create --title TEXT, or select one with horseness run use --run ID.", invocation.command);
}
async function observeRun(session: CliWorkspaceSessionV1, runId: string, observedRuns?: readonly RunSummary[]): Promise<{ cursor: RunCursor; title: string; revision: number }> {
  const runs = observedRuns ?? await listRuns(session);
  const selected = runs.find((run) => run.runId === runId);
  if (selected === undefined) throw new CliParseErrorV1("INVALID_INVOCATION", "Run not found in this workspace. Use horseness run list to select an existing run.");
  const result = await session.client.call({ method: "run.get.v1", workspaceId: session.state.workspaceId, runId, observationCursor: selected.observationCursor,
    input: { schemaVersion: "1", queryType: "GetRunV1", observationCursor: selected.observationCursor } });
  const value = record(result.value);
  const cursor = value.observationCursor as RunCursor;
  if (cursor.kind !== "composite" || cursor.workspaceId !== session.state.workspaceId || cursor.runId !== runId) throw new Error("Run observation identity mismatch.");
  const state = record(value.state);
  session.save({ ...session.state, runs: { ...session.state.runs, [runId]: cursor } });
  return { cursor, title: selected.title, revision: Number(record(state.canonical).revision) };
}
async function listTasks(session: CliWorkspaceSessionV1, cursor: RunCursor): Promise<readonly JsonValue[]> {
  const tasks: JsonValue[] = [];
  let continuationToken = "";
  do {
    const result = await session.client.call({ method: "task.list.v1", workspaceId: session.state.workspaceId, runId: cursor.runId, observationCursor: cursor,
      input: { operationId: `query:${randomUUID()}`, states: [], limit: 100, continuationToken } });
    const value = record(result.value);
    tasks.push(...value.tasks as readonly JsonValue[]);
    continuationToken = value.nextContinuationToken as string;
  } while (continuationToken !== "");
  return tasks;
}
function pendingOperation(session: CliWorkspaceSessionV1, command: PendingOperation["command"], title: string, runId?: string): PendingOperation | null {
  const pending = session.state.pending;
  if (pending !== null && (pending.command !== command || pending.title !== title || (runId !== undefined && pending.runId !== runId))) {
    const error = new Error(`An earlier ${pending.command} has an unknown outcome. Inspect horseness status, then repeat that exact command before starting another mutation.`);
    Object.assign(error, { code: "OPERATION_PENDING" });
    throw error;
  }
  return pending;
}
async function commitOperation(session: CliWorkspaceSessionV1, pending: PendingOperation): Promise<Record<string, unknown>> {
  session.save({ ...session.state, pending });
  try {
    const result = await session.client.call(pending.call);
    return record(result.value);
  } catch (error) {
    // Only a definite protocol rejection permits a new operation identity. An
    // interrupted transport retains the entire request, including its cursor.
    const code = codeOf(error);
    if (["STALE_OBSERVATION", "INVALID_PARAMS", "METHOD_NOT_AUTHORIZED", "AUTH_SCOPE_MISMATCH", "GRANT_INVALID", "GRANT_EXPIRED", "CURSOR_SCOPE_INSUFFICIENT", "IDEMPOTENCY_REQUIRED", "IDEMPOTENCY_FORBIDDEN"].includes(code)) {
      session.save({ ...session.state, pending: null });
    }
    throw error;
  }
}
async function createRun(invocation: CliInvocationV1): Promise<JsonValue> {
  const title = text(invocation, "title");
  return withCliWorkspaceV1(invocation, async (session) => {
    let pending = pendingOperation(session, "run create", title);
    if (pending === null) {
      const workspace = await observeWorkspace(session);
      const runId = `run:${randomUUID()}`;
      const operationId = `cli:${randomUUID()}`;
      const cursor: CoordinatorCursorV1<"run.create.v1"> = { ...workspace, kind: "absent-run-genesis", runId, expectedRunHead: "absent" };
      const call: CoordinatorCallV1<"run.create.v1"> = { method: "run.create.v1", workspaceId: session.state.workspaceId, runId, observationCursor: cursor, idempotencyKey: operationId,
        input: { schemaVersion: "1", commandType: "CreateRunV1", commandId: operationId, observationCursor: cursor, principalId: session.state.principalId, initialDocument: { title } } };
      pending = { command: "run create", title, runId, call };
    }
    const result = await commitOperation(session, pending);
    const cursor = result.resultCursor as RunCursor;
    session.save({ ...session.state, currentRunId: pending.runId, runs: { ...session.state.runs, [pending.runId]: cursor }, pending: null });
    return { workspaceId: session.state.workspaceId, runId: pending.runId, title, current: true };
  });
}
async function addTask(invocation: CliInvocationV1): Promise<JsonValue> {
  const title = text(invocation, "title");
  return withCliWorkspaceV1(invocation, async (session) => {
    const runId = selectedRun(invocation, session.state);
    let pending = pendingOperation(session, "task add", title, runId);
    if (pending === null) {
      const { cursor } = await observeRun(session, runId);
      const taskId = `task:${randomUUID()}`;
      const operationId = `cli:${randomUUID()}`;
      const call: CoordinatorCallV1<"task.create.v1"> = { method: "task.create.v1", workspaceId: session.state.workspaceId, runId, taskId, observationCursor: cursor, idempotencyKey: operationId,
        input: { operationId, taskContract: { schemaVersion: "1", taskId, title, completionPolicy: { schemaVersion: "1", kind: "predicate", predicate: { kind: "receipt-only" } } }, dependencyTaskIds: [] } };
      pending = { command: "task add", title, runId, taskId, call };
    }
    const result = await commitOperation(session, pending);
    const cursor = result.observationCursor as RunCursor;
    session.save({ ...session.state, runs: { ...session.state.runs, [runId]: cursor }, pending: null });
    return { workspaceId: session.state.workspaceId, runId, taskId: pending.taskId ?? String(result.taskId), title, lifecycle: "draft" };
  });
}

export function registerWorkflowCommandsV1(registry: CliCommandRegistryV1): void {
  function register(name: string, summary: string, usage: string, options: readonly string[], execute: CliCommandDefinitionV1["execute"]): void {
    registry.register({ name, aliases: [], category: "workflow", summary, usage: `${usage} [--workspace PATH] [--json]`, optionNames: ["workspace", ...options], secretOptions: [],
      async execute(invocation, context) {
        try {
          if (invocation.options.workspace !== undefined) text(invocation, "workspace");
          return await execute(invocation, context);
        } catch (error) { return workflowFailure(name, error); }
      } });
  }
  register("init", "Initialize this project and start its local daemon", "init [--daemon-executable PATH]", ["daemon-executable"], async (invocation, context) => cliSuccessV1("init", await initializeCliWorkspaceV1(invocation, context.authorityTime)));
  register("run create", "Create a run and select it as current", "run create --title TEXT", ["title"], async (invocation) => cliSuccessV1("run create", await createRun(invocation)));
  register("run list", "List this workspace's runs", "run list", [], async (invocation) => withCliWorkspaceV1(invocation, async (session) => {
    const runs = await listRuns(session);
    return cliSuccessV1("run list", { workspaceId: session.state.workspaceId, currentRunId: session.state.currentRunId, runs: runs.map(({ runId, title }) => ({ runId, title, current: runId === session.state.currentRunId })) });
  }));
  register("run use", "Select an existing run as current", "run use --run ID", ["run"], async (invocation) => {
    const runId = text(invocation, "run");
    return withCliWorkspaceV1(invocation, async (session) => {
      if (session.state.pending !== null) throw Object.assign(new Error("Resolve the pending operation before changing the current run. Repeat its exact command."), { code: "OPERATION_PENDING" });
      const observed = await observeRun(session, runId);
      session.save({ ...session.state, currentRunId: runId });
      return cliSuccessV1("run use", { runId, title: observed.title, current: true });
    });
  });
  register("task add", "Add a durable draft task to a run", "task add --title TEXT [--run current|ID]", ["title", "run"], async (invocation) => cliSuccessV1("task add", await addTask(invocation)));
  register("task list", "List tasks in the selected run", "task list [--run current|ID]", ["run"], async (invocation) => withCliWorkspaceV1(invocation, async (session) => {
    const runId = selectedRun(invocation, session.state);
    const { cursor } = await observeRun(session, runId);
    return cliSuccessV1("task list", { runId, tasks: await listTasks(session, cursor) });
  }));
  register("status", "Show workspace, current run, and task state", "status [--run current|ID]", ["run"], async (invocation) => withCliWorkspaceV1(invocation, async (session) => {
    const runs = await listRuns(session);
    const base = { workspaceId: session.state.workspaceId, workspacePath: session.state.workspacePath, runCount: runs.length, pendingOperation: session.state.pending?.command ?? null };
    if (session.state.currentRunId === null && invocation.options.run === undefined) return cliSuccessV1("status", { ...base, run: null, tasks: [] });
    const runId = selectedRun(invocation, session.state);
    const { cursor, title, revision } = await observeRun(session, runId, runs);
    return cliSuccessV1("status", { ...base, run: { runId, title, revision }, tasks: await listTasks(session, cursor) });
  }));
}
