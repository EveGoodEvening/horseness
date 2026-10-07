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
  MODEL_REQUIRED: "This native host cannot resolve a concrete default model. Repeat the command with --model NAME (or --planner-model NAME for automatic planning).",
  TASK_NOT_READY: "The task has unsatisfied dependencies or a live attempt. Inspect task show before explicitly trying again.",
  TASK_NOT_DRAFT: "This operation requires the unchanged draft source. Inspect task show; do not replace the reviewed plan or active contract.",
  PLAN_SOURCE_CHANGED: "The source contract changed since planning. Inspect the source and request a new breakdown explicitly.",
  PLAN_INVALID: "The planner output was rejected. Inspect the planner result; no plan was adopted.",
  AUTHORIZATION_DENIED: "Execution was denied by current authority or policy. Ask the workspace authority for access; workspace enable-execution is an explicit owner-only grant upgrade.",
  UNKNOWN_OUTCOME: "The external handoff outcome is unknown. Inspect task show and daemon reconciliation; do not launch a duplicate attempt.",
  WORKFLOW_GRAPH_CHANGED: "The dependency graph no longer matches this workflow's authorization. Inspect task show; no changed closure was launched.",
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
  if ((observed.kind as unknown) !== "workspace-only" || observed.workspaceId !== session.state.workspaceId) throw new Error("Workspace observation identity mismatch.");
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
      if ((item.observationCursor.kind as unknown) !== "composite" || item.observationCursor.workspaceId !== session.state.workspaceId || item.observationCursor.runId !== item.runId) throw new Error("Run observation identity mismatch.");
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
  if ((cursor.kind as unknown) !== "composite" || cursor.workspaceId !== session.state.workspaceId || cursor.runId !== runId) throw new Error("Run observation identity mismatch.");
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
function pendingOperation(session: CliWorkspaceSessionV1, command: PendingOperation["command"], title: string, runId?: string, fingerprint?: string): PendingOperation | null {
  const pending = session.state.pending;
  if (pending !== null && (pending.command !== command || pending.title !== title || (runId !== undefined && pending.runId !== runId) || pending.fingerprint !== fingerprint)) {
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
    if ((typeof error === "object" && error !== null && "definitive" in error && error.definitive === true) || ["STALE_OBSERVATION", "INVALID_PARAMS", "METHOD_NOT_AUTHORIZED", "AUTH_SCOPE_MISMATCH", "GRANT_INVALID", "GRANT_EXPIRED", "CURSOR_SCOPE_INSUFFICIENT", "IDEMPOTENCY_REQUIRED", "IDEMPOTENCY_FORBIDDEN", "MODEL_REQUIRED", "TASK_NOT_FOUND", "TASK_NOT_DRAFT", "TASK_NOT_READY", "TASK_CANCELLED", "WORKFLOW_STOPPED", "WORKFLOW_GRAPH_CHANGED", "WORKFLOW_AUTHORIZATION_EXPIRED", "PLAN_INVALID", "PLAN_SOURCE_CHANGED", "PLAN_NOT_FOUND", "EXECUTION_PROFILE_MISMATCH", "AUTHORIZATION_DENIED", "QUOTA_DENIED"].includes(code)) {
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
        input: { operationId, taskContract: { schemaVersion: "2", taskId, title, instructions: title, acceptanceCriteria: [], kind: "work", sourceTaskId: null, completionPolicy: { schemaVersion: "1", kind: "predicate", predicate: { kind: "receipt-only" } } }, dependencyTaskIds: [] } };
      pending = { command: "task add", title, runId, taskId, call };
    }
    const result = await commitOperation(session, pending);
    const cursor = result.observationCursor as RunCursor;
    session.save({ ...session.state, runs: { ...session.state.runs, [runId]: cursor }, pending: null });
    return { workspaceId: session.state.workspaceId, runId, taskId: pending.taskId ?? String(result.taskId), title, lifecycle: "draft" };
  });
}

