import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_WIRE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
export const CODEX_MCP_SERVER = "horseness-worker";
export const CODEX_MCP_TOOL = "horseness_worker_return";
export const CODEX_MODEL_TOOL = "mcp__horseness-worker__horseness_worker_return";
const SAFE_ENVIRONMENT_KEYS = ["HOME", "CODEX_HOME", "LANG", "LC_ALL", "TZ", "NO_COLOR", "CODEX_DISABLE_UPDATE_CHECK"] as const;
const MAX_TURN_ITEMS = 64;
const HORSENESS_MCP_ENVIRONMENT_KEYS = ["HORSENESS_CODEX_RUNTIME_SOCKET", "HORSENESS_CODEX_RUNTIME_NONCE", "HORSENESS_CODEX_THREAD_CLAIM"] as const;
const ALLOWED_ENVIRONMENT_KEYS: Readonly<Record<string, true>> = Object.fromEntries(["PATH", "TMPDIR", "TMP", "TEMP", ...SAFE_ENVIRONMENT_KEYS, ...HORSENESS_MCP_ENVIRONMENT_KEYS].map(key => [key, true]));
export const CODEX_PINNED_TOOL_CONFIG = Object.freeze({
  web_search: "disabled",
  "features.plugins": true,
  "features.apps": false,
  "features.enable_mcp_apps": false,
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.code_mode": false,
  "features.code_mode_host": false,
  "features.code_mode_only": false,
  "features.standalone_web_search": false,
  "features.web_search_request": false,
  "features.web_search_cached": false,
  "features.tool_suggest": false,
  "features.multi_agent": false,
  "features.multi_agent_v2": false,
  "features.enable_fanout": false,
  include_environment_context: false,
  include_collaboration_mode_instructions: false,
  "skills.include_instructions": false,
});
export function codexRestrictedThreadStart(cwd: string, developerInstructions: string): Record<string, unknown> {
  return { cwd, developerInstructions, approvalPolicy: "never", permissions: ":read-only", environments: [], dynamicTools: [], config: { ...CODEX_PINNED_TOOL_CONFIG } };
}
export function codexRestrictedThreadResume(threadId: string, cwd: string, developerInstructions: string): Record<string, unknown> {
  return { threadId, cwd, developerInstructions, approvalPolicy: "never", permissions: ":read-only", config: { ...CODEX_PINNED_TOOL_CONFIG } };
}
export function codexRestrictedThreadFork(threadId: string, cwd: string, developerInstructions: string): Record<string, unknown> {
  return { threadId, cwd, developerInstructions, ephemeral: true, approvalPolicy: "never", permissions: ":read-only", config: { ...CODEX_PINNED_TOOL_CONFIG } };
}
export function codexRestrictedTurn(applicationContext: string): Record<string, unknown> {
  return { approvalPolicy: "never", permissions: ":read-only", environments: [], additionalContext: { "horseness-bound-attempt": { kind: "application", value: applicationContext } } };
}
export function codexNativeEnvironment(binary: string, temporaryDirectory: string, source: NodeJS.ProcessEnv, mcp?: { socket: string; nonce: string; threadClaim: string }): NodeJS.ProcessEnv {
  if (source.HOME === undefined || source.HOME.length === 0) throw new Error("CODEX_NATIVE_HOME_REQUIRED");
  const environment: NodeJS.ProcessEnv = {
    PATH: [...new Set([dirname(binary), dirname(process.execPath)])].join(":"),
    HOME: source.HOME,
    CODEX_HOME: source.CODEX_HOME ?? join(source.HOME, ".codex"),
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
  };
  for (const key of SAFE_ENVIRONMENT_KEYS) if (source[key] !== undefined) environment[key] = source[key];
  if (mcp !== undefined) {
    environment.HORSENESS_CODEX_RUNTIME_SOCKET = mcp.socket;
    environment.HORSENESS_CODEX_RUNTIME_NONCE = mcp.nonce;
    environment.HORSENESS_CODEX_THREAD_CLAIM = mcp.threadClaim;
  }
  return environment;
}
export function assertSafeCodexEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(environment)) if (ALLOWED_ENVIRONMENT_KEYS[key] !== true) throw new Error(`CODEX_NATIVE_ENVIRONMENT_KEY_FORBIDDEN_${key}`);
  for (const key of Object.keys(environment)) if (/(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|COOKIE|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|PROXY)/i.test(key)) throw new Error(`CODEX_NATIVE_ENVIRONMENT_SECRET_KEY_FORBIDDEN_${key}`);
}

