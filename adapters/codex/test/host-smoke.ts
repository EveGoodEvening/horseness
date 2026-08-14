import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:net";
import { cp, mkdir, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NO_POLICY_DIGEST, NO_POLICY_V1, attemptContextBindingDigest, contextManifestCoreDigest, createRunGenesis, createWorkspaceGenesis, deltaAuthorityScopeDigest, jsonValueDigest, sealEventEnvelope, sealForkPin, sealProposal, type CapabilityV1, type CompositeCursorV1, type ContextManifestCoreV1, type DeltaAuthorityScopeV1, type JsonValue, type ProposalEnvelopeCoreV1 } from "@horseness/domain";
import { AdmissionService, loadRevision, type AdmissionCurrentAuthorityV1, type AdmissionRequestV1 } from "@horseness/orchestrator";
import { sealPolicyDocument, type PolicyEffectV1 } from "@horseness/policy";
import { SQLiteAuthority } from "@horseness/store-sqlite";
import type { BoundAdapterOperationV1, WorkerAdapterV1, WorkerReturnV1 } from "@horseness/protocol";
import type { WorkerReturnClientV1 } from "@horseness/adapter-kit";
import { acquireUpstreamArtifact, verifyOfficialValidation, type C11HostFixtureV1 } from "./c11-upstream-artifact.mjs";
import { CODEX_MCP_SERVER, CODEX_MCP_TOOL, CodexAppServerClient, observeTurn, threadConfig, validatePinnedSchemas, waitForMcpReady, type CodexTurnObservation } from "./app-server-client.js";
import { CODEX_ADAPTER_ID, CODEX_NATIVE_PACKAGE_METADATA, codexDoctorV1, codexNativePackageDigestV1, createCodexAdapterV1, createCodexNativeContributionRuntimeV1, createCodexRetainedDeliveryAuthorityV1, validateCodexSubscriptionLiveReceiptV1, type CodexNativeAttemptV1, type CodexNativeContributionRuntimeV1, type CodexNativeRuntimeV1, type CodexNativeWorkerReturnBatchEvidenceV1, type CodexNativeWorkerReturnBatchResultV1, type CodexWorkerReturnRegistrationV1, type CodexSubscriptionLiveReceiptV1 } from "../src/index.js";

const MAX_WALL_MS = 120_000;
const OUTPUT_TEXT = "value2";
const EVIDENCE_CLAIM = "Codex Code model invoked the native Horseness MCP contribution";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const fixturePath = fileURLToPath(new URL("../../../tests/fixtures/hosts/codex/manifest.v1.json", import.meta.url));
const pluginSource = fileURLToPath(new URL("../native/plugin", import.meta.url));
const redactedReason = (value: unknown) => {
  const text = value instanceof Error ? value.message : String(value);
  if (/^(?:CODEX|HORSENESS|INVALID|UNKNOWN)_[A-Z0-9_]+$/.test(text)) return text;
  if (/login|\bauth\b|authentication|credential|token|subscription|unauthorized|forbidden/i.test(text)) return "CODEX_SUBSCRIPTION_SESSION_UNUSABLE";
  if (/rate.?limit|too many requests|\b429\b|overloaded/i.test(text)) return "CODEX_PROVIDER_RATE_LIMITED";
  if (/timed? ?out|timeout/i.test(text)) return "CODEX_NATIVE_TIMEOUT";
  if (/mcp|server.*failed|connection.*closed/i.test(text)) return "CODEX_NATIVE_MCP_UNAVAILABLE";
  if (/hook|context/i.test(text)) return "CODEX_NATIVE_CONTEXT_FAILED";
  if (/allowed.?tools?|unknown tool/i.test(text)) return "CODEX_NATIVE_INVENTORY_INVALID";
  if (/stream|session.id/i.test(text)) return "CODEX_NATIVE_STREAM_INVALID";
  if (/proposal|envelope/i.test(text)) return "CODEX_WORKER_PROPOSAL_FAILED";
  if (/output digest/i.test(text)) return "CODEX_WORKER_OUTPUT_DIGEST_MISMATCH";
  if (/evidence digest/i.test(text)) return "CODEX_WORKER_EVIDENCE_DIGEST_MISMATCH";
  if (/evidence descriptor/i.test(text)) return "CODEX_WORKER_EVIDENCE_DESCRIPTOR_MISMATCH";
  if (/receipt|provider output|evidence/i.test(text)) return "CODEX_WORKER_RECEIPT_FAILED";
  if (/retained|compare-and-set|lock/i.test(text)) return "CODEX_WORKER_RETAINED_FAILED";
  if (/decision|resume/i.test(text)) return "CODEX_WORKER_DECISION_FAILED";
  if (/binding|capability/i.test(text)) return "CODEX_WORKER_BINDING_FAILED";
  return "CODEX_NATIVE_HOST_FAILED";
};

