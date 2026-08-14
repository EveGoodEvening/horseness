import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_WIRE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
export const CODEX_MCP_SERVER = "horseness-worker";
export const CODEX_MCP_TOOL = "horseness_worker_return";
export const CODEX_MODEL_TOOL = "mcp__horseness-worker__horseness_worker_return";
const SAFE_ENVIRONMENT_KEYS = ["HOME", "CODEX_HOME", "LANG", "LC_ALL", "TZ", "NO_COLOR", "CODEX_DISABLE_UPDATE_CHECK"] as const;
const HORSENESS_MCP_ENVIRONMENT_KEYS = ["HORSENESS_CODEX_RUNTIME_SOCKET", "HORSENESS_CODEX_RUNTIME_NONCE", "HORSENESS_CODEX_THREAD_CLAIM"] as const;
const ALLOWED_ENVIRONMENT_KEYS: Readonly<Record<string, true>> = Object.fromEntries(["PATH", "TMPDIR", "TMP", "TEMP", ...SAFE_ENVIRONMENT_KEYS, ...HORSENESS_MCP_ENVIRONMENT_KEYS].map(key => [key, true]));
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
  readonly assistantText: string;
};

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
    child.once("close", code => this.#failAll(new Error(`CODEX_APP_SERVER_EXIT_${code ?? "NONE"}`)));
    child.once("error", error => this.#failAll(error));
  }

  static async start(binary: string, cwd: string, environment: NodeJS.ProcessEnv): Promise<CodexAppServerClient> {
    const child = spawn(binary, ["app-server", "--stdio", "--strict-config"], { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"] });
    const client = new CodexAppServerClient(child);
    await client.request("initialize", { clientInfo: { name: "horseness-c18-smoke", title: "Horseness C18 smoke", version: "0.1.0" }, capabilities: { experimentalApi: true } });
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
      return { threadId, turnId, model: String(completed.model ?? turn.model ?? ""), mcpCalls: calls, assistantText: texts.join("\n") };
    }
    const item = responseObject(responseObject(message.params, "ITEM_COMPLETED").item, "ITEM_COMPLETED_ITEM");
    if (item.type === "mcpToolCall") calls.push(item as unknown as CodexMcpCall);
    if (item.type === "agentMessage" && typeof item.text === "string") texts.push(item.text);
  }
}

export async function validatePinnedSchemas(binary: string, root: string): Promise<string> {
  const output = join(root, "app-server-schemas");
  await mkdir(output, { recursive: true, mode: 0o700 });
  const child = spawn(binary, ["app-server", "generate-json-schema", "--experimental", "--out", output], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => stderr += chunk);
  const code = await new Promise<number | null>(resolve => child.once("close", resolve));
  if (code !== 0) throw new Error(`CODEX_SCHEMA_GENERATION_FAILED:${stderr}`);
  const schema = await readFile(join(output, "codex_app_server_protocol.v2.schemas.json"));
  const text = schema.toString("utf8");
  for (const required of ["thread/start", "thread/resume", "thread/fork", "turn/start", "mcpServerStatus/list", "marketplace/add", "plugin/install", "plugin/uninstall", "mcpToolCall", "developerInstructions", "additionalContext", "pluginId"]) if (!text.includes(required)) throw new Error(`CODEX_SCHEMA_CONTRACT_MISSING_${required.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`);
  return `sha256:${createHash("sha256").update(schema).digest("hex")}`;
}
