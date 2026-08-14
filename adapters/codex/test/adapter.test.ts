import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyAttemptReceipt } from "@horseness/domain";
import { createCodexAdapterV1, createCodexNativeContributionRuntimeV1, createCodexRetainedDeliveryAuthorityV1, validateCodexSubscriptionLiveReceiptV1, CODEX_ADAPTER_ID, CODEX_INSTALL_CONTRIBUTIONS, CODEX_NATIVE_PACKAGE_METADATA, CODEX_PROVIDER_ID, codexDoctorV1, codexNativePackageDigestV1, type CodexNativeAttemptV1, type CodexNativeRuntimeV1, type CodexSubscriptionLiveReceiptV1 } from "../src/index.js";
import { CODEX_PINNED_TOOL_CONFIG, assertSafeCodexEnvironment, classifyCodexThreadItemV2, codexNativeEnvironment, codexRestrictedThreadFork, codexRestrictedThreadResume, codexRestrictedThreadStart, codexRestrictedTurn, codexThreadItemLifecycleIdV2, describeCodexThreadItemV2, recordCodexCompletedItemV2 } from "./app-server-client.js";

const binding = { schemaVersion: "1", workspaceId: "ws", runId: "run", taskId: "task", attemptId: "attempt", generation: 1, forkPinDigest: "sha256:fork", contextManifestCoreDigest: "sha256:manifest", attemptContextBindingDigest: "sha256:binding", providerIdempotencyKeyDigest: "sha256:key", attemptCapability: "capability-ref" } as const;
const attempt: CodexNativeAttemptV1 = { providerOperationId: "codex-operation", nativeSessionId: "codex-session", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", outcome: "succeeded", outputDigest: "sha256:output", evidence: [{ digest: "sha256:evidence", mediaType: "application/json", size: 42 }], provenance: { package: "@openai/codex", version: "0.144.1-linux-x64", loaderDigest: "sha256:a96f944d1a596dbfb7fdd84f482be5c50e34b04bb371126840d873e4ebf26902" } };
const calls: string[] = [];
const runtime: CodexNativeRuntimeV1 = { async launch() { calls.push("launch"); return attempt; }, async cancel() { calls.push("cancel"); return attempt; }, async reconcile() { calls.push("reconcile"); return attempt; }, async resume(request) { calls.push(request.operation); return attempt; }, async collect() { calls.push("collect"); return attempt; } };
const adapter = createCodexAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "codex.grant.ref", scope: { workspaceId: "ws", adapterId: CODEX_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" });

test("Codex package exposes meaningful immutable native contributions", () => { assert.equal(CODEX_NATIVE_PACKAGE_METADATA.hostVersionRange, "=0.144.1-linux-x64"); assert.equal(CODEX_INSTALL_CONTRIBUTIONS.length, 5); assert.deepEqual(CODEX_INSTALL_CONTRIBUTIONS.map(item => item.mode), Array(5).fill("read-only")); });

test("Codex app-server item parser separates passive bookkeeping from every pinned executing tool surface", () => {
  for (const type of ["userMessage", "hookPrompt", "agentMessage", "plan", "reasoning", "subAgentActivity", "enteredReviewMode", "exitedReviewMode", "contextCompaction"]) {
    assert.equal(classifyCodexThreadItemV2({ type }), "passive", type);
  }
  for (const type of ["commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall", "webSearch", "imageView", "sleep", "imageGeneration"]) {
    assert.equal(classifyCodexThreadItemV2({ type }), "executing", type);
  }
  assert.throws(() => classifyCodexThreadItemV2({ type: "toolSearch" }), /CODEX_THREAD_ITEM_TYPE_UNKNOWN/);
  assert.throws(() => classifyCodexThreadItemV2({ type: "futureProviderAction" }), /CODEX_THREAD_ITEM_TYPE_UNKNOWN/);
  assert.equal(describeCodexThreadItemV2({ type: "mcpToolCall", server: "horseness-worker", tool: "horseness_worker_return", pluginId: "horseness-codex@horseness-c18" }), "mcpToolCall:horseness-worker/horseness_worker_return@horseness-codex@horseness-c18");
  assert.equal(describeCodexThreadItemV2({ type: "dynamicToolCall", namespace: "unsafe namespace", tool: "secret\nname" }), "dynamicToolCall");
  assert.equal(describeCodexThreadItemV2({ type: "webSearch", query: "must-not-appear" }), "webSearch");
  assert.throws(() => classifyCodexThreadItemV2(null), /CODEX_THREAD_ITEM_RESPONSE_INVALID/);
  assert.equal(codexThreadItemLifecycleIdV2({ id: "item-123", type: "mcpToolCall" }), "item-123");
  assert.throws(() => codexThreadItemLifecycleIdV2({ type: "mcpToolCall" }), /CODEX_THREAD_ITEM_ID_INVALID/);
  const completedItems = new Map<string, string>();
  const completedMcpItem = { id: "item-mcp-1", type: "mcpToolCall", server: "horseness-worker", tool: "horseness_worker_return" };
  assert.equal(recordCodexCompletedItemV2(completedItems, completedMcpItem), true);
  assert.equal(recordCodexCompletedItemV2(completedItems, { ...completedMcpItem, unsafePayload: "ignored" }), false);
  assert.equal(recordCodexCompletedItemV2(completedItems, { ...completedMcpItem, id: "item-mcp-2" }), true);
  assert.throws(() => recordCodexCompletedItemV2(completedItems, { ...completedMcpItem, tool: "other_tool" }), /CODEX_THREAD_ITEM_LIFECYCLE_CONFLICT/);
});
test("Codex pinned app-server requests disable built-in tools while retaining plugin injection", () => {
  const instructions = "verified AGENTS bytes";
  const expectedConfig = {
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
  };
  assert.deepEqual(CODEX_PINNED_TOOL_CONFIG, expectedConfig);
  assert.deepEqual(codexRestrictedThreadStart("/work", instructions), { cwd: "/work", developerInstructions: instructions, approvalPolicy: "never", permissions: ":read-only", environments: [], dynamicTools: [], config: expectedConfig });
  assert.deepEqual(codexRestrictedThreadResume("thread", "/work", instructions), { threadId: "thread", cwd: "/work", developerInstructions: instructions, approvalPolicy: "never", permissions: ":read-only", config: expectedConfig });
  assert.deepEqual(codexRestrictedThreadFork("thread", "/work", instructions), { threadId: "thread", cwd: "/work", developerInstructions: instructions, ephemeral: true, approvalPolicy: "never", permissions: ":read-only", config: expectedConfig });
  assert.deepEqual(codexRestrictedTurn("verified application context"), { approvalPolicy: "never", permissions: ":read-only", environments: [], additionalContext: { "horseness-bound-attempt": { kind: "application", value: "verified application context" } } });
  for (const request of [codexRestrictedThreadStart("/work", instructions), codexRestrictedThreadResume("thread", "/work", instructions), codexRestrictedThreadFork("thread", "/work", instructions), codexRestrictedTurn("context")]) {
    assert.equal("profile" in request, false);
    assert.equal("default_tools_enabled" in request, false);
    assert.equal("tools.web_search" in request, false);
    assert.equal("sandbox" in request || "sandboxPolicy" in request, false);
  }
});
test("Codex lifecycle retains binding, reconciles, resumes and seals a valid receipt", async () => { const capabilities = await adapter.detectCapabilities(); assert.equal(capabilities.providerId, CODEX_PROVIDER_ID); const launched = await adapter.launch({ ...binding, operation: "launch", renderedContextDigest: "sha256:rendered", providerOptions: {} }); assert.equal(launched.providerOperationId, "codex-operation"); await adapter.reconcile({ ...binding, operation: "reconcile", providerOperationId: "codex-operation" }); await adapter.resume({ ...binding, operation: "reattach", providerOperationId: "codex-operation", nativeSessionId: "codex-session" }); await adapter.resume({ ...binding, operation: "resume", providerOperationId: "codex-operation", nativeSessionId: "codex-session" }); const receipt = await adapter.collectReceipt(binding); verifyAttemptReceipt(receipt); assert.equal(receipt.providerId, CODEX_PROVIDER_ID); assert.deepEqual(calls, ["launch", "reconcile", "reattach", "resume", "collect"]); });
test("Codex rejects binding and credential scope substitution", () => { assert.throws(() => createCodexAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "codex.grant.ref", scope: { workspaceId: "other", adapterId: CODEX_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" })); assert.throws(() => adapter.launch({ ...binding, generation: 2, operation: "launch", renderedContextDigest: "sha256:rendered", providerOptions: {} })); });
test("Codex doctor independently hashes exact shipped package resources and rejects copied-byte tampering", async () => {
  const nativeRoot = fileURLToPath(new URL("../native/", import.meta.url));
  const copiedRoot = await mkdtemp(join(tmpdir(), "horseness-codex-native-provenance-"));
  const hashContributions = () => Promise.all(CODEX_NATIVE_PACKAGE_METADATA.contributions.map(async item => ({ name: item.name, digest: `sha256:${createHash("sha256").update(await readFile(join(copiedRoot, item.name))).digest("hex")}` })));
  try {
    await cp(nativeRoot, copiedRoot, { recursive: true });
    const contributions = await hashContributions();
    assert.deepEqual(codexDoctorV1({ nativePackageVersion: "0.144.1-linux-x64", loaderDigest: "sha256:a96f944d1a596dbfb7fdd84f482be5c50e34b04bb371126840d873e4ebf26902", contributions }).checks.map(check => check.status), ["ok", "ok", "ok"]);
    for (const contribution of CODEX_NATIVE_PACKAGE_METADATA.contributions) {
      await rm(copiedRoot, { recursive: true, force: true }); await cp(nativeRoot, copiedRoot, { recursive: true });
      await writeFile(join(copiedRoot, contribution.name), "tampered\n");
      assert.equal(codexDoctorV1({ nativePackageVersion: "0.144.1-linux-x64", loaderDigest: "sha256:a96f944d1a596dbfb7fdd84f482be5c50e34b04bb371126840d873e4ebf26902", contributions: await hashContributions() }).checks.at(-1)?.status, "error");
      await rm(join(copiedRoot, contribution.name));
      await assert.rejects(hashContributions, /ENOENT/);
    }
  } finally {
    await rm(copiedRoot, { recursive: true, force: true });
  }
});

test("Codex retained authority reclaims only a mismatched process incarnation", async () => {
  if (process.platform !== "linux") return;
  const root = await mkdtemp(join(tmpdir(), "horseness-codex-lock-incarnation-"));
  try {
    const key = "pid-reuse";
    const lock = join(root, "locks", createHash("sha256").update(key).digest("hex"));
    await mkdir(lock, { recursive: true, mode: 0o700 });
    const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const incarnation = stat.slice(commandEnd + 2).trim().split(/\s+/)[19]!;
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, nonce: randomUUID(), incarnation: `${BigInt(incarnation) + 1n}` }), { mode: 0o600 });
    const reclaimed = createCodexRetainedDeliveryAuthorityV1(root);
    let entered = false;
    await reclaimed.runExclusive(key, async () => { entered = true; });
    assert.equal(entered, true);

    const peer = createCodexRetainedDeliveryAuthorityV1(root);
    let release: (() => void) | undefined;
    const held = reclaimed.runExclusive("current-owner", async () => { await new Promise<void>(resolve => { release = resolve; }); });
    while (release === undefined) await setImmediate();
    let peerEntered = false;
    const waiting = peer.runExclusive("current-owner", async () => { peerEntered = true; });
    for (let turn = 0; turn < 5; turn++) await setImmediate();
    assert.equal(peerEntered, false);
    release();
    await Promise.all([held, waiting]);
    assert.equal(peerEntered, true);
    reclaimed.close(); peer.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Codex session bindings persist across restart and reject unknown or substituted resume/fork sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-codex-session-bindings-"));
  const retainedRoot = join(root, "retained"); const sessionRoot = join(root, "sessions");
  const forkBinding = { ...binding, attemptId: "attempt-fork", forkPinDigest: "sha256:fork-2", attemptContextBindingDigest: "sha256:binding-2", providerIdempotencyKeyDigest: "sha256:key-2", attemptCapability: "capability-fork" } as const;
  const authority = { client: { async publishObject() {}, async submitReceipt() { return "unused"; }, async submitProposal() { return { proposalId: "unused", proposalDigest: "unused" }; }, async startDecisionSubscription() { return { resumeToken: "unused" }; }, async observeDecision() { return { resumeToken: "unused", decision: "accepted" as const }; } }, async sealProposal() { throw new Error("unused"); } };
  try {
    const makeRuntime = (killSwitchPath?: string) => {
      const retained = createCodexRetainedDeliveryAuthorityV1(retainedRoot);
      return createCodexNativeContributionRuntimeV1([
        { capabilityReference: binding.attemptCapability, binding, adapter, authority, subscriptionId: "subscription" },
        { capabilityReference: forkBinding.attemptCapability, binding: forkBinding, adapter: createCodexAdapterV1({ binding: forkBinding, credential: { schemaVersion: "1", kind: "host-reference", reference: "codex.grant.fork", scope: { workspaceId: forkBinding.workspaceId, adapterId: CODEX_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" }), authority, subscriptionId: "subscription-fork" },
      ], { retained, sessionStateDirectory: sessionRoot, ...(killSwitchPath === undefined ? {} : { killSwitchPath }), initialAttemptCapabilityReference: binding.attemptCapability, attemptContexts: [{ attemptCapabilityReference: binding.attemptCapability, binding, renderedContext: "original", renderedContextDigest: "sha256:original" }, { attemptCapabilityReference: forkBinding.attemptCapability, binding: forkBinding, renderedContext: "fork", renderedContextDigest: "sha256:fork-context" }] });
    };
    const first = makeRuntime();
    await assert.rejects(() => first.deliverBatch([], "missing-claim", "missing-session"), /exactly five distinct scenario capabilities/);
    const claim = "c".repeat(64);
    first.registerThreadClaim({ claim, attemptCapabilityReferences: [binding.attemptCapability], primaryAttemptCapabilityReference: binding.attemptCapability });
    assert.equal((await first.bindThreadClaim(claim, "session-1", { source: "startup" })).binding.attemptCapability, binding.attemptCapability);
    assert.equal(first.sessionForThreadClaim(claim), "session-1");
    assert.throws(() => first.registerThreadClaim({ claim, attemptCapabilityReferences: [binding.attemptCapability], primaryAttemptCapabilityReference: binding.attemptCapability }), /reused/);
    await assert.rejects(() => first.bindThreadClaim(claim, "substituted-session", { source: "startup" }), /reused|already bound/);
    await assert.rejects(() => first.registerSessionStart({ sessionId: "unknown-resume", source: "resume", previousSessionId: "missing" }), /unknown or unbound/);
    first.registerBranch({ entryId: "fork-entry", previousSessionFile: "session-1", attemptCapabilityReference: forkBinding.attemptCapability });
    await assert.rejects(() => first.registerSessionStart({ sessionId: "unregistered-fork", source: "fork", previousSessionId: "session-1" }), /pre-registered branch entry id/);
    await assert.rejects(() => first.registerSessionStart({ sessionId: "resume-with-branch", source: "resume", previousSessionId: "session-1", branchEntryId: "fork-entry" }), /only valid for a fork session/);
    await assert.rejects(() => first.registerSessionStart({ sessionId: "wrong-parent-fork", source: "fork", previousSessionId: "resume-with-branch", branchEntryId: "fork-entry" }), /does not match the immutable mapping/);
    assert.equal((await first.registerSessionStart({ sessionId: "session-2", source: "fork", previousSessionId: "session-1", branchEntryId: "fork-entry" })).binding.attemptCapability, forkBinding.attemptCapability);
    await first.shutdown();
    const restarted = makeRuntime();
    assert.equal((await restarted.registerSessionStart({ sessionId: "session-1", source: "resume", previousSessionId: "session-1" })).binding.attemptCapability, binding.attemptCapability);
    assert.equal((await restarted.registerSessionStart({ sessionId: "session-2", source: "resume", previousSessionId: "session-2" })).binding.attemptCapability, forkBinding.attemptCapability);
    await assert.rejects(() => restarted.registerSessionStart({ sessionId: "session-2", source: "resume", previousSessionId: "session-1" }), /substitution/);
    await restarted.shutdown();
    const killSwitchPath = join(root, "uninstall.json");
    await writeFile(killSwitchPath, JSON.stringify({ schemaVersion: "CodexUninstallStateV1", state: "kill_switch_written", killSwitch: true, pluginId: "horseness-codex@horseness-c18", marketplaceName: "horseness-c18", installedPluginRoot: join(root, "installed"), unexpected: true }), { mode: 0o600 });
    const malformedJournalRuntime = makeRuntime(killSwitchPath);
    assert.throws(() => malformedJournalRuntime.sessionForThreadClaim(claim), /JOURNAL_INVALID/);
    await malformedJournalRuntime.shutdown();
    await writeFile(killSwitchPath, JSON.stringify({ schemaVersion: "CodexUninstallStateV1", state: "kill_switch_written", killSwitch: true, pluginId: "horseness-codex@horseness-c18", marketplaceName: "horseness-c18", installedPluginRoot: join(root, "installed") }));
    await chmod(killSwitchPath, 0o644);
    const publicJournalRuntime = makeRuntime(killSwitchPath);
    assert.throws(() => publicJournalRuntime.sessionForThreadClaim(claim), /FILE_INVALID/);
    await publicJournalRuntime.shutdown();
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("Codex live receipt validates the required subscription auth mode and rejects auth/account fields", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const receiptBinding = { workspaceId: "w", runId: "r", taskId: "t", attemptId: "a", generation: 1, forkPinDigest: digest, contextManifestCoreDigest: digest, attemptContextBindingDigest: digest, receiptDigest: digest, proposalDigest: digest, outputDigest: digest, evidenceDigests: [digest] };
  const installedVersion = `0.1.0+horseness.${CODEX_NATIVE_PACKAGE_METADATA.packageDigest.slice("sha256:".length, "sha256:".length + 16)}`;
  const installedContributions = CODEX_NATIVE_PACKAGE_METADATA.contributions.map(item => ({ ...item, digest: item.name.endsWith("plugin.json") ? digest : item.digest }));
  const installedPackageDigest = codexNativePackageDigestV1(installedContributions);
  const receipt: CodexSubscriptionLiveReceiptV1 = { schemaVersion: "CodexSubscriptionLiveReceiptV1", host: "codex", authMode: "existing-user-subscription-session", hostVersion: "0.144.1-linux-x64", observedModel: "codex-model", candidate: { head: "head", tree: "tree" }, command: { argv: ["pnpm", "host:smoke:codex"], digest, scenarioSetDigest: digest, batchResponseDigest: digest }, provenance: { archiveDigest: digest, archiveIdentity: "npm:codex", memberPath: "codex", executableDigest: digest, packageDigest: CODEX_NATIVE_PACKAGE_METADATA.packageDigest, contributions: CODEX_NATIVE_PACKAGE_METADATA.contributions.map(({ name, digest: contributionDigest }) => ({ name, digest: contributionDigest })), nativePlugin: { observedPluginId: "horseness-codex@horseness-c18", nativeItemPluginId: "horseness-codex@horseness-c18", installedVersion, installedPackageDigest, installedContributions, resolvedDeclarationDigest: digest } }, bindings: Array.from({ length: 5 }, (_, index) => ({ ...receiptBinding, attemptId: `a-${index}` })), redactionAudit: { passed: true, prohibitedFields: [] }, timing: { startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", durationMs: 1000 }, terminal: { result: "succeeded", reason: "CODEX_LIVE_SMOKE_SUCCEEDED" } };
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, authMode: undefined } as unknown as CodexSubscriptionLiveReceiptV1), /INVALID/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, authMode: "api-key" } as unknown as CodexSubscriptionLiveReceiptV1), /INVALID/);
  const sharedAttemptBindings = receipt.bindings.map((item, index) => ({ ...item, workspaceId: `w-${index}`, attemptId: "shared-attempt" }));
  assert.deepEqual(validateCodexSubscriptionLiveReceiptV1({ ...receipt, bindings: sharedAttemptBindings }).bindings, sharedAttemptBindings);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, bindings: receipt.bindings.map(() => receipt.bindings[0]!) }), /INVALID/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, provenance: { ...receipt.provenance, contributions: receipt.provenance.contributions.map((item, index) => index === 0 ? { ...item, digest } : item) } }), /PROVENANCE_MISMATCH/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, provenance: { ...receipt.provenance, nativePlugin: { ...receipt.provenance.nativePlugin, installedVersion: "0.1.0" } } }), /INVALID/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, provenance: { ...receipt.provenance, nativePlugin: { ...receipt.provenance.nativePlugin, installedVersion: "0.1.0+horseness.0000000000000000" } } }), /PROVENANCE_MISMATCH/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, terminal: { ...receipt.terminal, account: "forbidden" } } as unknown as CodexSubscriptionLiveReceiptV1), /REDACTION/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, timing: { ...receipt.timing, durationMs: 120_001 } }), /INVALID/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, provenance: { ...receipt.provenance, nativePlugin: { ...receipt.provenance.nativePlugin, installedPackageDigest: digest } } }), /PROVENANCE_MISMATCH/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, timing: { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:02.000Z", durationMs: 1_000 } }), /INVALID/);
});

