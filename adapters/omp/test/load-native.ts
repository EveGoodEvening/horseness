import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const RUNTIME_KEY = Symbol.for("horseness.adapter.omp.native-runtime.v1");

type JsonObject = Record<string, unknown>;
type LoadedExtension = {
  tools: Map<string, { definition: unknown }>;
  commands: Map<string, unknown>;
  handlers: Map<string, unknown[]>;
};
type PendingCall = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type NativeRunnerState = {
  toolNames: string[];
  commandNames: string[];
  handlerNames: string[];
};

export interface NativeRunnerHarness {
  loaded: { extensions: unknown[]; errors: unknown[]; runtime: unknown };
  runner: {
    getRegisteredTool(name: string): { definition: { execute(id: string, input: unknown): Promise<unknown> } } | undefined;
    getCommand(name: string): unknown;
    hasHandlers(name: string): boolean;
    emit(event: unknown): Promise<unknown>;
    takeErrors(): Promise<Array<{ extensionPath: string; event: string; error: string }>>;
  };
  close(): Promise<void>;
}

function serialize(value: unknown): string {
  const line = JSON.stringify(value);
  if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error("OMP native RPC message exceeds limit");
  return line;
}

async function runChild(loaderPath: string, runnerPath: string, extensionPath: string, cwd: string): Promise<void> {
  let nextHostCallId = 1;
  const pendingHostCalls = new Map<number, PendingCall>();
  function runtimeCall(method: string, args: unknown[] = []): Promise<unknown> {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const id = nextHostCallId++;
    pendingHostCalls.set(id, { resolve, reject });
    process.stdout.write(`${serialize({ kind: "host-call", id, method, args })}\n`);
    return promise;
  }
  let revoke: (() => Promise<void>) | null = null;
  const runtime = new Proxy({}, {
    get(_target, property) {
      if (property === "registerRevoker") return (callback: () => Promise<void>) => { revoke = callback; return runtimeCall("registerRevoker"); };
      if (typeof property !== "string") return undefined;
      return (...args: unknown[]) => runtimeCall(property, args);
    },
  });
  Object.defineProperty(globalThis, RUNTIME_KEY, { configurable: true, value: runtime });

  const [{ loadExtensions }, { ExtensionRunner }] = await Promise.all([import(pathToFileURL(loaderPath).href), import(pathToFileURL(runnerPath).href)]);
  const loaded = await loadExtensions([extensionPath], cwd);
  if (loaded.errors.length !== 0 || loaded.extensions.length !== 1) throw new Error(`OMP extension load failed: ${JSON.stringify(loaded.errors)}`);
  const extension = loaded.extensions[0] as LoadedExtension;
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, { getCwd: () => cwd }, { registerProvider() {}, unregisterProvider() {} });
  const handlerErrors: Array<{ extensionPath: string; event: string; error: string }> = [];
  runner.onError((error: { extensionPath: string; event: string; error: string }) => {
    handlerErrors.push({ extensionPath: error.extensionPath, event: error.event, error: error.error });
  });
  const toolNames = [...extension.tools.keys()];
  const commandNames = [...extension.commands.keys()];
  const handlerNames = [...extension.handlers.keys()];
  const registrationsComplete = toolNames.includes("horseness_worker_return")
    && toolNames.includes("horseness_native_state")
    && commandNames.includes("horseness-state")
    && handlerNames.includes("agent_start")
    && handlerNames.includes("before_agent_start");
  if (!registrationsComplete) throw new Error("OMP native registrations are incomplete");
  process.stdout.write(`${serialize({ kind: "ready", toolNames, commandNames, handlerNames })}\n`);

  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", line => { void (async () => {
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error("OMP native RPC message exceeds limit");
    const message = JSON.parse(line) as JsonObject;
    if (message.kind === "host-result" && typeof message.id === "number") {
      const waiter = pendingHostCalls.get(message.id);
      if (!waiter) return;
      pendingHostCalls.delete(message.id);
      if (message.ok === true) waiter.resolve(message.value);
      else waiter.reject(new Error(String(message.error)));
      return;
    }
    if (message.kind !== "request" || typeof message.id !== "number" || typeof message.method !== "string") return;
    try {
      let value: unknown;
      if (message.method === "invoke") {
        const args = message.args as [string, string, unknown];
        const tool = runner.getRegisteredTool(args[0]);
        if (!tool) throw new Error(`unknown OMP tool: ${args[0]}`);
        value = await tool.definition.execute(args[1], args[2]);
      } else if (message.method === "emit") {
        const event = structuredClone((message.args as unknown[])[0]) as Record<string, unknown>;
        if (event.type === "before_agent_start") value = await runner.emitBeforeAgentStart(String(event.prompt ?? ""), undefined, "", {});
        else value = await runner.emit(event);
      } else if (message.method === "revoke") {
        await revoke?.();
        value = null;
      } else if (message.method === "inspect") {
        value = { toolNames, commandNames, handlerNames };
      } else if (message.method === "takeErrors") {
        value = handlerErrors.splice(0);
      } else {
        throw new Error(`unknown OMP native RPC method: ${message.method}`);
      }

      process.stdout.write(`${serialize({ kind: "result", id: message.id, ok: true, value })}\n`);
    } catch (error) { process.stdout.write(`${serialize({ kind: "result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`); }
  })().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; }); });
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>(); input.once("close", resolveClosed); await closed;
}

class NativeRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private stderr = "";
  constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly runtime: Record<string, unknown>) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { this.stderr = (this.stderr + String(chunk)).slice(-32_768); });
  }
  async start(): Promise<NativeRunnerState> {
    const { promise, resolve, reject } = Promise.withResolvers<NativeRunnerState>();
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on("line", line => { void this.receive(line, resolve, reject); });
    this.child.once("error", reject);
    this.child.once("exit", (code, signal) => {
      const message = `OMP Bun driver exited code=${code} signal=${signal}\n${this.stderr}`;
      for (const waiter of this.pending.values()) waiter.reject(new Error(message));
      this.pending.clear();
      reject(new Error(`OMP Bun driver exited before ready code=${code} signal=${signal}\n${this.stderr}`));
    });
    return promise;
  }
  private async receive(line: string, ready: (value: NativeRunnerState) => void, fail: (error: Error) => void): Promise<void> {
    try {
      if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) throw new Error("OMP native RPC message exceeds limit");
      const message = JSON.parse(line) as JsonObject;
      if (message.kind === "ready") {
        ready(message as unknown as NativeRunnerState);
        return;
      }
      if (message.kind === "result" && typeof message.id === "number") {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.ok === true) waiter.resolve(message.value);
        else waiter.reject(new Error(String(message.error)));
        return;
      }
      if (message.kind === "host-call" && typeof message.id === "number" && typeof message.method === "string") {
        try {
          const method = this.runtime[message.method];
          if (typeof method !== "function") throw new Error(`trusted OMP runtime method unavailable: ${message.method}`);
          const value = message.method === "registerRevoker"
            ? await (method as (callback: () => Promise<void>) => unknown)(async () => { await this.request("revoke", []); })
            : await (method as (...args: unknown[]) => unknown)(...(message.args as unknown[]));
          this.child.stdin.write(`${serialize({ kind: "host-result", id: message.id, ok: true, value })}\n`);
        } catch (error) { this.child.stdin.write(`${serialize({ kind: "host-result", id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`); }
      }
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  }
  request(method: string, args: unknown[]): Promise<unknown> {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const id = this.nextId++;
    this.pending.set(id, { resolve, reject });
    this.child.stdin.write(`${serialize({ kind: "request", id, method, args })}\n`);
    return promise;
  }
  async close(): Promise<void> {
    this.child.stdin.end();
    if (this.child.exitCode !== null) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.child.once("exit", () => resolve());
    await promise;
  }
}

export async function loadNativeRunner(loaderPath: string, runnerPath: string, extensionPath: string, cwd: string): Promise<NativeRunnerHarness> {
  const runtime = (globalThis as Record<PropertyKey, unknown>)[RUNTIME_KEY];
  if (!runtime || typeof runtime !== "object") throw new Error("trusted OMP runtime is unavailable before Bun driver launch");
  const child = spawn("bun", [fileURLToPath(import.meta.url), "--child", loaderPath, runnerPath, extensionPath, cwd], { cwd, env: { ...process.env, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? cwd, TZ: "UTC", LANG: "C" }, stdio: ["pipe", "pipe", "pipe"] });
  const client = new NativeRpcClient(child, runtime as Record<string, unknown>);
  const state = await client.start();
  const extension: LoadedExtension = {
    tools: new Map(state.toolNames.map(name => [name, { definition: {} }])),
    commands: new Map(state.commandNames.map(name => [name, {}])),
    handlers: new Map(state.handlerNames.map(name => [name, []])),
  };
  return {
    loaded: { extensions: [extension], errors: [], runtime: null },
    runner: {
      getRegisteredTool: name => state.toolNames.includes(name) ? { definition: { execute: (id, input) => client.request("invoke", [name, id, input]) } } : undefined,
      getCommand: name => state.commandNames.includes(name) ? {} : undefined,
      hasHandlers: name => state.handlerNames.includes(name),
      emit: event => client.request("emit", [event]),
      takeErrors: () => client.request("takeErrors", []) as Promise<Array<{ extensionPath: string; event: string; error: string }>>,
    },
    close: () => client.close(),
  };
}


if (process.argv[2] === "--child") await runChild(process.argv[3]!, process.argv[4]!, process.argv[5]!, process.argv[6]!);
