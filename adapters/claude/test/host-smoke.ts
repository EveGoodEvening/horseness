import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:net";
import { cp, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sealProposal, type JsonValue, type ProposalEnvelopeCoreV1 } from "@horseness/domain";
import type { BoundAdapterOperationV1, WorkerReturnV1 } from "@horseness/protocol";
import type { WorkerReturnClientV1, WorkerReturnDecisionV1 } from "@horseness/adapter-kit";
import { acquireUpstreamArtifact, verifyOfficialValidation, type C11HostFixtureV1 } from "./c11-upstream-artifact.mjs";
import { CLAUDE_ADAPTER_ID, CLAUDE_NATIVE_PACKAGE_METADATA, createClaudeAdapterV1, createClaudeNativeContributionRuntimeV1, createClaudeRetainedDeliveryAuthorityV1, type ClaudeNativeAttemptV1, type ClaudeNativeRuntimeV1, type ClaudeWorkerReturnRegistrationV1 } from "../src/index.js";

const MAX_WALL_MS = 120_000;
const MAX_STREAM_BYTES = 256 * 1024;
const OUTPUT_TEXT = "value2";
const EVIDENCE_CLAIM = "Claude Code model invoked the native Horseness MCP contribution";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fixturePath = fileURLToPath(new URL("../../../tests/fixtures/hosts/claude/manifest.v1.json", import.meta.url));
const pluginSource = fileURLToPath(new URL("../native/plugin", import.meta.url));
const redactedReason = (value: unknown) => {
  const text = value instanceof Error ? value.message : String(value);
  if (/^(?:CLAUDE|HORSENESS|INVALID|UNKNOWN)_[A-Z0-9_]+$/.test(text)) return text;
  if (/login|\bauth\b|authentication|credential|token|subscription|unauthorized|forbidden/i.test(text)) return "CLAUDE_SUBSCRIPTION_SESSION_UNUSABLE";
  if (/timed? ?out|timeout/i.test(text)) return "CLAUDE_NATIVE_TIMEOUT";
  if (/mcp|server.*failed|connection.*closed/i.test(text)) return "CLAUDE_NATIVE_MCP_UNAVAILABLE";
  if (/hook|context/i.test(text)) return "CLAUDE_NATIVE_CONTEXT_FAILED";
  if (/allowed.?tools?|unknown tool/i.test(text)) return "CLAUDE_NATIVE_INVENTORY_INVALID";
  if (/stream|session.id/i.test(text)) return "CLAUDE_NATIVE_STREAM_INVALID";
  if (/proposal|envelope/i.test(text)) return "CLAUDE_WORKER_PROPOSAL_FAILED";
  if (/output digest/i.test(text)) return "CLAUDE_WORKER_OUTPUT_DIGEST_MISMATCH";
  if (/evidence digest/i.test(text)) return "CLAUDE_WORKER_EVIDENCE_DIGEST_MISMATCH";
  if (/evidence descriptor/i.test(text)) return "CLAUDE_WORKER_EVIDENCE_DESCRIPTOR_MISMATCH";
  if (/receipt|provider output|evidence/i.test(text)) return "CLAUDE_WORKER_RECEIPT_FAILED";
  if (/retained|compare-and-set|lock/i.test(text)) return "CLAUDE_WORKER_RETAINED_FAILED";
  if (/decision|resume/i.test(text)) return "CLAUDE_WORKER_DECISION_FAILED";
  if (/binding|capability/i.test(text)) return "CLAUDE_WORKER_BINDING_FAILED";
  return "CLAUDE_NATIVE_HOST_FAILED";
};