test("Codex app-server environment allowlists native session state and strips seeded credentials", () => {
  const environment = codexNativeEnvironment("/verified/codex", "/bounded/tmp", {
    HOME: "/native/home",
    CODEX_HOME: "/native/home/.codex",
    LANG: "C.UTF-8",
    OPENAI_API_KEY: "seeded",
    ANTHROPIC_API_KEY: "seeded",
    AWS_SECRET_ACCESS_KEY: "seeded",
    CI_JOB_TOKEN: "seeded",
    HTTPS_PROXY: "http://seeded",
  }, { socket: "/bounded/runtime.sock", nonce: "n".repeat(64), threadClaim: "c".repeat(64) });
  assert.deepEqual(environment, {
    PATH: `${dirname("/verified/codex")}:${dirname(process.execPath)}`,
    TMPDIR: "/bounded/tmp", TMP: "/bounded/tmp", TEMP: "/bounded/tmp",
    HOME: "/native/home", CODEX_HOME: "/native/home/.codex", LANG: "C.UTF-8",
    HORSENESS_CODEX_RUNTIME_SOCKET: "/bounded/runtime.sock", HORSENESS_CODEX_RUNTIME_NONCE: "n".repeat(64), HORSENESS_CODEX_THREAD_CLAIM: "c".repeat(64),
  });
  assert.throws(() => assertSafeCodexEnvironment({ ...environment, OPENAI_API_KEY: "forbidden" }), /FORBIDDEN/);
});
