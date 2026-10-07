export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type CliResultV1 =
  | { readonly schemaVersion: "1"; readonly ok: true; readonly command: string; readonly data: JsonValue; readonly exitCode?: 0 | 3 }
  | {
      readonly schemaVersion: "1";
      readonly ok: false;
      readonly command: string;
      readonly error: { readonly code: string; readonly message: string; readonly details: JsonValue | null };
      readonly exitCode?: 1 | 2 | 4;
    };

const SECRET_KEY = /(?:authorization|bootstrap|credential|password|passwd|private[-_]?key|recovery|secret|token)/iu;
const SECRET_VALUE = /(?:bearer\s+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:authorization|bootstrap|credential|password|passwd|private[-_]?key|recovery|secret|token)\b|\b(?:gh[pousr]_|sk[_-]|xox[baprs]-)[A-Za-z0-9_-]+)/iu;
const REDACTED = "[REDACTED]" as const;

export function redactCliValueV1(value: JsonValue, secretKeys: readonly string[] = []): JsonValue {
  const explicit = new Set(secretKeys.map((key) => key.toLowerCase()));
  function visit(current: JsonValue, key?: string): JsonValue {
    if (key !== undefined && (explicit.has(key.toLowerCase()) || SECRET_KEY.test(key))) return REDACTED;
    if (typeof current === "string" && key !== "command") return SECRET_VALUE.test(current) ? REDACTED : current;
    if (Array.isArray(current)) return (current as readonly JsonValue[]).map((item) => visit(item));
    if (current !== null && typeof current === "object") {
      const redacted: Record<string, JsonValue> = {};
      for (const childKey of Object.keys(current).sort()) {
        redacted[childKey] = visit((current as Readonly<Record<string, JsonValue>>)[childKey] ?? null, childKey);
      }
      return redacted;
    }
    return current;
  }
  return visit(value);
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Readonly<Record<string, JsonValue>>)[key] ?? null);
    }
    return sorted;
  }
  return value;
}

export function cliSuccessV1(command: string, data: JsonValue, exitCode: 0 | 3 = 0): CliResultV1 {
  return { schemaVersion: "1", ok: true, command, data, ...(exitCode === 0 ? {} : { exitCode }) };
}

export function cliFailureV1(command: string, code: string, message: string, details: JsonValue | null, exitCode: 1 | 2 | 4 = 1): CliResultV1 {
  return { schemaVersion: "1", ok: false, command, error: { code, message, details }, ...(exitCode === 1 ? {} : { exitCode }) };
}