type StreamObservation = { sessionId: string; init: Record<string, unknown>; toolUses: number; toolResults: number; hookContext: boolean; result: Record<string, unknown> };
function countWireNodes(value: unknown, predicate: (node: Record<string, unknown>) => boolean): number {
  if (Array.isArray(value)) {
    let total = 0;
    for (const item of value) total += countWireNodes(item, predicate);
    return total;
  }
  if (value === null || typeof value !== "object") return 0;
  const node = value as Record<string, unknown>;
  let total = predicate(node) ? 1 : 0;
  for (const item of Object.values(node)) total += countWireNodes(item, predicate);
  return total;
}
async function runClaude(binary: string, cwd: string, plugin: string, contextFile: string, socket: string, nonce: string, prompt: string, session?: { resume: string; fork?: boolean }): Promise<StreamObservation> {
  const tool = "mcp__plugin_horseness-claude_horseness-worker__horseness_worker_return";
  const args = ["-p", prompt, "--plugin-dir", plugin, "--output-format", "stream-json", "--verbose", "--max-turns", "3", "--allowedTools", tool];
  if (session !== undefined) { args.push("--resume", session.resume); if (session.fork) args.push("--fork-session"); }
  const child = spawn(binary, args, { cwd, env: { ...process.env, HORSENESS_CLAUDE_CONTEXT_FILE: contextFile, HORSENESS_CLAUDE_RUNTIME_SOCKET: socket, HORSENESS_CLAUDE_RUNTIME_NONCE: nonce }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > MAX_STREAM_BYTES) child.kill("SIGKILL"); });
  child.stderr.on("data", chunk => { stderr += chunk; if (Buffer.byteLength(stderr) > MAX_STREAM_BYTES) child.kill("SIGKILL"); });
  const timer = setTimeout(() => child.kill("SIGKILL"), MAX_WALL_MS);
  const status = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>(resolveStatus => { child.once("error", error => resolveStatus({ code: null, signal: null, error })); child.once("close", (code, signal) => resolveStatus({ code, signal })); });
  clearTimeout(timer);
  if (status.error !== undefined) throw new Error(redactedReason(status.error));
  if (status.signal !== null) throw new Error(`CLAUDE_NATIVE_SIGNAL_${status.signal}`);
  if (status.code !== 0) {
    const stableToolCode = stdout.match(/(?:HORSENESS|INVALID|UNKNOWN)_[A-Z0-9_]+/)?.[0];
    if (stableToolCode !== undefined) throw new Error(stableToolCode);
    try {
      const envelopes = stdout.split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
      const terminal = envelopes.findLast(message => message.type === "result");
      const subtype = typeof terminal?.subtype === "string" ? terminal.subtype.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase() : "MISSING";
      throw new Error(`CLAUDE_RESULT_${subtype}_EXIT_${status.code ?? "NONE"}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("CLAUDE_RESULT_")) throw error;
      throw new Error(`${redactedReason(stderr)}_EXIT_${status.code ?? "NONE"}`);
    }
  }
  let messages: Record<string, unknown>[];
  try { messages = stdout.split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>); }
  catch { throw new Error("CLAUDE_STREAM_JSON_INVALID"); }
  const init = messages.find(message => message.type === "system" && message.subtype === "init");
  const result = messages.findLast(message => message.type === "result");
  if (init === undefined || result === undefined) throw new Error("CLAUDE_STREAM_CONTRACT_INVALID");
  const serialized = JSON.stringify(messages);
  const toolUses = countWireNodes(messages, node => node.type === "tool_use" && node.name === tool);
  const stableToolFailure = serialized.match(/(?:CLAUDE|HORSENESS|INVALID|UNKNOWN)_[A-Z0-9_]+/)?.[0];
  if (stableToolFailure !== undefined) throw new Error(stableToolFailure);
  if (countWireNodes(messages, node => node.type === "tool_result" && node.is_error === true) > 0) throw new Error("CLAUDE_NATIVE_TOOL_RESULT_ERROR");
  const toolResults = countWireNodes(messages, node => node.type === "tool_result");
  const sessionId = String(result.session_id ?? init.session_id ?? "");
  if (sessionId.length === 0) throw new Error("CLAUDE_SESSION_ID_MISSING");
  return { sessionId, init, toolUses, toolResults, hookContext: serialized.includes("horseness-context-v1"), result };
}

function bindingFor(outcome: string, suffix = ""): BoundAdapterOperationV1 {
  return { schemaVersion: "1", workspaceId: `claude-${outcome}`, runId: "run", taskId: "task", attemptId: `attempt${suffix}`, generation: 1, forkPinDigest: sha(`fork-${outcome}-${suffix}`), contextManifestCoreDigest: sha(`manifest-${outcome}-${suffix}`), attemptContextBindingDigest: sha(`binding-${outcome}-${suffix}`), providerIdempotencyKeyDigest: sha(`key-${outcome}-${suffix}`), attemptCapability: `claude-attempt-${outcome}${suffix}` };
}
function proposalFor(binding: BoundAdapterOperationV1, receipt: WorkerReturnV1["receipt"]) {
  const cursor = { schemaVersion: "1", kind: "composite", workspaceId: binding.workspaceId, workspaceSequence: 1, workspaceEnvelopeHash: "workspace-head", workspaceContextEpoch: 0, runId: binding.runId, runSequence: 1, runEnvelopeHash: "run-head", runContextEpoch: 0 } as const;
  const contextVersion = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 0, runContextEpoch: 0, observationCursor: cursor } as const;
  const core: ProposalEnvelopeCoreV1 = { schemaVersion: "1", workspaceId: binding.workspaceId, runId: binding.runId, authorPrincipalId: "worker", authorGrantDigest: "grant", attemptId: binding.attemptId, receiptDigests: [receipt.receiptDigest], forkPinDigest: binding.forkPinDigest, deltaAuthorityScopeDigest: sha("scope"), baseRevision: 0, baseStateHash: sha("state-1"), canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", proposalSealingObservationCursor: cursor, proposalSealingContextVersion: contextVersion, operations: [{ op: "replace", path: "/value", expectedValueDigest: sha("1"), value: 2 }], evidenceClaims: [], pinnedPolicyDigest: sha("policy"), currentPolicyDigest: sha("policy"), nonce: `nonce-${binding.attemptId}`, predecessorProposalDigest: null, predecessorReason: null };
  return sealProposal(core);
}
class DecisionAuthority {
  readonly publicationKinds: string[] = [];
  readonly calls = { publications: 0, receipts: 0, proposals: 0, starts: 0, observations: 0 };
  canonicalRevision = 0;
  canonicalDocument: JsonValue = { value: 1 };
  constructor(readonly outcome: WorkerReturnDecisionV1) {}
  client(): WorkerReturnClientV1 {
    return {
      publishObject: async (_digest, kind) => { this.calls.publications++; this.publicationKinds.push(kind); },
      submitReceipt: async receipt => { this.calls.receipts++; return receipt.receiptDigest; },
      submitProposal: async proposal => { this.calls.proposals++; if (this.outcome === "accepted") { this.canonicalRevision = 1; this.canonicalDocument = { value: 2 }; } return { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }; },
      startDecisionSubscription: async input => { this.calls.starts++; assert.equal(input.resumeToken, null); return { resumeToken: `claude-resume-${this.outcome}` }; },
      observeDecision: async input => { this.calls.observations++; return { resumeToken: input.resumeToken, decision: this.outcome }; },
    };
  }
}
async function runtimeServer(path: string, nonce: string, runtimes: Map<string, ReturnType<typeof createClaudeNativeContributionRuntimeV1>>): Promise<Server> {
  await unlink(path).catch(() => undefined);
  const server = createServer({ allowHalfOpen: true }, socket => {
    socket.setEncoding("utf8"); let wire = "";
    socket.on("error", () => undefined);
    socket.on("data", chunk => { wire += chunk; if (Buffer.byteLength(wire) > 64 * 1024) socket.destroy(); });
    socket.on("end", async () => {
      try {
        const request = JSON.parse(wire) as { schemaVersion: string; nonce: string; input: { attemptCapabilityReference: string; output: { digest: string; mediaType: string; byteLength: number }; evidence: { digest: string; mediaType: string; byteLength: number } } };
        if (request.schemaVersion !== "HorsenessClaudeRuntimeRequestV1" || request.nonce !== nonce) throw new Error("HORSENESS_RUNTIME_AUTHORITY_REJECTED");
        const runtime = runtimes.get(request.input.attemptCapabilityReference);
        if (runtime === undefined) throw new Error("HORSENESS_ATTEMPT_GRANT_REVOKED");
        const result = await runtime.deliver(request.input.attemptCapabilityReference, request.input.output, request.input.evidence);
        socket.end(`${JSON.stringify({ schemaVersion: "HorsenessClaudeRuntimeResponseV1", ok: true, result })}\n`);
      } catch (error) { socket.end(`${JSON.stringify({ schemaVersion: "HorsenessClaudeRuntimeResponseV1", ok: false, reason: redactedReason(error) })}\n`); }
    });
  });
  await new Promise<void>((resolveListen, reject) => server.once("error", reject).listen(path, resolveListen));
  return server;
}

const cacheParent = join(tmpdir(), "horseness-claude-smoke");
await mkdir(cacheParent, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(cacheParent, "run-"));
let server: Server | undefined;
let smokeStage = "acquire";
try {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as C11HostFixtureV1;
  const acquired = await acquireUpstreamArtifact(fixture.artifact, { cacheRoot: resolve(process.env.HORSENESS_HOST_CACHE ?? ".cache/horseness/hosts") });
  smokeStage = "official-validation";
  const official = await verifyOfficialValidation(fixture, acquired);
  const binary = official.executablePath;
  assert.equal(`sha256:${sha(await readFile(binary))}`, fixture.artifact.executable.sha256);
  smokeStage = "plugin-validation";
  const plugin = join(root, "plugin"); await cp(pluginSource, plugin, { recursive: true });
  const validation = spawn(binary, ["plugin", "validate", plugin], { stdio: ["ignore", "ignore", "pipe"] });
  let validationError = ""; validation.stderr.setEncoding("utf8"); validation.stderr.on("data", chunk => validationError += chunk);
  const validationCode = await new Promise<number | null>(resolveCode => validation.once("close", resolveCode));
  assert.equal(validationCode, 0, redactedReason(validationError));
  smokeStage = "subscription-preflight-setup";
  const preflightContext = join(root, "preflight-context.json");
  smokeStage = "subscription-preflight-context-write";
  await writeFile(preflightContext, JSON.stringify({ schemaVersion: "HorsenessClaudeContextV1", renderedContext: "preflight only; do not call tools" }), { mode: 0o600 });
  smokeStage = "subscription-preflight-server";
  const preflightSocket = join(root, "preflight.sock"); const preflightNonce = randomBytes(32).toString("hex");
  try { server = await runtimeServer(preflightSocket, preflightNonce, new Map()); }
  catch (error) { throw new Error(`CLAUDE_RUNTIME_SOCKET_${(error as NodeJS.ErrnoException).code ?? "FAILED"}`); }
  smokeStage = "subscription-preflight-invoke";
  const preflight = await runClaude(binary, root, plugin, preflightContext, preflightSocket, preflightNonce, "Reply with exactly SESSION_OK. Do not call tools.");
  smokeStage = "subscription-preflight-assert";
  assert.ok(JSON.stringify(preflight.result).includes("SESSION_OK"), "CLAUDE_SUBSCRIPTION_SESSION_UNUSABLE");
  smokeStage = "subscription-preflight-close";
  await new Promise<void>((resolveClose, reject) => server!.close(error => error ? reject(error) : resolveClose())); server = undefined;

  smokeStage = "decision-scenarios";
  const decisions = ["accepted", "rejected", "conflicted", "quarantined", "approval_required"] as const;
  const observed: string[] = [];
  let acceptedReceipt = ""; let acceptedSession = ""; let forkSession = ""; let acceptedRevision = 0; let acceptedDocument: JsonValue = null;
  for (const outcome of decisions) {
    smokeStage = `decision-${outcome}-setup`;
    const scenario = join(root, outcome); await mkdir(scenario, { mode: 0o700 });
    const binding = bindingFor(outcome); const outputDigest = sha(OUTPUT_TEXT); const evidenceDigest = sha(EVIDENCE_CLAIM);
    const attempt: ClaudeNativeAttemptV1 = { providerOperationId: `claude-operation-${outcome}`, nativeSessionId: `pending-${outcome}`, startedAt: "2026-08-14T00:00:00Z", finishedAt: "2026-08-14T00:00:01Z", outcome: "succeeded", outputDigest, evidence: [{ digest: evidenceDigest, mediaType: "application/json", size: Buffer.byteLength(EVIDENCE_CLAIM) }], provenance: { authMode: "existing-user-subscription-session", host: "claude", version: "2.1.228" } };
    const provider: ClaudeNativeRuntimeV1 = { async launch() { return attempt; }, async cancel() { return attempt; }, async reconcile() { return attempt; }, async resume() { return attempt; }, async collect() { return attempt; } };
    const adapter = createClaudeAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: `horseness.grant.${outcome}`, scope: { workspaceId: binding.workspaceId, adapterId: CLAUDE_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime: provider, producerPrincipalId: "worker", producerGrantDigest: "grant" });
    await adapter.launch({ ...binding, operation: "launch", renderedContextDigest: sha(`context-${outcome}`), providerOptions: {} });
    const authority = new DecisionAuthority(outcome); const retained = createClaudeRetainedDeliveryAuthorityV1(join(scenario, "retained"));
    const registration: ClaudeWorkerReturnRegistrationV1 = { capabilityReference: binding.attemptCapability, binding, adapter, authority: { client: authority.client(), async sealProposal(_binding, receipt) { return proposalFor(binding, receipt); } }, subscriptionId: `subscription-${outcome}` };
    const registrations = [registration];
    const forkBinding = bindingFor(outcome, "-fork");
    if (outcome === "accepted") {
      const forkAdapter = createClaudeAdapterV1({ binding: forkBinding, credential: { schemaVersion: "1", kind: "host-reference", reference: `horseness.grant.${outcome}.fork`, scope: { workspaceId: forkBinding.workspaceId, adapterId: CLAUDE_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime: provider, producerPrincipalId: "worker", producerGrantDigest: "grant" });
      await forkAdapter.launch({ ...forkBinding, operation: "launch", renderedContextDigest: sha(`context-${outcome}-fork`), providerOptions: {} });
      registrations.push({ ...registration, capabilityReference: forkBinding.attemptCapability, binding: forkBinding, adapter: forkAdapter, authority: { ...registration.authority, async sealProposal(_binding, receipt) { return proposalFor(forkBinding, receipt); } } });
    }
    const runtime = createClaudeNativeContributionRuntimeV1(registrations, { retained, attemptContexts: registrations.map(item => ({ attemptCapabilityReference: item.capabilityReference, binding: item.binding, renderedContext: `immutable Claude context for ${item.binding.attemptId}`, renderedContextDigest: sha(`context-${item.binding.attemptId}`) })), initialAttemptCapabilityReference: binding.attemptCapability });
    const runtimes = new Map(registrations.map(item => [item.capabilityReference, runtime]));
    const socket = join(scenario, "runtime.sock"); const nonce = randomBytes(32).toString("hex"); server = await runtimeServer(socket, nonce, runtimes);
    smokeStage = `decision-${outcome}-invoke`;
    const contextFile = join(scenario, "context.json"); await writeFile(contextFile, JSON.stringify({ schemaVersion: "HorsenessClaudeContextV1", renderedContext: `attemptCapabilityReference=${binding.attemptCapability}; forkPinDigest=${binding.forkPinDigest}` }), { mode: 0o600 });
    const prompt = `Invoke the Horseness MCP worker tool exactly once with this JSON object and no substitutions: ${JSON.stringify({ attemptCapabilityReference: binding.attemptCapability, outputText: OUTPUT_TEXT, evidenceClaim: EVIDENCE_CLAIM })}. Do not use any other tool.`;
    const invocation = await runClaude(binary, scenario, plugin, contextFile, socket, nonce, prompt);
    assert.equal(invocation.toolUses, 1); assert.ok(invocation.toolResults >= 1); assert.equal(invocation.hookContext, true);
    smokeStage = `decision-${outcome}-retained-assert`;
    const record = retained.load(`${binding.workspaceId}:${binding.runId}:${binding.taskId}:${binding.attemptId}:${binding.generation}`);
    if (record === undefined) throw new Error("CLAUDE_RETAINED_RECORD_MISSING");
    if (record.decision !== outcome) throw new Error("CLAUDE_RETAINED_DECISION_MISMATCH");
    if (record.resumeToken !== `claude-resume-${outcome}`) throw new Error("CLAUDE_RETAINED_RESUME_MISMATCH");
    if (authority.publicationKinds.join(",") !== "artifact,evidence") throw new Error("CLAUDE_RETAINED_PUBLICATION_MISMATCH");
    observed.push(record.decision!);
    if (outcome === "accepted") {
      acceptedReceipt = record.workerReturn.receipt.receiptDigest; acceptedSession = invocation.sessionId; acceptedRevision = authority.canonicalRevision; acceptedDocument = authority.canonicalDocument;
      smokeStage = "decision-accepted-resume";
      const resumed = await runClaude(binary, scenario, plugin, contextFile, socket, nonce, prompt, { resume: acceptedSession });
      assert.equal(resumed.sessionId, acceptedSession); assert.equal(authority.calls.receipts, 1); assert.equal(authority.calls.proposals, 1); assert.equal(authority.calls.starts, 1);
      await writeFile(contextFile, JSON.stringify({ schemaVersion: "HorsenessClaudeContextV1", renderedContext: `attemptCapabilityReference=${forkBinding.attemptCapability}; forkPinDigest=${forkBinding.forkPinDigest}` }), { mode: 0o600 });
      smokeStage = "decision-accepted-fork";
      const forkPrompt = `Invoke the Horseness MCP worker tool exactly once with this JSON object and no substitutions: ${JSON.stringify({ attemptCapabilityReference: forkBinding.attemptCapability, outputText: OUTPUT_TEXT, evidenceClaim: EVIDENCE_CLAIM })}. Do not use any other tool.`;
      const forked = await runClaude(binary, scenario, plugin, contextFile, socket, nonce, forkPrompt, { resume: acceptedSession, fork: true });
      assert.notEqual(forked.sessionId, acceptedSession); forkSession = forked.sessionId;
      smokeStage = "decision-accepted-recovery";
      await adapter.reconcile({ ...binding, operation: "reconcile", providerOperationId: attempt.providerOperationId });
      await adapter.resume({ ...binding, operation: "reattach", providerOperationId: attempt.providerOperationId, nativeSessionId: acceptedSession });
      await adapter.resume({ ...binding, operation: "resume", providerOperationId: attempt.providerOperationId, nativeSessionId: acceptedSession });
      const output = { digest: outputDigest, mediaType: "text/plain", byteLength: Buffer.byteLength(OUTPUT_TEXT) } as const;
      const evidence = { digest: evidenceDigest, mediaType: "application/json", byteLength: Buffer.byteLength(EVIDENCE_CLAIM) } as const;
      const concurrent = await Promise.all([runtime.deliver(binding.attemptCapability, output, evidence), runtime.deliver(binding.attemptCapability, output, evidence)]);
      assert.deepEqual(concurrent[0], concurrent[1]);
    }
    await new Promise<void>((resolveClose, reject) => server!.close(error => error ? reject(error) : resolveClose())); server = undefined;
    await runtime.revoke();
    if (outcome === "accepted") {
      const restarted = createClaudeRetainedDeliveryAuthorityV1(join(scenario, "retained"));
      const recovered = restarted.load(`${binding.workspaceId}:${binding.runId}:${binding.taskId}:${binding.attemptId}:${binding.generation}`);
      assert.equal(recovered?.decision, "accepted");
      restarted.close();
    }
  }
  assert.deepEqual(observed, decisions); assert.equal(acceptedRevision, 1); assert.deepEqual(acceptedDocument, { value: 2 });
  smokeStage = "uninstall";
  const removed = join(root, "removed-plugin"); await cp(plugin, removed, { recursive: true }); await rm(removed, { recursive: true, force: true });
  const missing = spawn(binary, ["plugin", "validate", removed], { stdio: "ignore" });
  assert.notEqual(await new Promise<number | null>(resolveCode => missing.once("close", resolveCode)), 0);
  process.stdout.write(`${JSON.stringify({ schemaVersion: "ClaudeHostSmokeResultV1", host: "claude", version: fixture.artifact.version, authMode: "existing-user-subscription-session", executableDigest: fixture.artifact.executable.sha256, packageDigest: CLAUDE_NATIVE_PACKAGE_METADATA.packageDigest, receiptDigest: acceptedReceipt, decisions: observed, canonicalRevision: acceptedRevision, canonicalDocument: acceptedDocument, sessions: { resumed: acceptedSession, forked: forkSession }, bounds: { scenarios: 5, maxTurns: 3, maxToolCallsPerInvocation: 1, maxContextBytes: 4096, maxOutputBytes: 1024, maxEvidenceBytes: 1024, wallClockMs: MAX_WALL_MS }, lifecycle: { resume: "same-session", fork: "new-session-second-fork-pin", uninstallDiscovery: "disabled", horsenessGrant: "revoked", claudeLogout: "not-performed" } })}\n`);
} catch (error) {
  process.stderr.write(`${redactedReason(error)}:${smokeStage}\n`);
  process.exitCode = 1;
} finally {
  if (server !== undefined) await new Promise<void>(resolveClose => server!.close(() => resolveClose()));
  await rm(root, { recursive: true, force: true });
}
