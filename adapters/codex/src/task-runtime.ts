import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { createNativeTaskSpoolV1, nativeRenderedContextDigestV1, nativeExecutableDigestV1, runNativeProcessV1, type NativeTaskTerminalV1, type NativeTaskAdapterOptionsV1, type NativeTaskAdapterSessionV1, type NativeTaskProfileOptionsV1 } from "@horseness/adapter-kit";
import { parseTaskEffortV1, taskExecutionProfileDigest, type TaskEffortV1, type TaskExecutionProfileV1 } from "@horseness/domain";
import { createCodexAdapterV1, CODEX_ADAPTER_ID, CODEX_HOST_VERSION } from "./index.js";
import type { AdapterLaunchRequestV1 } from "@horseness/protocol";
// Reviewed npm:@openai/codex@0.144.1-linux-x64 executable identity.
const EXECUTABLE_DIGEST = "a96f944d1a596dbfb7fdd84f482be5c50e34b04bb371126840d873e4ebf26902";
function environment(): Record<string, string> {
  if (!process.env.HOME) throw new Error("NATIVE_HOME_REQUIRED");
  const result: Record<string, string> = { HOME: process.env.HOME, PATH: process.env.PATH ?? "/usr/bin:/bin" };
  for (const key of ["LANG", "LC_ALL", "TZ", "CODEX_HOME"]) { const value = process.env[key]; if (value) result[key] = value; }
  return result;
}
export async function resolveCodexTaskProfileV1(options: NativeTaskProfileOptionsV1): Promise<TaskExecutionProfileV1> {
  options = structuredClone(options);
  const effort = parseTaskEffortV1(options.effort === undefined ? "medium" : options.effort);
  if (!options.model || !/^[a-z0-9][a-z0-9.-]{1,127}$/.test(options.model) || ["default", "auto"].includes(options.model)) throw new Error("MODEL_REQUIRED");
  const path = await realpath(options.executablePath ?? join(process.env.HOME ?? "", ".local/bin/codex"));
  if (await nativeExecutableDigestV1(path) !== EXECUTABLE_DIGEST) throw new Error("UNSUPPORTED_NATIVE_HOST: expected verified Codex 0.144.1-linux-x64; configure the daemon trusted executablePath override to its pinned executable");
  const version = await runNativeProcessV1({ executablePath: path, args: ["--version"], cwd: options.workspacePath, timeoutMs: 10_000, maxOutputBytes: 4096, env: environment() });
  if (version.exitCode !== 0 || version.stdout.trim() !== "codex-cli 0.144.1") throw new Error("UNSUPPORTED_NATIVE_HOST: expected Codex 0.144.1-linux-x64; configure the daemon trusted executablePath override");
  const observation = { advertised: false, effortSupported: false };
  await runNativeProcessV1({ executablePath: path, args: ["app-server", "--stdio", "--strict-config"], cwd: options.workspacePath, timeoutMs: 10_000, maxOutputBytes: 262_144, env: environment(), input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "horseness-profile", version: "0.1.0" }, capabilities: { experimentalApi: true } } })}\n`, onLine(line, write, end) {
    const message = object(JSON.parse(line));
    if (message.error !== undefined) throw new Error("NATIVE_MODEL_METADATA_UNAVAILABLE");
    if (message.id === 1 && message.result !== undefined) {
      write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
      write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "model/list", params: { includeHidden: false, limit: 100 } })}\n`);
    } else if (message.id === 2 && message.result !== undefined) {
      const result = object(message.result);
      if (!Array.isArray(result.data)) throw new Error("NATIVE_MODEL_METADATA_UNAVAILABLE");
      const selectedValue:unknown = result.data.find(item => object(item).model === options.model);
      const selected = selectedValue === undefined ? undefined : object(selectedValue);
      observation.advertised = selected !== undefined;
      observation.effortSupported = selected !== undefined && Array.isArray(selected.supportedReasoningEfforts) && selected.supportedReasoningEfforts.some(item => object(item).reasoningEffort === effort);
      end();
    }
  } });
  if (!observation.advertised) throw new Error("UNSUPPORTED_NATIVE_MODEL: select a concrete model advertised by the supported Codex native host");
  if (!observation.effortSupported) throw new Error("UNSUPPORTED_NATIVE_EFFORT: selected model does not advertise the requested reasoning effort");
  return Object.freeze({ schemaVersion: "1", adapterId: "codex", hostId: "codex", hostVersion: CODEX_HOST_VERSION, nativeExecutablePath: path, nativeExecutableDigest: await nativeExecutableDigestV1(path), providerId: "openai", modelId: options.model, purpose: options.purpose, effort, timeoutMs: options.timeoutMs ?? 120_000, maxOutputBytes: 1_048_576, lookup: "local-terminal-record", idempotentLaunch: false });
}
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CODEX_PROTOCOL_INVALID"); return value as Record<string, unknown>; };
export function createCodexTaskParserV1(model: string, context: string, cwd: string, purpose: "work" | "planner" = "work", effort?: TaskEffortV1) {
  if (effort !== undefined) parseTaskEffortV1(effort);
  let threadId = ""; let turnId = ""; let observedModel = ""; let terminal: Record<string, unknown> | null = null;
  const permissions = purpose === "work" ? ":workspace-write" : ":read-only";
  let denied = false;
  let initialized = false;
  let inventoryRequested = false; let inventoryVerified = false; let confinementFailed = false;
  const texts = new Map<string, string>();
  return {
    initialize: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "horseness-task", version: "0.1.0" }, capabilities: { experimentalApi: true } } })}\n`,
    onLine: (line: string, write: (input: string) => void, end: () => void) => {
      const message = object(JSON.parse(line));
      if (confinementFailed) throw new Error("CODEX_TOOL_CONFINEMENT_FAILED");
      if (message.error !== undefined) { if (!inventoryVerified) confinementFailed = true; throw new Error("CODEX_NATIVE_RPC_ERROR"); }
      if (message.id === 1 && message.result !== undefined) {
        if (initialized) throw new Error("CODEX_INITIALIZE_AMBIGUOUS");
        initialized = true;
        write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
        write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "thread/start", params: { model, modelProvider: "openai", cwd, ephemeral: true, approvalPolicy: "never", permissions, environments: [], dynamicTools: [], config: { web_search: "disabled", "features.apps": false, "features.enable_mcp_apps": false, "features.plugins": false, "features.shell_tool": purpose === "work", "features.unified_exec": purpose === "work", "features.code_mode": false, "features.code_mode_host": false, "features.code_mode_only": false, "features.standalone_web_search": false, "features.web_search_request": false, "features.web_search_cached": false, "features.tool_suggest": false, "features.multi_agent": false, "features.multi_agent_v2": false, "features.enable_fanout": false, include_environment_context: false, include_collaboration_mode_instructions: false, "skills.include_instructions": false }, developerInstructions: context } })}\n`);
      } else if (message.id === 2 && message.result !== undefined) {
        const result = object(message.result); const thread = object(result.thread);
        if (!initialized || threadId || typeof thread.id !== "string" || !thread.id || result.model !== model || result.modelProvider !== "openai") throw new Error("CODEX_THREAD_MODEL_BINDING_MISMATCH");
        threadId = thread.id; observedModel = result.model;
        inventoryRequested = true;
        write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "mcpServerStatus/list", params: { threadId, detail: "full" } })}\n`);
      } else if (message.id === 4 && message.result !== undefined) {
        // Native status inventory is nonsecret; never inspect auth/config stores. No
        // ambient server is approved for receipt-only work, even one with zero tools.
        confinementFailed = true;
        const inventory = object(message.result);
        if (!inventoryRequested || inventoryVerified || !threadId || !Array.isArray(inventory.data) || inventory.data.length !== 0 || inventory.nextCursor !== null) throw new Error("CODEX_TOOL_CONFINEMENT_FAILED");
        inventoryVerified = true; confinementFailed = false;
        write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { threadId, model, ...(effort === undefined ? {} : { effort }), approvalPolicy: "never", permissions, environments: [], input: [{ type: "text", text: "Execute the bound task in the supplied developer context and return its final output.", text_elements: [] }] } })}\n`);
      } else if (message.id === 3 && message.result !== undefined) {
        if (!inventoryVerified) { confinementFailed = true; throw new Error("CODEX_TOOL_CONFINEMENT_FAILED"); }
        const turn = object(object(message.result).turn);
        if (turnId || typeof turn.id !== "string" || !turn.id) throw new Error("CODEX_TURN_BINDING_MISMATCH");
        turnId = turn.id;
      } else if (message.method === "item/completed" || message.method === "turn/completed") {
        const params = object(message.params);
        if (!threadId || params.threadId !== threadId) throw new Error("CODEX_THREAD_BINDING_MISMATCH");
        if (message.method === "item/completed") {
          if (!turnId || params.turnId !== turnId || terminal) throw new Error("CODEX_TURN_BINDING_MISMATCH");
          const item = object(params.item);
          if (item.status === "failed" || item.status === "declined" || item.error != null || (typeof item.exitCode === "number" && item.exitCode !== 0)) denied = true;
          if (item.type === "agentMessage") {
            if (typeof item.id !== "string" || typeof item.text !== "string") throw new Error("CODEX_OUTPUT_INVALID");
            const prior = texts.get(item.id); if (prior !== undefined && prior !== item.text) throw new Error("CODEX_ITEM_CONFLICT");
            texts.set(item.id, item.text);
          }
        } else {
          const turn = object(params.turn);
          if (terminal || !turnId || turn.id !== turnId) throw new Error("CODEX_TERMINAL_AMBIGUOUS");
          if (turn.model !== undefined && turn.model !== observedModel) throw new Error("NATIVE_MODEL_MISMATCH");
          terminal = turn; end();
        }
      } else if (typeof message.id === "number" && typeof message.method === "string") {
        denied = true;
        write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Interactive approval is not authorized" } })}\n`);
      }
    },
    finish(exitCode: number | null) {
      if (!terminal || !threadId || !turnId || !observedModel) throw new Error("CODEX_TERMINAL_MISSING");
      const status = terminal.status;
      if (!["completed", "failed", "interrupted"].includes(String(status))) throw new Error("CODEX_TERMINAL_INVALID");
      return { nativeSessionId: threadId, providerOperationId: `${threadId}:${turnId}`, model: observedModel, outcome: status === "interrupted" ? "cancelled" as const : status === "completed" && exitCode === 0 && !denied ? "succeeded" as const : "failed" as const, output: [...texts.values()].join("\n"), terminal: denied ? "native_tool_denied_or_failed" : String(status) };
    },
  };
}
export async function createCodexTaskAdapterV1(options: NativeTaskAdapterOptionsV1): Promise<NativeTaskAdapterSessionV1> {
  options = structuredClone(options);
  const profile = options.profile;
  if (profile.adapterId !== "codex" || profile.hostId !== "codex" || profile.hostVersion !== CODEX_HOST_VERSION || profile.providerId !== "openai" || profile.modelId !== options.model || profile.purpose !== options.purpose || profile.idempotentLaunch || profile.lookup !== "local-terminal-record") throw new Error("NATIVE_PROFILE_MISMATCH");
  if (profile.nativeExecutableDigest !== EXECUTABLE_DIGEST) throw new Error("NATIVE_PROFILE_MISMATCH");
  const spool = await createNativeTaskSpoolV1(options); const controller = new AbortController();
  let active: Promise<NativeTaskTerminalV1 | null> | null = null;
  const collect = async () => active ? await active : await spool.load();
  const runtime = {
    detectCapabilities() { return Promise.resolve({ schemaVersion: "1" as const, adapterId: CODEX_ADAPTER_ID, providerId: profile.providerId, launch: true, cancel: true, reconcile: "supported" as const, reattach: "unsupported" as const, nativeResume: "unsupported" as const, contextInjection: "bytes" as const, receiptCollection: true as const, maxContextBytes: 1_048_576, outputMediaTypes: ["text/plain", "application/json"], evidenceMediaTypes: ["application/json"] }); },
    async launch(request: AdapterLaunchRequestV1) {
      if (request.renderedContextDigest !== nativeRenderedContextDigestV1(options.renderedContext)) throw new Error("NATIVE_CONTEXT_BINDING_MISMATCH");
      const retained = await spool.load(); if (retained) return retained;
      if (await nativeExecutableDigestV1(profile.nativeExecutablePath) !== EXECUTABLE_DIGEST) throw new Error("NATIVE_EXECUTABLE_CHANGED");
      await spool.begin();
      const launching = (async () => {
        const startedAt = new Date().toISOString(); const parser = createCodexTaskParserV1(profile.modelId, options.renderedContext, options.workspacePath, profile.purpose, profile.effort);
        const wire = await runNativeProcessV1({ executablePath: profile.nativeExecutablePath, args: ["app-server", "--stdio", "--strict-config"], input: parser.initialize, onLine: parser.onLine, cwd: options.workspacePath, env: environment(), timeoutMs: profile.timeoutMs, maxOutputBytes: profile.maxOutputBytes, signal: controller.signal });
        const parsed = parser.finish(wire.exitCode);
        const outputDigest = parsed.outcome === "succeeded" ? await spool.publish(Buffer.from(parsed.output), options.purpose === "planner" ? "application/json" : "text/plain") : null;
        const evidenceBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, profileDigest: taskExecutionProfileDigest(profile), hostId: profile.hostId, hostVersion: profile.hostVersion, modelId: parsed.model, nativeSessionId: parsed.nativeSessionId, terminal: parsed.terminal, exitCode: wire.exitCode, ...(parsed.outcome === "succeeded" ? {} : { diagnostics: parsed.output }) }));
        const evidenceDigest = await spool.publish(evidenceBytes, "application/json");
        const record: NativeTaskTerminalV1 = { providerOperationId: parsed.providerOperationId, nativeSessionId: parsed.nativeSessionId, startedAt, finishedAt: new Date().toISOString(), outcome: parsed.outcome, outputDigest, evidence: [{ digest: evidenceDigest, mediaType: "application/json", size: evidenceBytes.byteLength }], provenance: { profileDigest: taskExecutionProfileDigest(profile), observedHostId: profile.hostId, observedHostVersion: profile.hostVersion, observedProviderId: profile.providerId, observedModelId: parsed.model, nativeSessionId: parsed.nativeSessionId, exitCode: wire.exitCode } };
        await spool.save(record); return record;
      })().catch((error: unknown) => { const reason = error instanceof Error ? /^[A-Z][A-Z0-9_]+/.exec(error.message)?.[0] : undefined; throw new Error(`UNKNOWN_OUTCOME: ${reason ?? "NATIVE_TERMINAL_UNAVAILABLE"}`); }); active = launching; return await launching;
    },
    async cancel() { controller.abort(); if (active) { try { await active; } catch { /* Interrupted handoff remains unknown. */ } } const record = await spool.load(); if (!record) throw new Error("UNKNOWN_OUTCOME"); return record; },
    async reconcile() { const record = await collect(); if (!record) throw new Error("UNKNOWN_OUTCOME"); return record; },
    async resume() { const record = await collect(); if (!record) throw new Error("UNKNOWN_OUTCOME"); return record; }, collect,
  };
  const adapter = createCodexAdapterV1({ binding: options.binding, credential: { schemaVersion: "1", kind: "host-reference", reference: options.binding.attemptCapability, scope: { workspaceId: options.binding.workspaceId, adapterId: CODEX_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: options.producerPrincipalId, producerGrantDigest: options.producerGrantDigest });
  return { adapter, publication: digest => spool.publication(digest), async close() { controller.abort(); if (active) { try { await active; } catch { /* Durable marker preserves ambiguity. */ } } await spool.close(); } };
}