export function renderCliJsonV1(result: CliResultV1, secretKeys: readonly string[] = []): string {
  const safe = redactCliValueV1(result as unknown as JsonValue, secretKeys);
  return `${JSON.stringify(canonicalize(safe))}\n`;
}
export function renderCliHumanV1(result: CliResultV1, secretKeys: readonly string[] = []): string {
  const safe = redactCliValueV1(result as unknown as JsonValue, secretKeys) as unknown as CliResultV1;
  if (!safe.ok) {
    const details = safe.error.details === null ? "" : `\n${JSON.stringify(canonicalize(safe.error.details), null, 2)}`;
    return `${safe.command}: ${safe.error.code}: ${safe.error.message}${details}\n`;
  }
  if (safe.data === null) return `${safe.command}: ok\n`;
  if (typeof safe.data === "string") return `${safe.data}\n`;
  const data = safe.data as Readonly<Record<string, JsonValue>>;
  const quoted = (value: JsonValue | undefined): string => JSON.stringify(value ?? "");
  const display = (value: JsonValue | undefined): string => {
    if (value === null || typeof value !== "object") return String(value);
    if (Array.isArray(value)) return (value as readonly JsonValue[]).map((item) => item === null ? "" : display(item)).join(",");
    return "[object Object]";
  };
  if (safe.command === "init") return `${data.created ? "Initialized" : "Connected to"} workspace ${quoted(data.workspacePath)}.\nNext: horseness run create --title TEXT\n`;
  if (safe.command === "run create") return `Created run ${display(data.runId)}: ${quoted(data.title)} (current)\nNext: horseness task add --title TEXT\n`;
  if (safe.command === "run use") return `Current run: ${display(data.runId)} — ${quoted(data.title)}\n`;
  if (safe.command === "task add") return `Added task ${display(data.taskId)}: ${quoted(data.title)} [draft]\nRun: ${display(data.runId)}\n`;
  if (safe.command === "workspace enable-execution") return `Execution authority enabled for workspace ${display(data.workspaceId)}. No task was launched.\n`;
  if (["task dispatch", "task breakdown", "task execute", "task adopt", "task cancel"].includes(safe.command)) {
    const lines = [`${safe.command}: ${display(data.status)} — task ${display(data.taskId)}`, `Operation: ${display(data.outcomeId)}`];
    if (data.workflowId !== undefined) lines.push(`Workflow: ${display(data.workflowId)}`);
    if (data.plannerTaskId !== undefined) lines.push(`Planner task: ${display(data.plannerTaskId)}`);
    if (data.taskIds !== undefined) lines.push(`Adopted tasks: ${(data.taskIds as readonly string[]).join(", ")}`);
    if (safe.command === "task breakdown") lines.push("Planning started; this acknowledgement is not a completed preview. Inspect task show, then explicitly adopt its plan digest.");
    else if (safe.command === "task dispatch" || safe.command === "task execute") lines.push("Durable start acknowledgement, not task completion. Observe progress and authenticated results with task show.");
    lines.push(`Next: horseness task show --task ${display(data.taskId)} --run ${display(data.runId)}`);
    return `${lines.join("\n")}\n`;
  }
  if (safe.command === "task show") {
    const task = data.task as Readonly<Record<string, JsonValue>>;
    const lines = [`Task: ${display(task.taskId)} — ${quoted(task.title)}`, `Lifecycle: ${display(task.lifecycle)}`, `Schedulability: ${typeof task.schedulability === "string" ? task.schedulability : JSON.stringify(task.schedulability)}`, `Dependencies: ${(task.dependencies as readonly string[]).join(", ") || "none"}`];
    for (const attempt of task.attempts as readonly Readonly<Record<string, JsonValue>>[]) {
      lines.push(`Attempt ${display(attempt.attemptId)} generation ${display(attempt.generation)}: ${display(attempt.adapterId)} / ${display(attempt.model)} [${display(attempt.state)}]`);
      for (const key of ["providerOperationId", "receiptDigest", "outputDigest", "failureCode"]) if (attempt[key] !== null && attempt[key] !== undefined) lines.push(`  ${key}: ${display(attempt[key])}`);
    }
    if (task.workflow !== null) {
      const workflow = task.workflow as Readonly<Record<string, JsonValue>>;
      lines.push(`Workflow ${display(workflow.workflowId)}: ${display(workflow.state)}${workflow.reasonCode === null ? "" : ` (${display(workflow.reasonCode)})`}`);
    }
    if (task.plan !== null) {
      const plan = task.plan as Readonly<Record<string, JsonValue>>;
      const adopted = plan.adoptedTaskIds as readonly string[];
      lines.push(`Plan: ${display(plan.planDigest)} [${adopted.length === 0 ? "preview — not adopted" : "adopted"}]`);
      for (const child of plan.tasks as readonly Readonly<Record<string, JsonValue>>[]) {
        lines.push(`  ${display(child.key)}: ${quoted(child.title)}`, `    Instructions: ${quoted(child.instructions)}`, `    Acceptance criteria: ${JSON.stringify(child.acceptanceCriteria)}`, `    Depends on: ${(child.dependsOn as readonly string[]).join(", ") || "none"}`);
      }
      if (adopted.length === 0) lines.push(`Adopt explicitly: horseness task adopt --task ${display(task.taskId)} --plan ${display(plan.planDigest)} --run ${display(data.runId)}`);
      else lines.push(`Adopted tasks: ${adopted.join(", ")}`);
    }
    lines.push(task.output === null ? "No published output yet; an acknowledgement or worker prose is not completion." : `Published output:\n${display(task.output)}`);
    return `${lines.join("\n")}\n`;
  }
  if (safe.command === "run list") {
    const runs = data.runs as readonly Readonly<Record<string, JsonValue>>[];
    return runs.length === 0 ? "No runs yet. Create one with horseness run create --title TEXT.\n" : `${runs.map((run) => `${run.current ? "*" : " "} ${display(run.runId)}  ${quoted(run.title)}`).join("\n")}\n`;
  }
  if (safe.command === "task list" || safe.command === "status") {
    const tasks = data.tasks as readonly Readonly<Record<string, JsonValue>>[];
    const lines: string[] = [];
    if (safe.command === "status") {
      lines.push(`Workspace: ${quoted(data.workspacePath)}`, `Runs: ${display(data.runCount)}`);
      if (data.pendingOperation !== null) lines.push(`Unconfirmed operation: ${display(data.pendingOperation)}. Repeat that exact command to recover its result.`);
      if (data.run === null) lines.push("No current run. Create one with horseness run create --title TEXT.");
      else {
        const run = data.run as Readonly<Record<string, JsonValue>>;
        lines.push(`Run: ${display(run.runId)} — ${quoted(run.title)}`, `Canonical revision: ${display(run.revision)}`);
      }
    } else lines.push(`Run: ${display(data.runId)}`);
    lines.push(`Tasks: ${display(tasks.length)}`, ...tasks.map((task) => `  ${display(task.taskId)}  [${display(task.lifecycle)}] ${quoted(task.title)}${task.schedulability === undefined ? "" : ` — ${JSON.stringify(task.schedulability)}`}${task.workflow === undefined || task.workflow === null ? "" : ` workflow=${JSON.stringify(task.workflow)}`}${task.result === undefined || task.result === null ? "" : ` result=${JSON.stringify(task.result)}`}${task.dependencies === undefined ? "" : ` dependencies=${JSON.stringify(task.dependencies)}`}`));
    if (tasks.length === 0 && (safe.command === "task list" || data.run !== null)) lines.push("Add a task with horseness task add --title TEXT.");
    return `${lines.join("\n")}\n`;
  }
  return `${JSON.stringify(canonicalize(safe.data), null, 2)}\n`;
}