type NativeObservation = CodexTurnObservation & { readonly batchResult: CodexNativeWorkerReturnBatchResultV1 | null };
const objectValue = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`CODEX_${label}_INVALID`);
  return value as Record<string, unknown>;
};
const extractToolText = (result: unknown): string | null => {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return null;
  const content = (result as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  const text = content.find(item => item !== null && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
  return typeof text?.text === "string" ? text.text : null;
};
async function runTurn(client: CodexAppServerClient, threadId: string, skillPath: string, prompt: string, context: string): Promise<NativeObservation> {
  const observation = await observeTurn(client, threadId, {
    additionalContext: { "horseness-bound-attempt": { kind: "application", value: context } },
    input: [
      { type: "skill", name: "horseness-worker", path: skillPath },
      { type: "text", text: prompt, text_elements: [] },
    ],
  });
  let batchResult: CodexNativeWorkerReturnBatchResultV1 | null = null;
  if (observation.mcpCalls.length === 1) {
    const text = extractToolText(observation.mcpCalls[0]!.result);
    if (text !== null) batchResult = JSON.parse(text) as CodexNativeWorkerReturnBatchResultV1;
  }
  return { ...observation, batchResult };
}
function assertHorsenessInventoryAbsent(inventory: Record<string, unknown>, boundary: string): void {
  if (JSON.stringify(inventory).includes(CODEX_MCP_SERVER) || JSON.stringify(inventory).includes(CODEX_MCP_TOOL)) throw new Error(`CODEX_UNINSTALL_${boundary}_INVENTORY_REMAINS`);
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
  const workspaceId = `codex-${desired}`, runId = "run", taskId = "task", attemptId = "attempt";
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
  const binding: BoundAdapterOperationV1 = { schemaVersion: "1", workspaceId, runId, taskId, attemptId, generation: 1, forkPinDigest: fork.forkPinDigest, contextManifestCoreDigest: contextManifestCoreDigest(manifest), attemptContextBindingDigest: attemptContextBindingDigest(contextBinding), providerIdempotencyKeyDigest: sha(`provider-${desired}`), attemptCapability: `codex-attempt-${desired}` };
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
async function runtimeServer(path: string, nonce: string, runtimes: Map<string, ReturnType<typeof createCodexNativeContributionRuntimeV1>>): Promise<Server> {
  await unlink(path).catch(() => undefined);
  const server = createServer({ allowHalfOpen: true }, socket => {
    socket.setEncoding("utf8"); let wire = "";
    socket.on("error", () => undefined);
    socket.on("data", chunk => { wire += chunk; if (Buffer.byteLength(wire) > 64 * 1024) socket.destroy(); });
    socket.on("end", async () => {
      try {
        const request = JSON.parse(wire) as ({ schemaVersion: "HorsenessCodexSessionStartRequestV1"; nonce: string; start: { sessionId: string; source: "startup" | "resume" | "fork" | "clear" | "compact"; previousSessionId?: string; branchEntryId?: string } } | { schemaVersion: "HorsenessCodexRuntimeRequestV1"; nonce: string; threadClaim: string; input: { scenarios: readonly { attemptCapabilityReference: string; output: { digest: string; mediaType: string; byteLength: number }; evidence: { digest: string; mediaType: string; byteLength: number } }[] } });
        if (request.nonce !== nonce) throw new Error("HORSENESS_RUNTIME_AUTHORITY_REJECTED");
        if (request.schemaVersion === "HorsenessCodexSessionStartRequestV1") {
          const candidates = [...new Set(runtimes.values())]; if (candidates.length !== 1) throw new Error("HORSENESS_SESSION_RUNTIME_AMBIGUOUS");
          const context = await candidates[0]!.registerSessionStart(request.start);
          socket.end(`${JSON.stringify({ schemaVersion: "HorsenessCodexRuntimeResponseV1", ok: true, context: { schemaVersion: "HorsenessCodexAttemptContextV1", ...context } })}\n`); return;
        }
        if (request.input.scenarios.length !== 5) throw new Error("INVALID_EXACT_SCENARIO_BATCH");
        const runtime = runtimes.get(request.input.scenarios[0]!.attemptCapabilityReference);
        if (runtime === undefined || request.input.scenarios.some(item => runtimes.get(item.attemptCapabilityReference) !== runtime)) throw new Error("HORSENESS_ATTEMPT_GRANT_REVOKED");
        const sessionId = runtime.sessionForThreadClaim(request.threadClaim);
        const result = await runtime.deliverBatch(request.input.scenarios, request.threadClaim, sessionId);
        socket.end(`${JSON.stringify({ schemaVersion: "HorsenessCodexRuntimeResponseV1", ok: true, result })}\n`);
      } catch (error) { socket.end(`${JSON.stringify({ schemaVersion: "HorsenessCodexRuntimeResponseV1", ok: false, reason: redactedReason(error) })}\n`); }
    });
  });
  await new Promise<void>((resolveListen, reject) => server.once("error", reject).listen(path, resolveListen));
  return server;
}

const cacheParent = join(tmpdir(), "horseness-codex-smoke");
await mkdir(cacheParent, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(cacheParent, "run-"));
const smokeStartedAtMs = Date.now();
let server: Server | undefined;
let appServer: CodexAppServerClient | undefined;
let smokeStage = "acquire";
try {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as C11HostFixtureV1;
  const acquired = await acquireUpstreamArtifact(fixture.artifact, { cacheRoot: resolve(process.env.HORSENESS_HOST_CACHE ?? ".cache/horseness/hosts") });
  smokeStage = "official-validation";
  const official = await verifyOfficialValidation(fixture, acquired);
  const binary = official.executablePath;
  assert.equal(`sha256:${sha(await readFile(binary))}`, fixture.artifact.executable.sha256);
  smokeStage = "schema-validation";
  const schemaDigest = await validatePinnedSchemas(binary, root);
  smokeStage = "plugin-validation";
  const marketplace = join(root, "marketplace");
  const plugin = join(marketplace, "plugins", "horseness-codex");
  await mkdir(join(marketplace, ".agents", "plugins"), { recursive: true, mode: 0o700 });
  await cp(pluginSource, plugin, { recursive: true });
  const observedContributions = await Promise.all(CODEX_NATIVE_PACKAGE_METADATA.contributions.map(async item => ({ kind: item.kind, name: item.name, digest: `sha256:${sha(await readFile(join(pluginSource, item.name.replace(/^plugin\//, ""))))}` })));
  const observedPackageDigest = codexNativePackageDigestV1(observedContributions);
  const marketplaceManifest = join(marketplace, ".agents", "plugins", "marketplace.json");
  await writeFile(marketplaceManifest, JSON.stringify({ name: "horseness-c18", interface: { displayName: "Horseness C18" }, plugins: [{ name: "horseness-codex", source: { source: "local", path: "./plugins/horseness-codex" }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Developer Tools" }] }), { mode: 0o600 });
  const doctor = codexDoctorV1({ nativePackageVersion: fixture.artifact.version, loaderDigest: fixture.artifact.executable.sha256, contributions: observedContributions.map(({ name, digest }) => ({ name, digest })) });
  if (doctor.checks.some(check => check.status !== "ok") || observedPackageDigest !== CODEX_NATIVE_PACKAGE_METADATA.packageDigest) throw new Error("CODEX_NATIVE_PACKAGE_PROVENANCE_MISMATCH");
  const nativeEnvironment = { ...process.env, TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp") };
  await mkdir(nativeEnvironment.TMPDIR, { recursive: true, mode: 0o700 });
  appServer = await CodexAppServerClient.start(binary, root, nativeEnvironment);
  const addedMarketplace = objectValue(await appServer.request("marketplace/add", { source: marketplace }), "MARKETPLACE_ADD");
  const marketplaceName = String(addedMarketplace.marketplaceName ?? "");
  if (marketplaceName.length === 0) throw new Error("CODEX_MARKETPLACE_ID_MISSING");
  await appServer.request("plugin/install", { pluginName: "horseness-codex", marketplacePath: marketplaceManifest });
  const pluginId = "horseness-codex@horseness-c18";
  const installedInventory = objectValue(await appServer.request("plugin/installed", { cwds: [root] }), "PLUGIN_INSTALLED");
  if (!JSON.stringify(installedInventory).includes(pluginId) || !JSON.stringify(installedInventory).includes('"enabled":true')) throw new Error("CODEX_INSTALLED_PLUGIN_NOT_ENABLED");
  const pluginRead = objectValue(await appServer.request("plugin/read", { marketplacePath: marketplaceManifest, pluginName: "horseness-codex" }), "PLUGIN_READ");
  const pluginDetail = objectValue(pluginRead.plugin, "PLUGIN_DETAIL");
  if (!JSON.stringify(pluginDetail).includes(pluginId) || !Array.isArray(pluginDetail.mcpServers) || !pluginDetail.mcpServers.includes(CODEX_MCP_SERVER)) throw new Error("CODEX_INSTALLED_PLUGIN_DECLARATION_INVALID");
  if (String(addedMarketplace.installedRoot ?? "").length === 0) throw new Error("CODEX_INSTALLED_MARKETPLACE_ROOT_MISSING");
  const skills = pluginDetail.skills;
  if (!Array.isArray(skills)) throw new Error("CODEX_INSTALLED_SKILL_MISSING");
  const skillSummary = skills.find(item => item !== null && typeof item === "object" && typeof (item as Record<string, unknown>).path === "string" && String((item as Record<string, unknown>).path).includes("horseness-worker")) as Record<string, unknown> | undefined;
  const nativeSkillPath = String(skillSummary?.path ?? "");
  const skillPath = resolve(nativeSkillPath.endsWith("SKILL.md") ? nativeSkillPath : join(nativeSkillPath, "SKILL.md"));
  if (!skillPath.endsWith("/skills/horseness-worker/SKILL.md")) throw new Error("CODEX_INSTALLED_SKILL_PATH_INVALID");
  const installedPluginRoot = dirname(dirname(dirname(skillPath)));
  const installedObserved = await Promise.all(CODEX_NATIVE_PACKAGE_METADATA.contributions.map(async item => ({ kind: item.kind, name: item.name, digest: `sha256:${sha(await readFile(join(installedPluginRoot, item.name.replace(/^plugin\//, ""))))}` })));
  if (codexNativePackageDigestV1(installedObserved) !== CODEX_NATIVE_PACKAGE_METADATA.packageDigest) throw new Error("CODEX_INSTALLED_PLUGIN_PROVENANCE_MISMATCH");
  const installedMcp = objectValue(JSON.parse(await readFile(join(installedPluginRoot, ".mcp.json"), "utf8")), "INSTALLED_MCP");
  const declaredServer = objectValue(objectValue(installedMcp.mcpServers, "INSTALLED_MCP_SERVERS")[CODEX_MCP_SERVER], "INSTALLED_MCP_SERVER");
  const declaredArgs = declaredServer.args;
  if (!Array.isArray(declaredArgs) || declaredArgs.length !== 1 || typeof declaredArgs[0] !== "string") throw new Error("CODEX_INSTALLED_MCP_DECLARATION_INVALID");
  const serverPath = resolve(installedPluginRoot, declaredArgs[0]);
  if (!serverPath.startsWith(`${resolve(installedPluginRoot)}/`)) throw new Error("CODEX_INSTALLED_MCP_PATH_ESCAPES_PLUGIN");
  const resolvedMcpDeclarationDigest = `sha256:${sha(JSON.stringify({ pluginId, installedPluginRoot, declaration: installedMcp, serverDigest: `sha256:${sha(await readFile(serverPath))}` }))}`;
  const skillBytes = await readFile(skillPath, "utf8");
  const developerInstructions = await readFile(join(installedPluginRoot, "AGENTS.md"), "utf8");
  let acceptedReceipt = ""; let acceptedSession = ""; let forkSession = ""; let acceptedRevision = 0; let acceptedDocument: JsonValue = null; let revokedAcceptedRuntime: CodexNativeContributionRuntimeV1 | null = null; const liveBindings: CodexSubscriptionLiveReceiptV1["bindings"][number][] = [];
  const decisions = ["accepted", "rejected", "conflicted", "quarantined", "approval_required"] as const;
  const retained = createCodexRetainedDeliveryAuthorityV1(join(root, "retained"));
  const scenarioAuthorities: AuthorityScenario[] = [];
  const registrations: CodexWorkerReturnRegistrationV1[] = [];
  let acceptedAdapter: WorkerAdapterV1 | null = null; let acceptedAttempt: CodexNativeAttemptV1 | null = null;
  const outputDigest = sha(OUTPUT_TEXT); const evidenceDigest = sha(EVIDENCE_CLAIM);
  for (const outcome of decisions) {
    const scenario = join(root, outcome); await mkdir(scenario, { mode: 0o700 });
    const authorityScenario = createAuthorityScenario(scenario, outcome); scenarioAuthorities.push(authorityScenario);
    const binding = authorityScenario.binding;
    const attempt: CodexNativeAttemptV1 = { providerOperationId: `codex-operation-${outcome}`, nativeSessionId: `pending-${outcome}`, startedAt: "2026-08-14T00:00:00Z", finishedAt: "2026-08-14T00:00:01Z", outcome: "succeeded", outputDigest, evidence: [{ digest: evidenceDigest, mediaType: "application/json", size: Buffer.byteLength(EVIDENCE_CLAIM) }], provenance: { authMode: "existing-user-subscription-session", host: "codex", version: "0.144.1-linux-x64" } };
    const provider: CodexNativeRuntimeV1 = { async launch() { return attempt; }, async cancel() { return attempt; }, async reconcile() { return attempt; }, async resume() { return attempt; }, async collect() { return attempt; } };
    const adapter = createCodexAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: `horseness.grant.${outcome}`, scope: { workspaceId: binding.workspaceId, adapterId: CODEX_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime: provider, producerPrincipalId: "worker", producerGrantDigest: "grant" });
    await adapter.launch({ ...binding, operation: "launch", renderedContextDigest: sha(`context-${outcome}`), providerOptions: {} });
    if (outcome === "accepted") { acceptedAdapter = adapter; acceptedAttempt = attempt; }
    registrations.push({ capabilityReference: binding.attemptCapability, binding, adapter, authority: { client: authorityScenario.client, async sealProposal(_binding, receipt) { return authorityScenario.seal(receipt); }, async canonicalAcceptedAdvance() { const revision = loadRevision(authorityScenario.authority, binding.workspaceId, binding.runId); return { workspaceId: binding.workspaceId, runId: binding.runId, revision: revision.revision, stateHash: revision.stateHash }; } }, subscriptionId: `subscription-${outcome}` });
  }
  const acceptedRegistration = registrations[0]!;
  const forkBinding: BoundAdapterOperationV1 = { ...acceptedRegistration.binding, attemptId: "attempt-fork", forkPinDigest: sha("accepted-fork-pin"), attemptContextBindingDigest: sha("accepted-fork-binding"), providerIdempotencyKeyDigest: sha("accepted-fork-key"), attemptCapability: "codex-attempt-accepted-fork" };
  if (acceptedAdapter === null || acceptedAttempt === null) throw new Error("CODEX_ACCEPTED_LIFECYCLE_MISSING");
  const acceptedProvider = acceptedAdapter;
  const acceptedProviderAttempt = acceptedAttempt;
  const forkProvider: CodexNativeRuntimeV1 = { async launch() { return acceptedProviderAttempt; }, async cancel() { return acceptedProviderAttempt; }, async reconcile() { return acceptedProviderAttempt; }, async resume() { return acceptedProviderAttempt; }, async collect() { return acceptedProviderAttempt; } };
  const forkAdapter = createCodexAdapterV1({ binding: forkBinding, credential: { schemaVersion: "1", kind: "host-reference", reference: "horseness.grant.accepted.fork", scope: { workspaceId: forkBinding.workspaceId, adapterId: CODEX_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime: forkProvider, producerPrincipalId: "worker", producerGrantDigest: "grant" });
  await forkAdapter.launch({ ...forkBinding, operation: "launch", renderedContextDigest: sha("context-accepted-fork"), providerOptions: {} });
  registrations.push({ ...acceptedRegistration, capabilityReference: forkBinding.attemptCapability, binding: forkBinding, adapter: forkAdapter });
  const sessionRoot = join(root, "sessions");
  const retainedRoot = join(root, "retained");
  const uninstallState = join(root, "horseness-uninstall.json");
  let retainedAuthority = retained;
  const makeRuntime = () => createCodexNativeContributionRuntimeV1(registrations, { retained: retainedAuthority, sessionStateDirectory: sessionRoot, killSwitchPath: uninstallState, attemptContexts: registrations.map(item => ({ attemptCapabilityReference: item.capabilityReference, binding: item.binding, renderedContext: `immutable Codex context for ${item.binding.attemptId}`, renderedContextDigest: sha(`context-${item.binding.attemptId}`) })), initialAttemptCapabilityReference: acceptedRegistration.capabilityReference });
  let runtime = makeRuntime();
  let runtimes = new Map(registrations.map(item => [item.capabilityReference, runtime]));
  const socket = join(root, "runtime.sock"); const nonce = randomBytes(32).toString("hex"); server = await runtimeServer(socket, nonce, runtimes);
  const immutableContext = `horseness-context-v1; attemptCapabilityReference=${acceptedRegistration.capabilityReference}; forkPinDigest=${acceptedRegistration.binding.forkPinDigest}; contextManifestCoreDigest=${acceptedRegistration.binding.contextManifestCoreDigest}; attemptContextBindingDigest=${acceptedRegistration.binding.attemptContextBindingDigest}`;
  if (!skillBytes.includes("horseness_worker_return") || !developerInstructions.includes("horseness-worker")) throw new Error("CODEX_VERIFIED_PLUGIN_INSTRUCTIONS_INVALID");
  const initialClaim = randomBytes(32).toString("hex");
  runtime.registerThreadClaim({ claim: initialClaim, attemptCapabilityReferences: registrations.slice(0, 5).map(item => item.capabilityReference), primaryAttemptCapabilityReference: acceptedRegistration.capabilityReference });
  const config = threadConfig(serverPath, socket, nonce, initialClaim);
  smokeStage = "thread-start";
  const started = objectValue(await appServer.request("thread/start", { cwd: root, config, developerInstructions: `${developerInstructions}\n${immutableContext}`, approvalPolicy: "never", sandbox: "read-only" }), "THREAD_START");
  const startedThread = objectValue(started.thread, "THREAD_START_THREAD");
  acceptedSession = String(startedThread.id ?? "");
  if (acceptedSession.length === 0) throw new Error("CODEX_THREAD_ID_MISSING");
  await runtime.bindThreadClaim(initialClaim, acceptedSession, { source: "startup" });
  const inventory = await waitForMcpReady(appServer, acceptedSession);
  const scenarioInputs = decisions.map((_outcome, index) => ({ attemptCapabilityReference: registrations[index]!.capabilityReference, outputText: OUTPUT_TEXT, evidenceClaim: EVIDENCE_CLAIM }));
  const prompt = `Use the verified installed horseness-worker skill. Invoke ${CODEX_MCP_TOOL} exactly once with this exact batch and no substitutions: ${JSON.stringify({ scenarios: scenarioInputs })}. Do not use any other tool. Return the tool result.`;
  smokeStage = "decision-batch-invoke";
  const invocation = await runTurn(appServer, acceptedSession, skillPath, prompt, immutableContext);
  if (invocation.mcpCalls.length !== 1) throw new Error("CODEX_NATIVE_TOOL_CALL_COUNT_INVALID");
  const nativeCall = invocation.mcpCalls[0]!;
  if (nativeCall.server !== CODEX_MCP_SERVER || nativeCall.tool !== CODEX_MCP_TOOL || nativeCall.status !== "completed" || nativeCall.result === null || nativeCall.error !== null) throw new Error("CODEX_NATIVE_MCP_CALL_INVALID");
  if (nativeCall.pluginId !== null) throw new Error("CODEX_PINNED_THREAD_OVERRIDE_PLUGIN_ATTRIBUTION_CHANGED");
  const batchResult = invocation.batchResult;
  if (batchResult === null || batchResult.schemaVersion !== "HorsenessCodexWorkerReturnBatchResultV1" || batchResult.sessionId !== acceptedSession || batchResult.results.length !== 5) throw new Error("CODEX_NATIVE_BATCH_RESULT_INVALID");
  const observed: string[] = [];
  for (const [index, outcome] of decisions.entries()) {
    const binding = registrations[index]!.binding;
    const record = retained.load(`${binding.workspaceId}:${binding.runId}:${binding.taskId}:${binding.attemptId}:${binding.generation}`);
    if (record === undefined || record.decision !== outcome || record.resumeToken !== `authority-resume-${outcome}`) throw new Error("CODEX_RETAINED_BATCH_MISMATCH");
    const batchEvidence: CodexNativeWorkerReturnBatchEvidenceV1 | undefined = batchResult.results[index];
    if (batchEvidence === undefined || batchEvidence.workspaceId !== binding.workspaceId || batchEvidence.runId !== binding.runId || batchEvidence.taskId !== binding.taskId || batchEvidence.attemptId !== binding.attemptId || batchEvidence.generation !== binding.generation || batchEvidence.decision !== outcome || batchEvidence.receiptDigest !== record.workerReturn.receipt.receiptDigest || batchEvidence.proposalDigest !== record.workerReturn.proposal.proposalDigest || batchEvidence.outputDigest !== record.workerReturn.receipt.outputDigest || JSON.stringify(batchEvidence.evidenceDigests) !== JSON.stringify(record.workerReturn.receipt.evidence.map(item => item.digest))) throw new Error("CODEX_NATIVE_BATCH_EVIDENCE_MISMATCH");
    observed.push(record.decision);
    liveBindings.push({ workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, forkPinDigest: binding.forkPinDigest, contextManifestCoreDigest: binding.contextManifestCoreDigest, attemptContextBindingDigest: binding.attemptContextBindingDigest, receiptDigest: batchEvidence.receiptDigest, proposalDigest: batchEvidence.proposalDigest, outputDigest: batchEvidence.outputDigest, evidenceDigests: batchEvidence.evidenceDigests });
    if (outcome === "accepted") { acceptedReceipt = batchEvidence.receiptDigest; const canonical = loadRevision(scenarioAuthorities[index]!.authority, binding.workspaceId, binding.runId); acceptedRevision = canonical.revision; acceptedDocument = canonical.document; assert.deepEqual(batchResult.canonicalAcceptedAdvance, { workspaceId: binding.workspaceId, runId: binding.runId, revision: canonical.revision, stateHash: canonical.stateHash }); }
  }
  smokeStage = "real-host-restart";
  await appServer.close(); appServer = undefined;
  await new Promise<void>((resolveClose, reject) => server!.close(error => error ? reject(error) : resolveClose())); server = undefined;
  await runtime.shutdown();
  retainedAuthority = createCodexRetainedDeliveryAuthorityV1(retainedRoot);
  runtime = makeRuntime(); runtimes = new Map(registrations.map(item => [item.capabilityReference, runtime]));
  server = await runtimeServer(socket, nonce, runtimes);
  appServer = await CodexAppServerClient.start(binary, root, nativeEnvironment);
  const restartedInstalled = objectValue(await appServer.request("plugin/installed", { cwds: [root] }), "RESTARTED_PLUGIN_INSTALLED");
  if (!JSON.stringify(restartedInstalled).includes(pluginId)) throw new Error("CODEX_RESTARTED_PLUGIN_DISCOVERY_MISSING");
  const resumeClaim = randomBytes(32).toString("hex");
  runtime.registerThreadClaim({ claim: resumeClaim, attemptCapabilityReferences: [acceptedRegistration.capabilityReference], primaryAttemptCapabilityReference: acceptedRegistration.capabilityReference });
  const resumeConfig = threadConfig(serverPath, socket, nonce, resumeClaim);
  const resumedResponse = objectValue(await appServer.request("thread/resume", { threadId: acceptedSession, cwd: root, config: resumeConfig, developerInstructions: `${developerInstructions}\n${immutableContext}` }), "THREAD_RESUME");
  const resumedThread = objectValue(resumedResponse.thread, "THREAD_RESUME_THREAD");
  assert.equal(resumedThread.id, acceptedSession);
  await runtime.bindThreadClaim(resumeClaim, acceptedSession, { source: "resume", previousSessionId: acceptedSession });
  await waitForMcpReady(appServer, acceptedSession);
  const resumed = await runTurn(appServer, acceptedSession, skillPath, "Use the verified installed horseness-worker skill. Reply with exactly RESUME_OK. Do not call tools.", immutableContext);
  assert.equal(resumed.threadId, acceptedSession); assert.equal(resumed.mcpCalls.length, 0); assert.ok(resumed.assistantText.includes("RESUME_OK"));
  await acceptedProvider.reconcile({ ...acceptedRegistration.binding, operation: "reconcile", providerOperationId: acceptedProviderAttempt.providerOperationId });
  await acceptedProvider.resume({ ...acceptedRegistration.binding, operation: "reattach", providerOperationId: acceptedProviderAttempt.providerOperationId, nativeSessionId: acceptedSession });
  await acceptedProvider.resume({ ...acceptedRegistration.binding, operation: "resume", providerOperationId: acceptedProviderAttempt.providerOperationId, nativeSessionId: acceptedSession });
  runtime.registerBranch({ entryId: "accepted-fork", previousSessionFile: acceptedSession, attemptCapabilityReference: forkBinding.attemptCapability });
  assert.throws(() => runtime.registerBranch({ entryId: "accepted-fork", previousSessionFile: acceptedSession, attemptCapabilityReference: acceptedRegistration.capabilityReference }), /cannot overwrite or substitute/);
  const forkContext = `horseness-context-v1; attemptCapabilityReference=${forkBinding.attemptCapability}; forkPinDigest=${forkBinding.forkPinDigest}; contextManifestCoreDigest=${forkBinding.contextManifestCoreDigest}; attemptContextBindingDigest=${forkBinding.attemptContextBindingDigest}`;
  const forkClaim = randomBytes(32).toString("hex");
  runtime.registerThreadClaim({ claim: forkClaim, attemptCapabilityReferences: [forkBinding.attemptCapability], primaryAttemptCapabilityReference: forkBinding.attemptCapability });
  smokeStage = "session-fork-marker";
  const forkResponse = objectValue(await appServer.request("thread/fork", { threadId: acceptedSession, cwd: root, config: threadConfig(serverPath, socket, nonce, forkClaim), developerInstructions: `${developerInstructions}\n${forkContext}` }), "THREAD_FORK");
  const forkThread = objectValue(forkResponse.thread, "THREAD_FORK_THREAD");
  forkSession = String(forkThread.id ?? "");
  if (forkSession.length === 0 || forkSession === acceptedSession) throw new Error("CODEX_FORK_THREAD_ID_INVALID");
  await runtime.bindThreadClaim(forkClaim, forkSession, { source: "fork", previousSessionId: acceptedSession, branchEntryId: "accepted-fork" });
  await waitForMcpReady(appServer, forkSession);
  const forked = await runTurn(appServer, forkSession, skillPath, "Use the verified installed horseness-worker skill. Reply with exactly FORK_OK. Do not call tools.", forkContext);
  assert.equal(forked.threadId, forkSession); assert.equal(forked.mcpCalls.length, 0); assert.ok(forked.assistantText.includes("FORK_OK"));
  assert.deepEqual(observed, decisions); assert.equal(acceptedRevision, 1); assert.deepEqual(acceptedDocument, { value: 2 });
  await new Promise<void>((resolveClose, reject) => server!.close(error => error ? reject(error) : resolveClose())); server = undefined;
  for (const scenario of scenarioAuthorities) scenario.authority.close();
  revokedAcceptedRuntime = runtime;
  type UninstallPhase = "kill_switch_written" | "discovery_disabled" | "authority_revoked" | "complete";
  type UninstallCrash = UninstallPhase | "after_plugin_uninstall";
  const syncDirectory = async (path: string) => { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } };
  const persistUninstall = async (state: UninstallPhase) => {
    const temporary = `${uninstallState}.${randomBytes(8).toString("hex")}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify({ schemaVersion: "CodexUninstallStateV1", state, killSwitch: true, pluginId, marketplaceName, installedPluginRoot })); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, uninstallState); await syncDirectory(root);
  };
  const readUninstall = async (): Promise<UninstallPhase | null> => {
    try { const state = objectValue(JSON.parse(await readFile(uninstallState, "utf8")), "UNINSTALL_STATE"); if (state.killSwitch !== true) throw new Error("CODEX_UNINSTALL_KILL_SWITCH_INVALID"); return state.state as UninstallPhase; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  const injectCrash = (point: UninstallCrash, requested?: UninstallCrash) => { if (point === requested) throw new Error(`CRASH_AFTER_${point.toUpperCase()}`); };
  const disableDiscovery = async (crashAfter?: UninstallCrash) => {
    const installed = await appServer!.request("plugin/installed", { cwds: [root] });
    if (JSON.stringify(installed).includes(pluginId)) await appServer!.request("plugin/uninstall", { pluginId });
    injectCrash("after_plugin_uninstall", crashAfter);
    await appServer!.request("marketplace/remove", { marketplaceName });
  };
  const resumeUninstall = async (crashAfter?: UninstallCrash) => {
    let phase = await readUninstall();
    if (phase === null) { await persistUninstall("kill_switch_written"); injectCrash("kill_switch_written", crashAfter); phase = "kill_switch_written"; }
    if (phase === "kill_switch_written") { await disableDiscovery(crashAfter); await persistUninstall("discovery_disabled"); injectCrash("discovery_disabled", crashAfter); phase = "discovery_disabled"; }
    if (phase === "discovery_disabled") { await runtime.revoke(); await persistUninstall("authority_revoked"); injectCrash("authority_revoked", crashAfter); phase = "authority_revoked"; }
    if (phase === "authority_revoked") await persistUninstall("complete");
  };
  const restartForRecovery = async () => { await appServer!.close(); appServer = await CodexAppServerClient.start(binary, root, nativeEnvironment); };
  const assertFreshAbsent = async (boundary: string) => {
    const freshResponse = objectValue(await appServer!.request("thread/start", { cwd: root, developerInstructions: "post-uninstall inventory verification", approvalPolicy: "never", sandbox: "read-only" }), "POST_UNINSTALL_THREAD");
    const freshThread = objectValue(freshResponse.thread, "POST_UNINSTALL_THREAD_VALUE");
    const freshInventory = objectValue(await appServer!.request("mcpServerStatus/list", { threadId: String(freshThread.id ?? ""), detail: "full" }), "POST_UNINSTALL_INVENTORY");
    assertHorsenessInventoryAbsent(freshInventory, boundary);
    const installed = await appServer!.request("plugin/installed", { cwds: [root] }); if (JSON.stringify(installed).includes(pluginId)) throw new Error(`CODEX_UNINSTALL_${boundary}_PLUGIN_REMAINS`);
  };
  smokeStage = "uninstall";
  smokeStage = "uninstall-kill-switch";
  await assert.rejects(() => resumeUninstall("kill_switch_written"), /CRASH_AFTER_KILL_SWITCH_WRITTEN/);
  assert.throws(() => revokedAcceptedRuntime!.sessionForThreadClaim(initialClaim), /kill switch|unknown/);
  smokeStage = "uninstall-restart-after-kill-switch"; await restartForRecovery();
  smokeStage = "uninstall-after-plugin-remove"; await assert.rejects(() => resumeUninstall("after_plugin_uninstall"), /CRASH_AFTER_AFTER_PLUGIN_UNINSTALL/);
  smokeStage = "uninstall-restart-after-plugin-remove"; await restartForRecovery();
  smokeStage = "uninstall-discovery-disabled"; await resumeUninstall("discovery_disabled").catch(error => { if (!String(error).includes("CRASH_AFTER_DISCOVERY_DISABLED")) throw error; });
  smokeStage = "uninstall-inventory-discovery-disabled"; await restartForRecovery(); await assertFreshAbsent("DISCOVERY_DISABLED");
  smokeStage = "uninstall-authority-revoked"; await assert.rejects(() => resumeUninstall("authority_revoked"), /CRASH_AFTER_AUTHORITY_REVOKED/);
  smokeStage = "uninstall-inventory-authority-revoked"; await restartForRecovery(); await assertFreshAbsent("AUTHORITY_REVOKED");
  smokeStage = "uninstall-complete"; await resumeUninstall();
  if (revokedAcceptedRuntime === null) throw new Error("CODEX_UNINSTALL_RUNTIME_MISSING");
  await assert.rejects(() => revokedAcceptedRuntime!.deliver("codex-attempt-accepted", { digest: sha(OUTPUT_TEXT), mediaType: "text/plain", byteLength: Buffer.byteLength(OUTPUT_TEXT) }, { digest: sha(EVIDENCE_CLAIM), mediaType: "application/json", byteLength: Buffer.byteLength(EVIDENCE_CLAIM) }, acceptedSession), /kill switch|unknown or revoked|runtime is revoked/);
  await appServer.close(); appServer = undefined;
  const commandArgv = ["corepack", "pnpm", "run", "host:smoke:codex"] as const;
  const gitHead = spawnSync("git", ["rev-parse", "HEAD"], { cwd: resolve(fileURLToPath(new URL("../../..", import.meta.url))), encoding: "utf8", timeout: 5_000, maxBuffer: 4096 });
  const gitTree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: resolve(fileURLToPath(new URL("../../..", import.meta.url))), encoding: "utf8", timeout: 5_000, maxBuffer: 4096 });
  if (gitHead.status !== 0 || gitTree.status !== 0) throw new Error("CODEX_CANDIDATE_PROVENANCE_UNAVAILABLE");
  const finishedAtMs = Date.now();
  const receipt = validateCodexSubscriptionLiveReceiptV1({ schemaVersion: "CodexSubscriptionLiveReceiptV1", host: "codex", authMode: "existing-user-subscription-session", hostVersion: fixture.artifact.version, observedModel: String(started.model ?? ""), candidate: { head: gitHead.stdout.trim(), tree: gitTree.stdout.trim() }, command: { argv: commandArgv, digest: sha(JSON.stringify(commandArgv)), scenarioSetDigest: sha(JSON.stringify({ schemaVersion: "HorsenessCodexExactScenarioBatchV1", capabilityReferences: scenarioInputs.map(item => item.attemptCapabilityReference) })), batchResponseDigest: sha(JSON.stringify(batchResult)) }, provenance: { archiveDigest: fixture.artifact.archiveSha256, archiveIdentity: fixture.artifact.identity, memberPath: fixture.artifact.executable.path, executableDigest: fixture.artifact.executable.sha256, packageDigest: observedPackageDigest, contributions: observedContributions.map(({ name, digest }) => ({ name, digest })), nativePlugin: { observedPluginId: pluginId, nativeItemPluginId: null, nativeItemPluginIdReason: "PINNED_HOST_THREAD_OVERRIDE", resolvedDeclarationDigest: resolvedMcpDeclarationDigest } }, bindings: liveBindings, redactionAudit: { passed: true, prohibitedFields: ["account", "email", "subscriptionId", "credential", "authorization", "token", "cookie", "authPath", "tokenFingerprint"] }, timing: { startedAt: new Date(smokeStartedAtMs).toISOString(), finishedAt: new Date(finishedAtMs).toISOString(), durationMs: finishedAtMs - smokeStartedAtMs }, terminal: { result: "succeeded", reason: "CODEX_LIVE_SMOKE_SUCCEEDED" } });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.stdout.write(`${JSON.stringify({ schemaVersion: "CodexHostSmokeResultV1", host: "codex", version: fixture.artifact.version, authMode: "existing-user-subscription-session", executableDigest: fixture.artifact.executable.sha256, packageDigest: observedPackageDigest, schemaDigest, resolvedMcpDeclarationDigest, pluginId, threadItemPluginId: nativeCall.pluginId, mcp: { server: nativeCall.server, tool: nativeCall.tool, inventory }, receiptDigest: acceptedReceipt, decisions: observed, canonicalRevision: acceptedRevision, canonicalDocument: acceptedDocument, sessions: { initial: acceptedSession, resumed: acceptedSession, forked: forkSession }, bounds: { scenarios: 5, providerInvocations: 6, workerToolCalls: 1, maxToolCallsPerInvocation: 1, maxTurns: 3, maxContextBytes: 4096, maxOutputBytes: 1024, maxEvidenceBytes: 1024, wallClockMs: MAX_WALL_MS }, lifecycle: { resume: "same-thread-app-server-resume-with-config-and-skill", fork: "new-thread-app-server-fork-with-immutable-binding-config-and-skill", uninstallDiscovery: "native-plugin-uninstall-marketplace-remove-fresh-thread-inventory-absent", horsenessGrant: "revoked", codexLogout: "not-performed" } })}\n`);
} catch (error) {
  process.stderr.write(`${redactedReason(error)}:${smokeStage}\n`);
  process.exitCode = 1;
} finally {
  if (server !== undefined) await new Promise<void>(resolveClose => server!.close(() => resolveClose()));
  if (appServer !== undefined) await appServer.close();
  await rm(root, { recursive: true, force: true });
}
