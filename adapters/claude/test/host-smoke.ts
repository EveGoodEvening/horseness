import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:net";
import { cp, mkdir, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NO_POLICY_DIGEST, NO_POLICY_V1, attemptContextBindingDigest, contextManifestCoreDigest, createRunGenesis, createWorkspaceGenesis, deltaAuthorityScopeDigest, jsonValueDigest, sealEventEnvelope, sealForkPin, sealProposal, type CapabilityV1, type CompositeCursorV1, type ContextManifestCoreV1, type DeltaAuthorityScopeV1, type JsonValue, type ProposalEnvelopeCoreV1 } from "@horseness/domain";
import { AdmissionService, loadRevision, type AdmissionCurrentAuthorityV1, type AdmissionRequestV1 } from "@horseness/orchestrator";
import { sealPolicyDocument, type PolicyEffectV1 } from "@horseness/policy";
import { SQLiteAuthority } from "@horseness/store-sqlite";
import type { BoundAdapterOperationV1, WorkerAdapterV1, WorkerReturnV1 } from "@horseness/protocol";
import type { WorkerReturnClientV1 } from "@horseness/adapter-kit";
import { acquireUpstreamArtifact, verifyOfficialValidation, type C11HostFixtureV1 } from "./c11-upstream-artifact.mjs";
import { CLAUDE_ADAPTER_ID, CLAUDE_NATIVE_PACKAGE_METADATA, claudeDoctorV1, claudeNativePackageDigestV1, createClaudeAdapterV1, createClaudeNativeContributionRuntimeV1, createClaudeRetainedDeliveryAuthorityV1, validateClaudeSubscriptionLiveReceiptV1, type ClaudeNativeAttemptV1, type ClaudeNativeContributionRuntimeV1, type ClaudeNativeRuntimeV1, type ClaudeNativeWorkerReturnBatchEvidenceV1, type ClaudeNativeWorkerReturnBatchResultV1, type ClaudeWorkerReturnRegistrationV1, type ClaudeSubscriptionLiveReceiptV1 } from "../src/index.js";

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
  if (/rate.?limit|too many requests|\b429\b|overloaded/i.test(text)) return "CLAUDE_PROVIDER_RATE_LIMITED";
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
const nativeFailureReason = (messages: Record<string, unknown>[], init: Record<string, unknown>, result: Record<string, unknown>, stderr: string): string | undefined => {
  const nativeErrors = messages.filter(message => message.type === "system" && /error|failed|auth|login/i.test(String(message.subtype ?? "")));
  const failedResult = result.is_error === true ? result : {
    is_error: result.is_error,
    subtype: result.subtype,
    terminal_reason: result.terminal_reason,
    api_error_status: result.api_error_status,
  };
  const terminal = JSON.stringify({ result: failedResult, errors: nativeErrors, stderr });
  if (/not logged in|please run \/login|login required|interactive login|session expired|expired session|\bauth(?:entication)?\b|unauthorized|forbidden|credential|subscription/i.test(terminal)) return "CLAUDE_SUBSCRIPTION_SESSION_UNUSABLE";
  if (/rate.?limit|too many requests|\b429\b|overloaded/i.test(terminal)) return "CLAUDE_PROVIDER_RATE_LIMITED";
  if (typeof init.model !== "string" || init.model.length === 0 || /model[^\n]{0,80}(?:not found|unavailable|unsupported|invalid|denied|access)|(?:not found|unavailable|unsupported|invalid|denied|access)[^\n]{0,80}model/i.test(terminal)) return "CLAUDE_NATIVE_MODEL_UNAVAILABLE";
  if (nativeErrors.length > 0 || result.is_error === true || result.terminal_reason === "api_error" || result.terminal_reason === "host_error") return "CLAUDE_NATIVE_HOST_FAILED";
  return undefined;
};