type JsonObject = Record<string, unknown>;
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };

export type CodexMcpCall = {
  readonly type: "mcpToolCall";
  readonly server: string;
  readonly tool: string;
  readonly status: string;
  readonly arguments: unknown;
  readonly pluginId: string | null;
  readonly result: unknown;
  readonly error: unknown;
};

export type CodexTurnObservation = {
  readonly threadId: string;
  readonly turnId: string;
  readonly model: string;
  readonly mcpCalls: readonly CodexMcpCall[];
  readonly itemTypes: readonly string[];
  readonly itemDescriptors: readonly string[];
  readonly executingToolCallCount: number;
  readonly assistantText: string;
};

const PASSIVE_THREAD_ITEM_TYPES: Readonly<Record<string, true>> = Object.freeze({ userMessage: true, hookPrompt: true, agentMessage: true, plan: true, reasoning: true, subAgentActivity: true, enteredReviewMode: true, exitedReviewMode: true, contextCompaction: true });
const EXECUTING_THREAD_ITEM_TYPES: Readonly<Record<string, true>> = Object.freeze({ commandExecution: true, fileChange: true, mcpToolCall: true, dynamicToolCall: true, collabAgentToolCall: true, webSearch: true, imageView: true, sleep: true, imageGeneration: true });
export function classifyCodexThreadItemV2(item: unknown): "passive" | "executing" {
  const record = responseObject(item, "THREAD_ITEM");
  const type = typeof record.type === "string" ? record.type : "";
  if (EXECUTING_THREAD_ITEM_TYPES[type] === true) return "executing";
  if (PASSIVE_THREAD_ITEM_TYPES[type] === true) return "passive";
  throw new Error("CODEX_THREAD_ITEM_TYPE_UNKNOWN");
}

