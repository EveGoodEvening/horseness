import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { createNativeTaskSpoolV1, nativeRenderedContextDigestV1, nativeExecutableDigestV1, runNativeProcessV1, type NativeTaskTerminalV1, type NativeTaskAdapterOptionsV1, type NativeTaskAdapterSessionV1, type NativeTaskProfileOptionsV1 } from "@horseness/adapter-kit";
import { taskExecutionProfileDigest, type TaskExecutionProfileV1 } from "@horseness/domain";
import { createClaudeAdapterV1, CLAUDE_ADAPTER_ID, CLAUDE_HOST_VERSION } from "./index.js";
import type { AdapterLaunchRequestV1 } from "@horseness/protocol";

// Reviewed npm:@anthropic-ai/claude-code-linux-x64@2.1.228 executable identity.
const EXECUTABLE_DIGEST = "d535985e6941a3eb00179ccd7f52ceb0c6623a0305a518ebc4e6514f84a94c99";
function environment(): Record<string, string> {
  if (!process.env.HOME) throw new Error("NATIVE_HOME_REQUIRED");
  const result: Record<string, string> = { HOME: process.env.HOME, PATH: process.env.PATH ?? "/usr/bin:/bin" };
  for (const key of ["LANG", "LC_ALL", "TZ"]) if (process.env[key]) result[key] = process.env[key]!;
  return result;
}
export async function resolveClaudeTaskProfileV1(options: NativeTaskProfileOptionsV1): Promise<TaskExecutionProfileV1> {
  options = structuredClone(options);
  if (!options.model || !/^claude-[a-z0-9]+(?:-[a-z0-9]+)*-\d{8}$/.test(options.model)) throw new Error("MODEL_REQUIRED");
  const path = await realpath(options.executablePath ?? join(process.env.HOME ?? "", ".local/bin/claude"));
  if (await nativeExecutableDigestV1(path) !== EXECUTABLE_DIGEST) throw new Error("UNSUPPORTED_NATIVE_HOST: expected verified Claude Code 2.1.228; configure the daemon trusted executablePath override to its pinned executable");
  const version = await runNativeProcessV1({ executablePath: path, args: ["--version"], cwd: options.workspacePath, timeoutMs: 10_000, maxOutputBytes: 4096, env: environment() });
  if (version.exitCode !== 0 || version.stdout.trim() !== `${CLAUDE_HOST_VERSION} (Claude Code)`) throw new Error("UNSUPPORTED_NATIVE_HOST: expected Claude Code 2.1.228; configure the daemon trusted executablePath override");
  return Object.freeze({ schemaVersion: "1", adapterId: "claude", hostId: "claude", hostVersion: CLAUDE_HOST_VERSION, nativeExecutablePath: path, nativeExecutableDigest: await nativeExecutableDigestV1(path), providerId: "anthropic", modelId: options.model, purpose: options.purpose, timeoutMs: options.timeoutMs ?? 120_000, maxOutputBytes: 1_048_576, lookup: "local-terminal-record", idempotentLaunch: false });
}
export function parseClaudeTaskTerminalV1(stdout: string, model: string, exitCode: number | null) {
  const messages: Record<string, unknown>[] = stdout.split("\n").filter(line => line.trim()).map(line => {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CLAUDE_STREAM_INVALID");
    return value as Record<string, unknown>;
  });
  const init = messages.filter(item => item.type === "system" && item.subtype === "init");
  const terminal = messages.filter(item => item.type === "result");
  if (init.length !== 1 || terminal.length !== 1 || messages.at(-1) !== terminal[0]) throw new Error("CLAUDE_TERMINAL_AMBIGUOUS");
  const first = init[0]!; const last = terminal[0]!;
  if (typeof first.session_id !== "string" || !first.session_id || last.session_id !== first.session_id) throw new Error("CLAUDE_SESSION_BINDING_MISMATCH");
  if (typeof first.model !== "string" || !first.model) throw new Error("CLAUDE_MODEL_UNOBSERVABLE");
  let denied = Array.isArray(last.permission_denials) && last.permission_denials.length > 0;
  const pending: unknown[] = [...messages];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) { pending.push(...value); continue; }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === "tool_result" && record.is_error === true) denied = true;
      pending.push(...Object.values(record));
    }
  }
  const success = exitCode === 0 && last.subtype === "success" && last.is_error === false && !denied;
  if (success && first.model !== model) throw new Error("NATIVE_MODEL_MISMATCH");
  if (success && typeof last.result !== "string") throw new Error("CLAUDE_OUTPUT_MISSING");
  return { nativeSessionId: first.session_id, model: first.model, outcome: success ? "succeeded" as const : "failed" as const, output: typeof last.result === "string" ? last.result : "", terminal: String(last.subtype ?? "unknown") };
}
export async function createClaudeTaskAdapterV1(options: NativeTaskAdapterOptionsV1): Promise<NativeTaskAdapterSessionV1> {
  options = structuredClone(options);
  const profile = options.profile;
  if (profile.adapterId !== "claude" || profile.hostId !== "claude" || profile.hostVersion !== CLAUDE_HOST_VERSION || profile.providerId !== "anthropic" || profile.modelId !== options.model || profile.purpose !== options.purpose || profile.idempotentLaunch || profile.lookup !== "local-terminal-record") throw new Error("NATIVE_PROFILE_MISMATCH");
  if (profile.nativeExecutableDigest !== EXECUTABLE_DIGEST) throw new Error("NATIVE_PROFILE_MISMATCH");
  const spool = await createNativeTaskSpoolV1(options);
  const controller = new AbortController();
  let active: Promise<NativeTaskTerminalV1 | null> | null = null;
  const collect = async () => active ? await active : await spool.load();
  const runtime = {
    async detectCapabilities() { return { schemaVersion: "1" as const, adapterId: CLAUDE_ADAPTER_ID, providerId: profile.providerId, launch: true, cancel: true, reconcile: "supported" as const, reattach: "unsupported" as const, nativeResume: "unsupported" as const, contextInjection: "bytes" as const, receiptCollection: true as const, maxContextBytes: 1_048_576, outputMediaTypes: ["text/plain", "application/json"], evidenceMediaTypes: ["application/json"] }; },
    async launch(request: AdapterLaunchRequestV1) {
      if (request.renderedContextDigest !== nativeRenderedContextDigestV1(options.renderedContext)) throw new Error("NATIVE_CONTEXT_BINDING_MISMATCH");
      const retained = await spool.load(); if (retained) return retained;
      if (await nativeExecutableDigestV1(profile.nativeExecutablePath) !== EXECUTABLE_DIGEST) throw new Error("NATIVE_EXECUTABLE_CHANGED");
      await spool.begin();
      active = (async () => {
        const startedAt = new Date().toISOString();
        const wire = await runNativeProcessV1({ executablePath: profile.nativeExecutablePath, args: ["-p", "--output-format", "stream-json", "--verbose", "--model", profile.modelId, ...(profile.purpose === "planner" ? ["--tools", ""] : ["--permission-mode", "acceptEdits"]), "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--setting-sources", "", "--disable-slash-commands"], input: options.renderedContext, cwd: options.workspacePath, env: environment(), timeoutMs: profile.timeoutMs, maxOutputBytes: profile.maxOutputBytes, signal: controller.signal });
        const parsed = parseClaudeTaskTerminalV1(wire.stdout, profile.modelId, wire.exitCode);
        const outputDigest = parsed.outcome === "succeeded" ? await spool.publish(Buffer.from(parsed.output), options.purpose === "planner" ? "application/json" : "text/plain") : null;
        const evidenceBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, profileDigest: taskExecutionProfileDigest(profile), hostId: profile.hostId, hostVersion: profile.hostVersion, modelId: parsed.model, nativeSessionId: parsed.nativeSessionId, terminal: parsed.terminal, exitCode: wire.exitCode, ...(parsed.outcome === "succeeded" ? {} : { diagnostics: parsed.output }) }));
        const evidenceDigest = await spool.publish(evidenceBytes, "application/json");
        const record: NativeTaskTerminalV1 = { providerOperationId: parsed.nativeSessionId, nativeSessionId: parsed.nativeSessionId, startedAt, finishedAt: new Date().toISOString(), outcome: parsed.outcome, outputDigest, evidence: [{ digest: evidenceDigest, mediaType: "application/json", size: evidenceBytes.byteLength }], provenance: { profileDigest: taskExecutionProfileDigest(profile), observedHostId: profile.hostId, observedHostVersion: profile.hostVersion, observedProviderId: profile.providerId, observedModelId: parsed.model, nativeSessionId: parsed.nativeSessionId, exitCode: wire.exitCode } };
        await spool.save(record); return record;
      })().catch((error: unknown) => { const reason = error instanceof Error ? error.message.match(/^[A-Z][A-Z0-9_]+/)?.[0] : undefined; throw new Error(`UNKNOWN_OUTCOME: ${reason ?? "NATIVE_TERMINAL_UNAVAILABLE"}`); });
      return (await active)!;
    },
    async cancel() { controller.abort(); if (active) { try { await active; } catch { /* Interrupted handoff remains unknown, never relaunch. */ } } const record = await spool.load(); if (!record) throw new Error("UNKNOWN_OUTCOME"); return record; },
    async reconcile() { const record = await collect(); if (!record) throw new Error("UNKNOWN_OUTCOME"); return record; },
    async resume() { const record = await collect(); if (!record) throw new Error("UNKNOWN_OUTCOME"); return record; },
    collect,
  };
  const adapter = createClaudeAdapterV1({ binding: options.binding, credential: { schemaVersion: "1", kind: "host-reference", reference: options.binding.attemptCapability, scope: { workspaceId: options.binding.workspaceId, adapterId: CLAUDE_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: options.producerPrincipalId, producerGrantDigest: options.producerGrantDigest });
  return { adapter, publication: digest => spool.publication(digest), async close() { controller.abort(); if (active) { try { await active; } catch { /* Durable handoff marker preserves ambiguity. */ } } await spool.close(); } };
}