function executionOptions(invocation: CliInvocationV1): Record<string, string | boolean> {
  const options: Record<string, string | boolean> = { taskId: text(invocation, "task") };
  const host = (name: string, fallback?: string): string => {
    const value = text(invocation, name, fallback);
    if (!["pi", "omp", "claude", "codex"].includes(value)) throw new CliParseErrorV1("INVALID_INVOCATION", `--${name} must be pi, omp, claude, or codex.`, invocation.command);
    return value;
  };
  if (invocation.command === "task dispatch" || invocation.command === "task execute") options.adapterId = host("adapter");
  if (invocation.command === "task breakdown") options.adapterId = host("planner");
  if (options.adapterId !== undefined) options.model = invocation.options.model === undefined ? "" : text(invocation, "model");
  if (invocation.command === "task adopt") options.planDigest = text(invocation, "plan");
  if (invocation.command === "task execute") {
    if (invocation.options["auto-plan"] !== undefined && invocation.options["auto-plan"] !== true) throw new CliParseErrorV1("INVALID_INVOCATION", "--auto-plan is a flag and takes no value.", invocation.command);
    options.autoPlan = invocation.options["auto-plan"] === true;
    if (!options.autoPlan && (invocation.options.planner !== undefined || invocation.options["planner-model"] !== undefined)) throw new CliParseErrorV1("INVALID_INVOCATION", "--planner and --planner-model require --auto-plan.", invocation.command);
    options.plannerAdapterId = host("planner", String(options.adapterId));
    options.plannerModel = invocation.options["planner-model"] === undefined ? "" : text(invocation, "planner-model");
  }
  if (invocation.command === "task cancel") { options.reason = "operator-cancelled"; options.cascade = true; }
  return options;
}

async function taskOperation(invocation: CliInvocationV1): Promise<JsonValue> {
  const options = executionOptions(invocation);
  return withCliWorkspaceV1(invocation, async (session) => {
    const runId = selectedRun(invocation, session.state);
    const taskId = String(options.taskId);
    const fingerprint = JSON.stringify({ runId, ...options });
    let pending = pendingOperation(session, invocation.command, taskId, runId, fingerprint);
    if (pending === null) {
      const { cursor } = await observeRun(session, runId);
      const operationId = `cli:${randomUUID()}`;
      const methods = { "task dispatch": "task.dispatch.v1", "task breakdown": "task.breakdown.v1", "task adopt": "task.adoptPlan.v1", "task execute": "task.execute.v1", "task cancel": "task.cancel.v1" } as const;
      const method = methods[invocation.command as keyof typeof methods];
      const call = { method, workspaceId: session.state.workspaceId, runId, taskId, observationCursor: cursor, idempotencyKey: operationId, input: { operationId, ...options } } as CoordinatorCallV1;
      pending = { command: invocation.command, title: taskId, runId, taskId, fingerprint, call };
    }
    const result = await commitOperation(session, pending);
    const cursor = result.observationCursor as RunCursor | undefined;
    if ((cursor?.kind as unknown) !== "composite" || cursor === undefined || cursor.workspaceId !== session.state.workspaceId || cursor.runId !== runId) throw Object.assign(new Error("Invalid task operation observation."), { code: "INVALID_RESPONSE" });
    session.save({ ...session.state, runs: { ...session.state.runs, [runId]: cursor }, pending: null });
    return { ...result as Record<string, JsonValue>, runId, taskId };
  });
}