export function describeCodexThreadItemV2(item: unknown): string {
  const record = responseObject(item, "THREAD_ITEM");
  const type = typeof record.type === "string" ? record.type : "unknown";
  if (type !== "mcpToolCall") return type.slice(0, 64);

  const pluginId = typeof record.pluginId === "string" ? `@${record.pluginId}` : "";
  const name = `${String(record.server ?? "")}/${String(record.tool ?? "")}${pluginId}`;
  const safeName = name.length <= 192 && /^[A-Za-z0-9_.:@/-]+$/.test(name) ? name : "[redacted]";
  return `${type}:${safeName}`;
}
export function codexThreadItemLifecycleIdV2(item: unknown): string {
  const record = responseObject(item, "THREAD_ITEM");
  const id = typeof record.id === "string" ? record.id : "";
  if (id.length === 0 || id.length > 256 || !/^[A-Za-z0-9_.:@/-]+$/.test(id)) throw new Error("CODEX_THREAD_ITEM_ID_INVALID");
  return id;
}
export function recordCodexCompletedItemV2(completedItems: Map<string, string>, item: unknown): boolean {
  const itemId = codexThreadItemLifecycleIdV2(item);
  const itemDescriptor = describeCodexThreadItemV2(item);
  const priorDescriptor = completedItems.get(itemId);
  if (priorDescriptor !== undefined) {
    if (priorDescriptor !== itemDescriptor) throw new Error("CODEX_THREAD_ITEM_LIFECYCLE_CONFLICT");
    return false;
  }
  completedItems.set(itemId, itemDescriptor);
  return true;
}
export class CodexAppServerClient {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, Pending>();
  readonly #notifications: JsonObject[] = [];
  readonly #waiters = new Set<() => void>();
  #nextId = 1;
  #stdout = "";
  #stderr = "";
  #closed = false;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => this.#consume(String(chunk)));
    child.stderr.on("data", chunk => {
      this.#stderr += String(chunk);
      if (Buffer.byteLength(this.#stderr) > MAX_WIRE_BYTES) this.#stderr = this.#stderr.slice(-MAX_WIRE_BYTES);
    });
    child.once("close", code => { this.#closed = true; this.#failAll(new Error(`CODEX_APP_SERVER_EXIT_${code ?? "NONE"}`)); });
    child.once("error", error => { this.#closed = true; this.#failAll(error); });
  }

  static async start(binary: string, cwd: string, environment: NodeJS.ProcessEnv, onInitialized?: () => void): Promise<CodexAppServerClient> {
    const child = spawn(binary, ["app-server", "--stdio", "--strict-config"], { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"] });
    const client = new CodexAppServerClient(child);
    await client.request("initialize", { clientInfo: { name: "horseness-c18-smoke", title: "Horseness C18 smoke", version: "0.1.0" }, capabilities: { experimentalApi: true } });
    onInitialized?.();
    client.notify("initialized", {});
    return client;
  }
  request(method: string, params: JsonObject): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("CODEX_APP_SERVER_CLOSED"));
    const id = this.#nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.#pending.delete(id);
      reject(new Error(`CODEX_APP_SERVER_TIMEOUT_${method.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`));
    }, REQUEST_TIMEOUT_MS);
    this.#pending.set(id, { resolve, reject, timer });
    this.#send({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  notify(method: string, params: JsonObject): void { this.#send({ jsonrpc: "2.0", method, params }); }

  async waitFor(predicate: (message: JsonObject) => boolean, label: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<JsonObject> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const index = this.#notifications.findIndex(predicate);
      if (index >= 0) return this.#notifications.splice(index, 1)[0]!;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`CODEX_APP_SERVER_WAIT_${label}_TIMEOUT`);
      const { promise, resolve } = Promise.withResolvers<void>();
      this.#waiters.add(resolve);
      const timer = setTimeout(resolve, remaining);
      await promise;
      clearTimeout(timer);
      this.#waiters.delete(resolve);
    }
  }

  isClosed(): boolean { return this.#closed; }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#child.stdin.end();
    const { promise, resolve } = Promise.withResolvers<void>();
    const timer = setTimeout(() => { this.#child.kill("SIGKILL"); resolve(); }, 5_000);
    this.#child.once("close", () => resolve());
    await promise;
    clearTimeout(timer);
  }
  terminate(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#child.kill("SIGKILL");
    this.#failAll(new Error("CODEX_NATIVE_TIMEOUT"));
  }
  stderr(): string { return this.#stderr; }
  observedEnvironment(): Readonly<Record<string, string>> {
    const bytes = readFileSync(`/proc/${this.#child.pid}/environ`);
    return Object.freeze(Object.fromEntries(bytes.toString("utf8").split("\0").filter(Boolean).map(entry => { const separator = entry.indexOf("="); return [entry.slice(0, separator), entry.slice(separator + 1)]; })));
  }

  #send(message: JsonObject): void { this.#child.stdin.write(`${JSON.stringify(message)}\n`); }

  #consume(chunk: string): void {
    this.#stdout += chunk;
    if (Buffer.byteLength(this.#stdout) > MAX_WIRE_BYTES) return this.#failAll(new Error("CODEX_APP_SERVER_WIRE_TOO_LARGE"));
    while (this.#stdout.includes("\n")) {
      const index = this.#stdout.indexOf("\n");
      const line = this.#stdout.slice(0, index).trim();
      this.#stdout = this.#stdout.slice(index + 1);
      if (line.length === 0) continue;
      let message: JsonObject;
      try { message = JSON.parse(line) as JsonObject; }
      catch { return this.#failAll(new Error("CODEX_APP_SERVER_JSON_INVALID")); }
      if (typeof message.id === "number" && ("result" in message || "error" in message)) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) continue;
        this.#pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error !== undefined) pending.reject(new Error(`CODEX_APP_SERVER_RPC_ERROR:${JSON.stringify(message.error)}`));
        else pending.resolve(message.result);
        continue;
      }
      this.#notifications.push(message);
      for (const wake of this.#waiters) wake();
      this.#waiters.clear();
      if (typeof message.id === "number" && message.method === "mcpServer/elicitation/request") {
        this.#send({ jsonrpc: "2.0", id: message.id, result: { action: "accept", content: {} } });
        continue;
      }
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
    for (const wake of this.#waiters) wake();
    this.#waiters.clear();
  }
}

const responseObject = (value: unknown, label: string): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`CODEX_${label}_RESPONSE_INVALID`);
  return value as JsonObject;
};


export async function waitForMcpReady(client: CodexAppServerClient, threadId: string): Promise<JsonObject> {
  await client.waitFor(message => {
    if (message.method !== "mcpServer/startupStatus/updated") return false;
    const params = responseObject(message.params, "MCP_NOTIFICATION");
    return params.threadId === threadId && params.name === CODEX_MCP_SERVER && params.status === "ready";
  }, "MCP_READY", 20_000);
  const inventory = responseObject(await client.request("mcpServerStatus/list", { threadId, detail: "full" }), "MCP_INVENTORY");
  const servers = inventory.data;
  if (!Array.isArray(servers)) throw new Error("CODEX_NATIVE_INVENTORY_INVALID");
  const server = servers.find(item => item !== null && typeof item === "object" && (item as JsonObject).name === CODEX_MCP_SERVER) as JsonObject | undefined;
  const tools = server?.tools;
  if (server === undefined || tools === null || typeof tools !== "object" || Array.isArray(tools) || !(CODEX_MCP_TOOL in tools)) throw new Error("CODEX_NATIVE_INVENTORY_INVALID");
  return server;
}

export async function observeTurn(client: CodexAppServerClient, threadId: string, params: JsonObject): Promise<CodexTurnObservation> {
  const started = responseObject(await client.request("turn/start", { threadId, ...params }), "TURN_START");
  const turn = responseObject(started.turn, "TURN_START_TURN");
  const turnId = String(turn.id ?? "");
  if (turnId.length === 0) throw new Error("CODEX_TURN_ID_MISSING");
  const calls: CodexMcpCall[] = [];
  const itemTypes: string[] = [];
  const itemDescriptors: string[] = [];
  const completedItems = new Map<string, string>();
  let executingToolCallCount = 0;
  const texts: string[] = [];
  while (true) {
    const message = await client.waitFor(candidate => {
      const paramsValue = candidate.params;
      if (paramsValue === null || typeof paramsValue !== "object" || Array.isArray(paramsValue)) return false;
      const record = paramsValue as JsonObject;
      if (record.threadId !== threadId) return false;
      if (candidate.method === "item/completed") return record.turnId === turnId;
      if (candidate.method !== "turn/completed") return false;
      const completedTurn = record.turn;
      return completedTurn !== null && typeof completedTurn === "object" && !Array.isArray(completedTurn) && (completedTurn as JsonObject).id === turnId;
    }, "TURN_COMPLETED");
    if (message.method === "turn/completed") {
      const completed = responseObject(responseObject(message.params, "TURN_COMPLETED").turn, "TURN_COMPLETED_TURN");
      if (completed.status !== "completed") throw new Error(`CODEX_TURN_${String(completed.status).toUpperCase()}`);
      return { threadId, turnId, model: String(completed.model ?? turn.model ?? ""), mcpCalls: calls, itemTypes, itemDescriptors, executingToolCallCount, assistantText: texts.join("\n") };
    }
    const item = responseObject(responseObject(message.params, "ITEM_COMPLETED").item, "ITEM_COMPLETED_ITEM");
    if (!recordCodexCompletedItemV2(completedItems, item)) continue;
    const itemDescriptor = describeCodexThreadItemV2(item);
    const itemType = String(item.type ?? "");
    itemTypes.push(itemType);
    if (itemDescriptors.length >= MAX_TURN_ITEMS) throw new Error("CODEX_TURN_ITEM_COUNT_INVALID");
    itemDescriptors.push(itemDescriptor);
    if (classifyCodexThreadItemV2(item) === "executing") executingToolCallCount++;
    if (item.type === "mcpToolCall") calls.push(item as unknown as CodexMcpCall);
    if (item.type === "agentMessage" && typeof item.text === "string") texts.push(item.text);
  }
}

export async function validatePinnedSchemas(binary: string, root: string, temporaryDirectory: string, source: NodeJS.ProcessEnv, deadlineAt: number): Promise<string> {
  const fail = (reason: string): never => { throw new Error(`CODEX_SCHEMA_VALIDATION_FAILED:${reason}`); };
  const remaining = deadlineAt - Date.now();
  if (!Number.isSafeInteger(remaining) || remaining <= 0) fail("DEADLINE_EXPIRED");
  const output = await mkdtemp(join(root, "app-server-schemas-"));
  try {
    const environment = codexNativeEnvironment(binary, temporaryDirectory, source);
    assertSafeCodexEnvironment(environment);
    const child = spawn(binary, ["app-server", "generate-json-schema", "--experimental", "--out", output], { cwd: root, env: environment, stdio: ["ignore", "ignore", "pipe"] });
    let stderrBytes = 0;
    child.stderr.on("data", chunk => { stderrBytes += Buffer.byteLength(chunk); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, remaining);
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnError: boolean }>(resolveResult => {
      let spawnError = false;
      child.once("error", () => { spawnError = true; });
      child.once("close", (code, signal) => resolveResult({ code, signal, spawnError }));
    });
    clearTimeout(timer);
    if (timedOut) fail("DEADLINE_EXPIRED");
    if (result.spawnError) fail("PROCESS_START_FAILED");
    if (result.signal !== null) fail("PROCESS_SIGNALED");
    if (result.code !== 0) fail(stderrBytes > 64 * 1024 ? "GENERATOR_FAILED_DIAGNOSTIC_TOO_LARGE" : "GENERATOR_FAILED");

    const expectedFiles = ["codex_app_server_protocol.schemas.json", "codex_app_server_protocol.v2.schemas.json"] as const;
    const schemas = await Promise.all(expectedFiles.map(async name => {
      let bytes: Buffer;
      try { bytes = await readFile(join(output, name)); }
      catch { return fail(`EXPECTED_FILE_MISSING_${name.includes(".v2.") ? "V2" : "V1"}`); }
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_WIRE_BYTES) fail(`EXPECTED_FILE_SIZE_INVALID_${name.includes(".v2.") ? "V2" : "V1"}`);
      try {
        const parsed: unknown = JSON.parse(bytes.toString("utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) fail(`EXPECTED_FILE_JSON_INVALID_${name.includes(".v2.") ? "V2" : "V1"}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("CODEX_SCHEMA_VALIDATION_FAILED:")) throw error;
        fail(`EXPECTED_FILE_JSON_INVALID_${name.includes(".v2.") ? "V2" : "V1"}`);
      }
      return bytes;
    }));
    const v2Schema = schemas[1];
    if (v2Schema === undefined) return fail("EXPECTED_FILE_MISSING_V2");
    const v2Text = v2Schema.toString("utf8");
    for (const required of ["thread/start", "thread/resume", "thread/fork", "turn/start", "mcpServerStatus/list", "marketplace/add", "plugin/install", "plugin/uninstall", "mcpToolCall", "developerInstructions", "additionalContext", "pluginId", "ephemeral", "approvalPolicy", "permissions", "environments", "dynamicTools", "config", "sandboxPolicy", '"mention"', '"skill"']) if (!v2Text.includes(required)) fail(`CONTRACT_MISSING_${required.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`);
    return `sha256:${createHash("sha256").update(v2Schema).digest("hex")}`;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CODEX_SCHEMA_VALIDATION_FAILED:")) throw error;
    return fail("OFFLINE_VALIDATION_FAILED");
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}