type StreamObservation = { sessionId: string; init: Record<string, unknown>; toolUses: number; toolResults: number; hookContext: boolean; workerToolAdvertised: boolean; result: Record<string, unknown>; batchResult: ClaudeNativeWorkerReturnBatchResultV1 | null };
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
function findWireNodes(value: unknown, predicate: (node: Record<string, unknown>) => boolean, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) { for (const item of value) findWireNodes(item, predicate, found); return found; }
  if (value === null || typeof value !== "object") return found;
  const node = value as Record<string, unknown>;
  if (predicate(node)) found.push(node);
  for (const item of Object.values(node)) findWireNodes(item, predicate, found);
  return found;
}
async function runClaude(binary: string, cwd: string, tempRoot: string, contextFile: string, socket: string, nonce: string, prompt: string, pluginDir?: string, session?: { resume: string; fork?: boolean; branchEntryId?: string }, maxTurns = 3): Promise<StreamObservation> {
  const tool = "mcp__plugin_horseness-claude_horseness-worker__horseness_worker_return";
  const args = [...(pluginDir === undefined ? [] : ["--plugin-dir", pluginDir]), "-p", prompt, "--output-format", "stream-json", "--verbose", "--max-turns", String(maxTurns)];
  if (pluginDir !== undefined) args.push("--tools", "", "--allowedTools", tool);
  if (session !== undefined) { args.push("--resume", session.resume); if (session.fork) args.push("--fork-session"); }
  const nativeEnvironment = { ...process.env };
  delete nativeEnvironment.CLAUDE_CONFIG_DIR;
  delete nativeEnvironment.TMPDIR;
  delete nativeEnvironment.TMP;
  delete nativeEnvironment.TEMP;
  const child = spawn(binary, args, { cwd, env: { ...nativeEnvironment, TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot, HORSENESS_CLAUDE_CONTEXT_FILE: contextFile, HORSENESS_CLAUDE_RUNTIME_SOCKET: socket, HORSENESS_CLAUDE_RUNTIME_NONCE: nonce, HORSENESS_CLAUDE_PREVIOUS_SESSION_ID: session?.resume, HORSENESS_CLAUDE_BRANCH_ENTRY_ID: session?.branchEntryId }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > MAX_STREAM_BYTES) child.kill("SIGKILL"); });
  child.stderr.on("data", chunk => { stderr += chunk; if (Buffer.byteLength(stderr) > MAX_STREAM_BYTES) child.kill("SIGKILL"); });
  const timer = setTimeout(() => child.kill("SIGKILL"), MAX_WALL_MS);
  const status = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>(resolveStatus => { child.once("error", error => resolveStatus({ code: null, signal: null, error })); child.once("close", (code, signal) => resolveStatus({ code, signal })); });
  clearTimeout(timer);
  if (status.error !== undefined) throw new Error(redactedReason(status.error));
  if (status.signal !== null) throw new Error(`CLAUDE_NATIVE_SIGNAL_${status.signal}`);
  let messages: Record<string, unknown>[];
  try { messages = stdout.split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>); }
  catch {
    if (status.code !== 0) throw new Error(`${redactedReason(stderr)}_EXIT_${status.code ?? "NONE"}`);
    throw new Error("CLAUDE_STREAM_JSON_INVALID");
  }
  const init = messages.find(message => message.type === "system" && message.subtype === "init");
  const result = messages.findLast(message => message.type === "result");
  if (init === undefined || result === undefined) throw new Error("CLAUDE_STREAM_CONTRACT_INVALID");
  const serialized = JSON.stringify(messages);
  const stableToolFailure = serialized.match(/(?:CLAUDE|HORSENESS|INVALID|UNKNOWN)_[A-Z0-9_]+/)?.[0];
  if (stableToolFailure !== undefined) throw new Error(stableToolFailure);
  const nativeFailure = nativeFailureReason(messages, init, result, stderr);
  if (nativeFailure !== undefined) throw new Error(nativeFailure);
  if (status.code !== 0) {
    const subtype = typeof result.subtype === "string" ? result.subtype.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase() : "MISSING";
    throw new Error(`CLAUDE_RESULT_${subtype}_EXIT_${status.code ?? "NONE"}`);
  }
  const toolUses = countWireNodes(messages, node => node.type === "tool_use" && node.name === tool);
  if (countWireNodes(messages, node => node.type === "tool_result" && node.is_error === true) > 0) throw new Error("CLAUDE_NATIVE_TOOL_RESULT_ERROR");
  const toolResults = countWireNodes(messages, node => node.type === "tool_result");
  const sessionId = String(result.session_id ?? init.session_id ?? "");
  if (sessionId.length === 0) throw new Error("CLAUDE_SESSION_ID_MISSING");
  const nativeToolResults = findWireNodes(messages, node => node.type === "tool_result" && node.is_error !== true);
  let batchResult: ClaudeNativeWorkerReturnBatchResultV1 | null = null;
  if (nativeToolResults.length === 1) {
    const content = nativeToolResults[0]!.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? (content.find(item => item !== null && typeof item === "object" && (item as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined)?.text : undefined;
    if (typeof text === "string") batchResult = JSON.parse(text) as ClaudeNativeWorkerReturnBatchResultV1;
  }
  return { sessionId, init, toolUses, toolResults, hookContext: serialized.includes("horseness-context-v1"), workerToolAdvertised: serialized.includes(tool), result, batchResult };
}

const jsonWireValue = <T>(value: T) => value as unknown as JsonValue;
type AuthorityScenario = {
  authority: SQLiteAuthority;
  binding: BoundAdapterOperationV1;
  client: WorkerReturnClientV1;
  seal(receipt: WorkerReturnV1["receipt"]): WorkerReturnV1["proposal"];
};
function createAuthorityScenario(root: string, desired: "accepted" | "rejected" | "conflicted" | "quarantined" | "approval_required") {
  const authority = new SQLiteAuthority(join(root, "authority.sqlite"), join(root, "artifacts"));
  const workspaceId = `claude-${desired}`, runId = "run", taskId = "task", attemptId = "attempt";
  const workspace = createWorkspaceGenesis({ workspaceId, authorityPrincipalId: "authority", initialGrantDigest: "grant", authorityConsumptionMarker: "marker", activePolicyDigest: NO_POLICY_DIGEST, commandId: "workspace" });
  authority.appendAtomic({ commandId: "workspace", workspace: { streamKind: "workspace", workspaceId, streamId: workspaceId, expectedSequence: 0, expectedEnvelopeHash: null, events: [workspace.event] } });
  const absent = { schemaVersion: "1", kind: "absent-run-genesis", workspaceId, workspaceSequence: 1, workspaceEnvelopeHash: workspace.event.envelopeHash, workspaceContextEpoch: 0, runId, expectedRunHead: "absent" } as const;
  const run = createRunGenesis({ observationCursor: absent, initialDocument: { value: 1 }, principalId: "worker", commandId: "run" }); authority.appendAtomic({ commandId: "run", runGenesis: { observationCursor: absent, event: run.event } });
  const cursor: CompositeCursorV1 = run.resultCursor; const revision = loadRevision(authority, workspaceId, runId);
  const scope: DeltaAuthorityScopeV1 = { schemaVersion: "1", workspaceId, runId, taskId, roots: ["/value"] };
  const effect: PolicyEffectV1 = desired === "rejected" ? "rejected" : desired === "approval_required" ? "approval_required" : "accepted";
  const policy = effect === "accepted" ? NO_POLICY_V1 : sealPolicyDocument({ schemaVersion: "1", kind: "policy", policyId: `policy-${desired}`, revision: 0, predecessorDigest: null, rules: [{ ruleId: "rule", subject: { action: null, pathPrefix: null, version: null }, effect, constraints: [], evidence: [] }] });
  const policyDigest = "policyDigest" in policy ? policy.policyDigest : NO_POLICY_DIGEST; const stale = desired === "conflicted";
  const fork = sealForkPin({ schemaVersion: "1", forkId: `fork-${desired}`, pinVersion: 1, workspaceId, runId, parentForkPinDigest: null, refreshesForkPinDigest: null, canonicalRevision: stale ? revision.revision + 1 : revision.revision, canonicalStateHash: stale ? "stale-state" : revision.stateHash, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sourceObservationCursor: cursor, sourceContextVersion: { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 0, runContextEpoch: 0, observationCursor: cursor }, dependencyJoinSnapshotDigest: "join", deltaAuthorityScopeDigest: deltaAuthorityScopeDigest(scope), pinnedPolicyDigest: policyDigest, ancestry: [], createdByPrincipalId: "worker", createdByGrantDigest: "grant" });
  const manifest: ContextManifestCoreV1 = { schemaVersion: "1", workspaceId, runId, attemptId, generation: 1, forkPinDigest: fork.forkPinDigest, sourceObservationCursor: cursor, sourceContextVersion: fork.core.sourceContextVersion, authorizationObservationCursor: cursor, authorizationContextVersion: fork.core.sourceContextVersion, authorizationOverlayV1: { policyDigest, grantDigest: "grant", quotaDigest: "quota-digest", result: "allowed" }, canonicalRevision: revision.revision, canonicalStateHash: revision.stateHash, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sources: [], rendererVersion: "1", omissions: [], selectedBytes: 0, byteBudget: 4096, tokenizerMetadata: { schemaVersion: "1", tokenizerId: "bytes", tokenizerVersion: "1", estimatedTokens: 0, bytesPerTokenNumerator: 1, bytesPerTokenDenominator: 1 }, renderedOutputDigest: sha(`context-${desired}`) };
  const contextBinding = { schemaVersion: "1", attemptId, generation: 1, forkPinDigest: fork.forkPinDigest, contextManifestCoreDigest: contextManifestCoreDigest(manifest), sourceObservationCursor: cursor, sourceContextVersion: fork.core.sourceContextVersion, authorizationObservationCursor: cursor, authorizationContextVersion: fork.core.sourceContextVersion, providerIdempotencyKey: `provider-${desired}`, expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: "worker", allowedProducerGrantDigest: "grant" } as const;
  const binding: BoundAdapterOperationV1 = { schemaVersion: "1", workspaceId, runId, taskId, attemptId, generation: 1, forkPinDigest: fork.forkPinDigest, contextManifestCoreDigest: contextManifestCoreDigest(manifest), attemptContextBindingDigest: attemptContextBindingDigest(contextBinding), providerIdempotencyKeyDigest: sha(`provider-${desired}`), attemptCapability: `claude-attempt-${desired}` };
  let deliveredDecision: typeof desired | null = null; let authorityCursor: CompositeCursorV1 | null = null;
  const proposalCore: ProposalEnvelopeCoreV1 = { schemaVersion: "1", workspaceId, runId, authorPrincipalId: "worker", authorGrantDigest: "grant", attemptId, receiptDigests: [], forkPinDigest: fork.forkPinDigest, deltaAuthorityScopeDigest: deltaAuthorityScopeDigest(scope), baseRevision: fork.core.canonicalRevision, baseStateHash: fork.core.canonicalStateHash, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", proposalSealingObservationCursor: cursor, proposalSealingContextVersion: fork.core.sourceContextVersion, operations: [{ op: "replace", path: "/value", expectedValueDigest: jsonValueDigest(1), value: 2 }], evidenceClaims: [], pinnedPolicyDigest: policyDigest, currentPolicyDigest: policyDigest, nonce: `nonce-${desired}`, predecessorProposalDigest: null, predecessorReason: null };
  const client: WorkerReturnClientV1 = {
    async publishObject(digest, kind) { const content = kind === "evidence" ? EVIDENCE_CLAIM : OUTPUT_TEXT; assert.equal(authority.artifacts.publishAndRegister(content, kind === "evidence" ? "application/json" : "text/plain").digest, digest); },
    async submitReceipt(receipt) { return receipt.receiptDigest; },
    async submitProposal(proposal) { assert.ok(authorityCursor); const result = new AdmissionService(authority).evaluateAndApply({ schemaVersion: "1", commandId: `admit-${desired}`, proposal, scopeDigest: proposal.core.deltaAuthorityScopeDigest, forkPinDigest: proposal.core.forkPinDigest, receiptDigests: proposal.core.receiptDigests, evidenceIds: [], policyDigest, quotaId: "quota", evaluationClock: { schemaVersion: "1", authorityTime: "2026-08-14T00:00:02Z", observationCursor: authorityCursor }, approval: null, authorization: { capabilityId: "capability" }, action: "apply-delta", version: "1" } satisfies AdmissionRequestV1); deliveredDecision = result.state; return { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }; },
    async startDecisionSubscription(input) { assert.equal(input.resumeToken, null); return { resumeToken: `authority-resume-${desired}` }; },
    async observeDecision(input) { assert.equal(deliveredDecision, desired); return { resumeToken: input.resumeToken, decision: deliveredDecision! }; },
  };
  const seal = (receipt: WorkerReturnV1["receipt"]) => { const head = authority.replay(workspaceId, "run", runId).at(-1)!; const payload = { eventType: "AttemptReceiptRecordedV1", workspaceId, runId, receiptId: receipt.receiptId, receiptDigest: receipt.receiptDigest, outcome: receipt.outcome } as const; const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "run", workspaceId, streamId: runId, sequence: head.envelope.sequence + 1, priorEnvelopeHash: head.envelopeHash, eventId: `receipt-${desired}`, eventType: payload.eventType, payload, principalId: "worker", causationId: `receipt-${desired}`, correlationId: `receipt-${desired}`, idempotencyKey: `receipt-${desired}` }); authorityCursor = { ...cursor, runSequence: event.envelope.sequence, runEnvelopeHash: event.envelopeHash, runContextEpoch: event.envelope.sequence - 1 }; const capability: CapabilityV1 = { schemaVersion: "1", workspaceId, runId, commands: ["submit-proposal"], issuer: "authority", delegatee: "worker", issuedObservationSequence: 1, expiresObservationSequence: 100, nonce: `cap-${desired}`, revocationSequence: null }; const current: AdmissionCurrentAuthorityV1 = { schemaVersion: "1", evaluationObservationCursor: authorityCursor, currentPolicy: policy, authorization: { role: "worker", capabilityId: "capability", capability, grantDigest: "grant", revoked: false }, quota: { id: "quota", digest: "quota-digest", available: desired !== "quarantined" }, authenticatedApproverPrincipalId: "approver", authorityTime: "2026-08-14T00:00:02Z" }; authority.publishAndAppendAtomic({ commandId: `receipt-${desired}`, run: { streamKind: "run", workspaceId, streamId: runId, expectedSequence: head.envelope.sequence, expectedEnvelopeHash: head.envelopeHash, events: [event] }, artifacts: [], snapshots: [{ workspaceId, streamKind: "run", streamId: runId, sequence: authorityCursor.runSequence, envelopeHash: authorityCursor.runEnvelopeHash, projectionName: "admission-sealing", projectionVersion: "1", state: jsonWireValue({ schemaVersion: "1", observationCursor: authorityCursor, fork, scope, receipts: [receipt], pinnedPolicy: policy, evidence: [] }) }, { workspaceId, streamKind: "run", streamId: runId, sequence: authorityCursor.runSequence, envelopeHash: authorityCursor.runEnvelopeHash, projectionName: "admission-current", projectionVersion: "1", state: jsonWireValue(current) }] }); return sealProposal({ ...proposalCore, receiptDigests: [receipt.receiptDigest], proposalSealingObservationCursor: authorityCursor, proposalSealingContextVersion: { schemaVersion: "1", kind: "composite", workspaceContextEpoch: authorityCursor.workspaceContextEpoch, runContextEpoch: authorityCursor.runContextEpoch, observationCursor: authorityCursor } }); };
  return { authority, binding, client, seal };
}
async function runtimeServer(path: string, nonce: string, runtimes: Map<string, ReturnType<typeof createClaudeNativeContributionRuntimeV1>>): Promise<Server> {
  await unlink(path).catch(() => undefined);
  const server = createServer({ allowHalfOpen: true }, socket => {
    socket.setEncoding("utf8"); let wire = "";
    socket.on("error", () => undefined);
    socket.on("data", chunk => { wire += chunk; if (Buffer.byteLength(wire) > 64 * 1024) socket.destroy(); });
    socket.on("end", async () => {
      try {
        const request = JSON.parse(wire) as ({ schemaVersion: "HorsenessClaudeSessionStartRequestV1"; nonce: string; start: { sessionId: string; source: "startup" | "resume" | "fork" | "clear" | "compact"; previousSessionId?: string; branchEntryId?: string } } | { schemaVersion: "HorsenessClaudeRuntimeRequestV1"; nonce: string; sessionId?: string | null; input: { scenarios: readonly { attemptCapabilityReference: string; output: { digest: string; mediaType: string; byteLength: number }; evidence: { digest: string; mediaType: string; byteLength: number } }[] } });
        if (request.nonce !== nonce) throw new Error("HORSENESS_RUNTIME_AUTHORITY_REJECTED");
        if (request.schemaVersion === "HorsenessClaudeSessionStartRequestV1") {
          const candidates = [...new Set(runtimes.values())]; if (candidates.length !== 1) throw new Error("HORSENESS_SESSION_RUNTIME_AMBIGUOUS");
          const context = await candidates[0]!.registerSessionStart(request.start);
          socket.end(`${JSON.stringify({ schemaVersion: "HorsenessClaudeRuntimeResponseV1", ok: true, context: { schemaVersion: "HorsenessClaudeAttemptContextV1", ...context } })}\n`); return;
        }
        if (request.input.scenarios.length !== 5) throw new Error("INVALID_EXACT_SCENARIO_BATCH");
        const runtime = runtimes.get(request.input.scenarios[0]!.attemptCapabilityReference);
        if (runtime === undefined || request.input.scenarios.some(item => runtimes.get(item.attemptCapabilityReference) !== runtime)) throw new Error("HORSENESS_ATTEMPT_GRANT_REVOKED");
        const result = await runtime.deliverBatch(request.input.scenarios, request.sessionId ?? undefined);
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
const smokeStartedAtMs = Date.now();
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
  const observedContributions = await Promise.all(CLAUDE_NATIVE_PACKAGE_METADATA.contributions.map(async item => ({ kind: item.kind, name: item.name, digest: `sha256:${sha(await readFile(join(root, item.name)))}` })));
  const observedPackageDigest = claudeNativePackageDigestV1(observedContributions);
  const doctor = claudeDoctorV1({ nativePackageVersion: fixture.artifact.version, loaderDigest: fixture.artifact.executable.sha256, contributions: observedContributions.map(({ name, digest }) => ({ name, digest })) });
  if (doctor.checks.some(check => check.status !== "ok") || observedPackageDigest !== CLAUDE_NATIVE_PACKAGE_METADATA.packageDigest) throw new Error("CLAUDE_NATIVE_PACKAGE_PROVENANCE_MISMATCH");
  const validation = spawn(binary, ["plugin", "validate", plugin], { stdio: ["ignore", "ignore", "pipe"] });
  let validationError = ""; validation.stderr.setEncoding("utf8"); validation.stderr.on("data", chunk => validationError += chunk);
  const validationCode = await new Promise<number | null>(resolveCode => validation.once("close", resolveCode));
  assert.equal(validationCode, 0, redactedReason(validationError));
  const nativeTemp = join(root, "tmp"); await mkdir(nativeTemp, { recursive: true, mode: 0o700 });
  let acceptedReceipt = ""; let acceptedSession = ""; let forkSession = ""; let acceptedRevision = 0; let acceptedDocument: JsonValue = null; let revokedAcceptedRuntime: ClaudeNativeContributionRuntimeV1 | null = null; const liveBindings: ClaudeSubscriptionLiveReceiptV1["bindings"][number][] = [];
  const decisions = ["accepted", "rejected", "conflicted", "quarantined", "approval_required"] as const;
  const retained = createClaudeRetainedDeliveryAuthorityV1(join(root, "retained"));
  const scenarioAuthorities: AuthorityScenario[] = [];
  const registrations: ClaudeWorkerReturnRegistrationV1[] = [];
  let acceptedAdapter: WorkerAdapterV1 | null = null; let acceptedAttempt: ClaudeNativeAttemptV1 | null = null;
  const outputDigest = sha(OUTPUT_TEXT); const evidenceDigest = sha(EVIDENCE_CLAIM);
  for (const outcome of decisions) {
    const scenario = join(root, outcome); await mkdir(scenario, { mode: 0o700 });
    const authorityScenario = createAuthorityScenario(scenario, outcome); scenarioAuthorities.push(authorityScenario);
    const binding = authorityScenario.binding;
    const attempt: ClaudeNativeAttemptV1 = { providerOperationId: `claude-operation-${outcome}`, nativeSessionId: `pending-${outcome}`, startedAt: "2026-08-14T00:00:00Z", finishedAt: "2026-08-14T00:00:01Z", outcome: "succeeded", outputDigest, evidence: [{ digest: evidenceDigest, mediaType: "application/json", size: Buffer.byteLength(EVIDENCE_CLAIM) }], provenance: { authMode: "existing-user-subscription-session", host: "claude", version: "2.1.228" } };
    const provider: ClaudeNativeRuntimeV1 = { async launch() { return attempt; }, async cancel() { return attempt; }, async reconcile() { return attempt; }, async resume() { return attempt; }, async collect() { return attempt; } };
    const adapter = createClaudeAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: `horseness.grant.${outcome}`, scope: { workspaceId: binding.workspaceId, adapterId: CLAUDE_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime: provider, producerPrincipalId: "worker", producerGrantDigest: "grant" });
    await adapter.launch({ ...binding, operation: "launch", renderedContextDigest: sha(`context-${outcome}`), providerOptions: {} });
    if (outcome === "accepted") { acceptedAdapter = adapter; acceptedAttempt = attempt; }
    registrations.push({ capabilityReference: binding.attemptCapability, binding, adapter, authority: { client: authorityScenario.client, async sealProposal(_binding, receipt) { return authorityScenario.seal(receipt); }, async canonicalAcceptedAdvance() { const revision = loadRevision(authorityScenario.authority, binding.workspaceId, binding.runId); return { workspaceId: binding.workspaceId, runId: binding.runId, revision: revision.revision, stateHash: revision.stateHash }; } }, subscriptionId: `subscription-${outcome}` });
  }
  const acceptedRegistration = registrations[0]!;
  const forkBinding: BoundAdapterOperationV1 = { ...acceptedRegistration.binding, attemptId: "attempt-fork", forkPinDigest: sha("accepted-fork-pin"), attemptContextBindingDigest: sha("accepted-fork-binding"), providerIdempotencyKeyDigest: sha("accepted-fork-key"), attemptCapability: "claude-attempt-accepted-fork" };
  if (acceptedAdapter === null || acceptedAttempt === null) throw new Error("CLAUDE_ACCEPTED_LIFECYCLE_MISSING");
  const acceptedProvider = acceptedAdapter;
  const acceptedProviderAttempt = acceptedAttempt;
  const forkProvider: ClaudeNativeRuntimeV1 = { async launch() { return acceptedProviderAttempt; }, async cancel() { return acceptedProviderAttempt; }, async reconcile() { return acceptedProviderAttempt; }, async resume() { return acceptedProviderAttempt; }, async collect() { return acceptedProviderAttempt; } };
  const forkAdapter = createClaudeAdapterV1({ binding: forkBinding, credential: { schemaVersion: "1", kind: "host-reference", reference: "horseness.grant.accepted.fork", scope: { workspaceId: forkBinding.workspaceId, adapterId: CLAUDE_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime: forkProvider, producerPrincipalId: "worker", producerGrantDigest: "grant" });
  await forkAdapter.launch({ ...forkBinding, operation: "launch", renderedContextDigest: sha("context-accepted-fork"), providerOptions: {} });
  registrations.push({ ...acceptedRegistration, capabilityReference: forkBinding.attemptCapability, binding: forkBinding, adapter: forkAdapter });
  const runtime = createClaudeNativeContributionRuntimeV1(registrations, { retained, sessionStateDirectory: join(root, "sessions"), attemptContexts: registrations.map(item => ({ attemptCapabilityReference: item.capabilityReference, binding: item.binding, renderedContext: `immutable Claude context for ${item.binding.attemptId}`, renderedContextDigest: sha(`context-${item.binding.attemptId}`) })), initialAttemptCapabilityReference: acceptedRegistration.capabilityReference });
  const runtimes = new Map(registrations.map(item => [item.capabilityReference, runtime]));
  const socket = join(root, "runtime.sock"); const nonce = randomBytes(32).toString("hex"); server = await runtimeServer(socket, nonce, runtimes);
  const contextFile = join(root, "context.json"); await writeFile(contextFile, JSON.stringify({ schemaVersion: "HorsenessClaudeContextV1", renderedContext: `attemptCapabilityReference=${acceptedRegistration.capabilityReference}; forkPinDigest=${acceptedRegistration.binding.forkPinDigest}` }), { mode: 0o600 });
  const scenarioInputs = decisions.map((_outcome, index) => ({ attemptCapabilityReference: registrations[index]!.capabilityReference, outputText: OUTPUT_TEXT, evidenceClaim: EVIDENCE_CLAIM }));
  const prompt = `Invoke the Horseness MCP worker tool exactly once with this exact batch and no substitutions: ${JSON.stringify({ scenarios: scenarioInputs })}. Do not use any other tool. Return the tool result.`;
  smokeStage = "decision-batch-invoke";
  const invocation = await runClaude(binary, root, nativeTemp, contextFile, socket, nonce, prompt, plugin);
  assert.equal(invocation.toolUses, 1); assert.equal(invocation.toolResults, 1); assert.equal(invocation.hookContext, true);
  acceptedSession = invocation.sessionId;
  const batchResult = invocation.batchResult;
  if (batchResult === null || batchResult.schemaVersion !== "HorsenessClaudeWorkerReturnBatchResultV1" || batchResult.sessionId !== acceptedSession || batchResult.results.length !== 5) throw new Error("CLAUDE_NATIVE_BATCH_RESULT_INVALID");
  const observed: string[] = [];
  for (const [index, outcome] of decisions.entries()) {
    const binding = registrations[index]!.binding;
    const record = retained.load(`${binding.workspaceId}:${binding.runId}:${binding.taskId}:${binding.attemptId}:${binding.generation}`);
    if (record === undefined || record.decision !== outcome || record.resumeToken !== `authority-resume-${outcome}`) throw new Error("CLAUDE_RETAINED_BATCH_MISMATCH");
    const batchEvidence: ClaudeNativeWorkerReturnBatchEvidenceV1 | undefined = batchResult.results[index];
    if (batchEvidence === undefined || batchEvidence.workspaceId !== binding.workspaceId || batchEvidence.runId !== binding.runId || batchEvidence.taskId !== binding.taskId || batchEvidence.attemptId !== binding.attemptId || batchEvidence.generation !== binding.generation || batchEvidence.decision !== outcome || batchEvidence.receiptDigest !== record.workerReturn.receipt.receiptDigest || batchEvidence.proposalDigest !== record.workerReturn.proposal.proposalDigest || batchEvidence.outputDigest !== record.workerReturn.receipt.outputDigest || JSON.stringify(batchEvidence.evidenceDigests) !== JSON.stringify(record.workerReturn.receipt.evidence.map(item => item.digest))) throw new Error("CLAUDE_NATIVE_BATCH_EVIDENCE_MISMATCH");
    observed.push(record.decision); liveBindings.push({ workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, forkPinDigest: binding.forkPinDigest, contextManifestCoreDigest: binding.contextManifestCoreDigest, attemptContextBindingDigest: binding.attemptContextBindingDigest, receiptDigest: batchEvidence.receiptDigest, proposalDigest: batchEvidence.proposalDigest, outputDigest: batchEvidence.outputDigest, evidenceDigests: batchEvidence.evidenceDigests });
    if (outcome === "accepted") { acceptedReceipt = batchEvidence.receiptDigest; const canonical = loadRevision(scenarioAuthorities[index]!.authority, binding.workspaceId, binding.runId); acceptedRevision = canonical.revision; acceptedDocument = canonical.document; assert.deepEqual(batchResult.canonicalAcceptedAdvance, { workspaceId: binding.workspaceId, runId: binding.runId, revision: canonical.revision, stateHash: canonical.stateHash }); }
  }
  smokeStage = "session-resume-marker";
  const resumed = await runClaude(binary, root, nativeTemp, contextFile, socket, nonce, "Reply with exactly RESUME_OK. Do not call tools.", plugin, { resume: acceptedSession }, 1);
  assert.equal(resumed.sessionId, acceptedSession); assert.equal(resumed.toolUses, 0); assert.equal(resumed.hookContext, true); assert.ok(JSON.stringify(resumed.result).includes("RESUME_OK"));
  runtime.registerBranch({ entryId: "accepted-fork", previousSessionFile: acceptedSession, attemptCapabilityReference: forkBinding.attemptCapability });
  assert.throws(() => runtime.registerBranch({ entryId: "accepted-fork", previousSessionFile: acceptedSession, attemptCapabilityReference: acceptedRegistration.capabilityReference }), /cannot overwrite or substitute/);
  smokeStage = "session-fork-marker";
  const forked = await runClaude(binary, root, nativeTemp, contextFile, socket, nonce, "Reply with exactly FORK_OK. Do not call tools.", plugin, { resume: acceptedSession, fork: true, branchEntryId: "accepted-fork" }, 1);
  assert.notEqual(forked.sessionId, acceptedSession); assert.equal(forked.toolUses, 0); assert.equal(forked.hookContext, true); assert.ok(JSON.stringify(forked.result).includes("FORK_OK")); forkSession = forked.sessionId;
  await acceptedProvider.reconcile({ ...acceptedRegistration.binding, operation: "reconcile", providerOperationId: acceptedProviderAttempt.providerOperationId });
  await acceptedProvider.resume({ ...acceptedRegistration.binding, operation: "reattach", providerOperationId: acceptedProviderAttempt.providerOperationId, nativeSessionId: acceptedSession });
  await acceptedProvider.resume({ ...acceptedRegistration.binding, operation: "resume", providerOperationId: acceptedProviderAttempt.providerOperationId, nativeSessionId: acceptedSession });
  assert.deepEqual(observed, decisions); assert.equal(acceptedRevision, 1); assert.deepEqual(acceptedDocument, { value: 2 });
  await new Promise<void>((resolveClose, reject) => server!.close(error => error ? reject(error) : resolveClose())); server = undefined;
  for (const scenario of scenarioAuthorities) scenario.authority.close();
  revokedAcceptedRuntime = runtime;
  await runtime.revoke();
  const uninstallState = join(root, "horseness-uninstall.json");
  const persistUninstall = async (state: string) => { const handle = await open(uninstallState, "w", 0o600); try { await handle.writeFile(JSON.stringify({ schemaVersion: "ClaudeUninstallStateV1", state, killSwitch: true, capability: "revoked", discoveryPath: "temp-owned-plugin" })); await handle.sync(); } finally { await handle.close(); } };
  await persistUninstall("kill_switch_written");
  const disabledPlugin = join(root, "plugin.disabled");
  await rename(plugin, disabledPlugin);
  const rootHandle = await open(root, "r"); try { await rootHandle.sync(); } finally { await rootHandle.close(); }
  await persistUninstall("discovery_disabled");
  await persistUninstall("authority_revoked");
  if (revokedAcceptedRuntime === null) throw new Error("CLAUDE_UNINSTALL_RUNTIME_MISSING");
  await assert.rejects(() => revokedAcceptedRuntime!.deliver("claude-attempt-accepted", { digest: sha(OUTPUT_TEXT), mediaType: "text/plain", byteLength: Buffer.byteLength(OUTPUT_TEXT) }, { digest: sha(EVIDENCE_CLAIM), mediaType: "application/json", byteLength: Buffer.byteLength(EVIDENCE_CLAIM) }), /unknown or revoked/);
  smokeStage = "uninstall-native-restart";
  const postUninstallContext = join(root, "post-uninstall-context.json");
  await writeFile(postUninstallContext, JSON.stringify({ schemaVersion: "HorsenessClaudeContextV1", renderedContext: "post-uninstall inventory check; do not call tools" }), { mode: 0o600 });
  const postUninstall = await runClaude(binary, root, nativeTemp, postUninstallContext, socket, nonce, "Reply with exactly UNINSTALLED_OK. Do not call tools.", undefined, undefined, 1);
  assert.ok(JSON.stringify(postUninstall.result).includes("UNINSTALLED_OK"), "CLAUDE_UNINSTALL_RESTART_FAILED");
  assert.equal(postUninstall.workerToolAdvertised, false, "CLAUDE_UNINSTALL_DISCOVERY_REMAINS");
  await persistUninstall("complete");
  const commandArgv = ["corepack", "pnpm", "run", "host:smoke:claude"] as const;
  const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: resolve(fileURLToPath(new URL("../../..", import.meta.url))), encoding: "utf8", timeout: 5_000, maxBuffer: 4096 });
  const gitTree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: resolve(fileURLToPath(new URL("../../..", import.meta.url))), encoding: "utf8", timeout: 5_000, maxBuffer: 4096 });
  if (gitHead.status !== 0 || gitTree.status !== 0) throw new Error("CLAUDE_CANDIDATE_PROVENANCE_UNAVAILABLE");
  const finishedAtMs = Date.now();
  const receipt = validateClaudeSubscriptionLiveReceiptV1({ schemaVersion: "ClaudeSubscriptionLiveReceiptV1", host: "claude", hostVersion: fixture.artifact.version, observedModel: String(invocation.init.model ?? invocation.result.model ?? ""), candidate: { head: gitHead.stdout.trim(), tree: gitTree.stdout.trim() }, command: { argv: commandArgv, digest: sha(JSON.stringify(commandArgv)), scenarioSetDigest: sha(JSON.stringify({ schemaVersion: "HorsenessClaudeExactScenarioBatchV1", capabilityReferences: scenarioInputs.map(item => item.attemptCapabilityReference) })), batchResponseDigest: sha(JSON.stringify(batchResult)) }, provenance: { archiveDigest: fixture.artifact.archiveSha256, archiveIdentity: fixture.artifact.identity, memberPath: fixture.artifact.executable.path, executableDigest: fixture.artifact.executable.sha256, packageDigest: observedPackageDigest, contributions: observedContributions.map(({ name, digest }) => ({ name, digest })) }, bindings: liveBindings, redactionAudit: { passed: true, prohibitedFields: ["account", "email", "subscriptionId", "credential", "authorization", "token", "cookie", "authPath", "tokenFingerprint"] }, timing: { startedAt: new Date(smokeStartedAtMs).toISOString(), finishedAt: new Date(finishedAtMs).toISOString(), durationMs: finishedAtMs - smokeStartedAtMs }, terminal: { result: "succeeded", reason: "CLAUDE_LIVE_SMOKE_SUCCEEDED" } });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.stdout.write(`${JSON.stringify({ schemaVersion: "ClaudeHostSmokeResultV1", host: "claude", version: fixture.artifact.version, authMode: "existing-user-subscription-session", executableDigest: fixture.artifact.executable.sha256, packageDigest: observedPackageDigest, receiptDigest: acceptedReceipt, decisions: observed, canonicalRevision: acceptedRevision, canonicalDocument: acceptedDocument, sessions: { resumed: acceptedSession, forked: forkSession }, bounds: { scenarios: 5, providerInvocations: 4, workerToolCalls: 1, maxToolCallsPerInvocation: 1, maxTurns: 3, maxContextBytes: 4096, maxOutputBytes: 1024, maxEvidenceBytes: 1024, wallClockMs: MAX_WALL_MS }, lifecycle: { resume: "same-session-marker-no-worker-tool", fork: "new-session-second-fork-pin-marker-no-worker-tool", uninstallDiscovery: "minimal-native-init-disabled", horsenessGrant: "revoked", claudeLogout: "not-performed" } })}\n`);
} catch (error) {
  process.stderr.write(`${redactedReason(error)}:${smokeStage}\n`);
  process.exitCode = 1;
} finally {
  if (server !== undefined) await new Promise<void>(resolveClose => server!.close(() => resolveClose()));
  await rm(root, { recursive: true, force: true });
}