async function enableExecution(invocation: CliInvocationV1): Promise<JsonValue> {
  return withCliWorkspaceV1(invocation, async (session) => {
    let pending = pendingOperation(session, invocation.command, "enable-execution", "", "enable-execution:v1");
    if (pending === null) {
      const cursor = await observeWorkspace(session);
      const listed = await session.client.call({ method: "grant.list.v1", workspaceId: session.state.workspaceId, observationCursor: cursor, input: { operationId: `query:${randomUUID()}`, principalId: session.state.principalId, includeRevoked: false, limit: 100 } });
      const grants = record(listed.value).grants as readonly Record<string, unknown>[];
      const current = grants.filter((grant) => grant.current === true);
      const grant = current[0];
      if (current.length !== 1 || grant === undefined || grant.principalId !== session.state.principalId || grant.principalRole !== "authority" || grant.workspaceId !== session.state.workspaceId || grant.revoked === true || !Array.isArray(grant.allowedMethods) || !grant.allowedMethods.includes("grant.issue.v1")) throw Object.assign(new Error("Only the current workspace authority can explicitly enable execution."), { code: "METHOD_NOT_AUTHORIZED" });
      const resourceScope: Record<string, JsonValue> = { workspaceId: session.state.workspaceId, peerIdentity: String(grant.peerIdentity) };
      for (const key of ["runId", "taskId", "attemptId", "generation", "proposalId", "adapterId"] as const) if (grant[key] !== null && grant[key] !== undefined) resourceScope[key] = grant[key] as JsonValue;
      const actions = [...new Set([...grant.allowedMethods as string[], "task.get.v1", "task.dispatch.v1", "task.breakdown.v1", "task.adoptPlan.v1", "task.execute.v1", "task.cancel.v1"])].sort();
      const operationId = `cli:${randomUUID()}`;
      const call: CoordinatorCallV1<"grant.issue.v1"> = { method: "grant.issue.v1", workspaceId: session.state.workspaceId, observationCursor: cursor, idempotencyKey: operationId, input: { operationId, principalId: session.state.principalId, principalRole: "authority", actions, resourceScope, expiresAt: String(grant.expiresAt) } };
      pending = { command: invocation.command, title: "enable-execution", runId: "", fingerprint: "enable-execution:v1", call };
    }
    const result = await commitOperation(session, pending);
    if (typeof result.grantId !== "string") throw Object.assign(new Error("Invalid grant issue response."), { code: "INVALID_RESPONSE" });
    session.replaceGrant(result.grantId);
    session.save({ ...session.state, pending: null });
    return { workspaceId: session.state.workspaceId, executionEnabled: true };
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
  register("workspace enable-execution", "Explicitly authorize task execution for this workspace", "workspace enable-execution", [], async (invocation) => cliSuccessV1(invocation.command, await enableExecution(invocation)));
  register("task dispatch", "Start one native task attempt (acknowledgement, not completion)", "task dispatch --task ID --adapter HOST [--model NAME] [--run current|ID]", ["task", "adapter", "model", "run"], async (invocation) => cliSuccessV1(invocation.command, await taskOperation(invocation)));
  register("task breakdown", "Start a planner and retain a preview for explicit adoption", "task breakdown --task ID --planner HOST [--model NAME] [--run current|ID]", ["task", "planner", "model", "run"], async (invocation) => cliSuccessV1(invocation.command, await taskOperation(invocation)));
  register("task adopt", "Adopt the exact reviewed plan preview", "task adopt --task ID --plan DIGEST [--run current|ID]", ["task", "plan", "run"], async (invocation) => cliSuccessV1(invocation.command, await taskOperation(invocation)));
  register("task execute", "Authorize serial dependency execution; planning is opt-in", "task execute --task ID --adapter HOST [--model NAME] [--auto-plan [--planner HOST] [--planner-model NAME]] [--run current|ID]", ["task", "adapter", "model", "auto-plan", "planner", "planner-model", "run"], async (invocation) => cliSuccessV1(invocation.command, await taskOperation(invocation)));
  register("task cancel", "Durably stop the target and its workflow launches", "task cancel --task ID [--run current|ID]", ["task", "run"], async (invocation) => cliSuccessV1(invocation.command, await taskOperation(invocation)));
  register("task show", "Observe task attempts, result, dependencies, plan and workflow", "task show --task ID [--run current|ID]", ["task", "run"], async (invocation) => withCliWorkspaceV1(invocation, async (session) => {
    const taskId = text(invocation, "task");
    const runId = selectedRun(invocation, session.state);
    const { cursor } = await observeRun(session, runId);
    const result = await session.client.call({ method: "task.get.v1", workspaceId: session.state.workspaceId, runId, taskId, observationCursor: cursor, input: { operationId: `query:${randomUUID()}`, taskId, includeAttempts: true } });
    return cliSuccessV1(invocation.command, { ...record(result.value) as Record<string, JsonValue>, runId });
  }));
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
