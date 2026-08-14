import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { verifyAttemptReceipt } from "@horseness/domain";
import { createClaudeAdapterV1, createClaudeNativeContributionRuntimeV1, createClaudeRetainedDeliveryAuthorityV1, validateClaudeSubscriptionLiveReceiptV1, CLAUDE_ADAPTER_ID, CLAUDE_INSTALL_CONTRIBUTIONS, CLAUDE_NATIVE_PACKAGE_METADATA, CLAUDE_PROVIDER_ID, claudeDoctorV1, type ClaudeNativeAttemptV1, type ClaudeNativeRuntimeV1, type ClaudeSubscriptionLiveReceiptV1 } from "../src/index.js";

const binding = { schemaVersion: "1", workspaceId: "ws", runId: "run", taskId: "task", attemptId: "attempt", generation: 1, forkPinDigest: "sha256:fork", contextManifestCoreDigest: "sha256:manifest", attemptContextBindingDigest: "sha256:binding", providerIdempotencyKeyDigest: "sha256:key", attemptCapability: "capability-ref" } as const;
const attempt: ClaudeNativeAttemptV1 = { providerOperationId: "claude-operation", nativeSessionId: "claude-session", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", outcome: "succeeded", outputDigest: "sha256:output", evidence: [{ digest: "sha256:evidence", mediaType: "application/json", size: 42 }], provenance: { package: "@anthropic-ai/claude-code-linux-x64", version: "2.1.228", loaderDigest: "sha256:d535985e6941a3eb00179ccd7f52ceb0c6623a0305a518ebc4e6514f84a94c99" } };
const calls: string[] = [];
const runtime: ClaudeNativeRuntimeV1 = { async launch() { calls.push("launch"); return attempt; }, async cancel() { calls.push("cancel"); return attempt; }, async reconcile() { calls.push("reconcile"); return attempt; }, async resume(request) { calls.push(request.operation); return attempt; }, async collect() { calls.push("collect"); return attempt; } };
const adapter = createClaudeAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "claude.grant.ref", scope: { workspaceId: "ws", adapterId: CLAUDE_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" });

test("Claude package exposes meaningful immutable native contributions", () => { assert.equal(CLAUDE_NATIVE_PACKAGE_METADATA.hostVersionRange, "=2.1.228"); assert.equal(CLAUDE_INSTALL_CONTRIBUTIONS.length, 8); assert.deepEqual(CLAUDE_INSTALL_CONTRIBUTIONS.map(item => item.mode), Array(8).fill("read-only")); });
test("Claude lifecycle retains binding, reconciles, resumes and seals a valid receipt", async () => { const capabilities = await adapter.detectCapabilities(); assert.equal(capabilities.providerId, CLAUDE_PROVIDER_ID); const launched = await adapter.launch({ ...binding, operation: "launch", renderedContextDigest: "sha256:rendered", providerOptions: {} }); assert.equal(launched.providerOperationId, "claude-operation"); await adapter.reconcile({ ...binding, operation: "reconcile", providerOperationId: "claude-operation" }); await adapter.resume({ ...binding, operation: "reattach", providerOperationId: "claude-operation", nativeSessionId: "claude-session" }); await adapter.resume({ ...binding, operation: "resume", providerOperationId: "claude-operation", nativeSessionId: "claude-session" }); const receipt = await adapter.collectReceipt(binding); verifyAttemptReceipt(receipt); assert.equal(receipt.providerId, CLAUDE_PROVIDER_ID); assert.deepEqual(calls, ["launch", "reconcile", "reattach", "resume", "collect"]); });
test("Claude rejects binding and credential scope substitution", () => { assert.throws(() => createClaudeAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "claude.grant.ref", scope: { workspaceId: "other", adapterId: CLAUDE_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" })); assert.throws(() => adapter.launch({ ...binding, generation: 2, operation: "launch", renderedContextDigest: "sha256:rendered", providerOptions: {} })); });
test("Claude doctor binds exact upstream loader and package resources", () => { assert.deepEqual(claudeDoctorV1({ nativePackageVersion: "2.1.228", loaderDigest: "sha256:d535985e6941a3eb00179ccd7f52ceb0c6623a0305a518ebc4e6514f84a94c99", contributionDigests: CLAUDE_NATIVE_PACKAGE_METADATA.contributions.map(item => item.digest) }).checks.map(check => check.status), ["ok", "ok", "ok"]); });

test("Claude retained authority reclaims only a mismatched process incarnation", async () => {
  if (process.platform !== "linux") return;
  const root = await mkdtemp(join(tmpdir(), "horseness-claude-lock-incarnation-"));
  try {
    const key = "pid-reuse";
    const lock = join(root, "locks", createHash("sha256").update(key).digest("hex"));
    await mkdir(lock, { recursive: true, mode: 0o700 });
    const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const incarnation = stat.slice(commandEnd + 2).trim().split(/\s+/)[19]!;
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, nonce: randomUUID(), incarnation: `${BigInt(incarnation) + 1n}` }), { mode: 0o600 });
    const reclaimed = createClaudeRetainedDeliveryAuthorityV1(root);
    let entered = false;
    await reclaimed.runExclusive(key, async () => { entered = true; });
    assert.equal(entered, true);

    const peer = createClaudeRetainedDeliveryAuthorityV1(root);
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

test("Claude session bindings persist across restart and reject unknown or substituted resume/fork sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-claude-session-bindings-"));
  const retainedRoot = join(root, "retained"); const sessionRoot = join(root, "sessions");
  const forkBinding = { ...binding, attemptId: "attempt-fork", forkPinDigest: "sha256:fork-2", attemptContextBindingDigest: "sha256:binding-2", providerIdempotencyKeyDigest: "sha256:key-2", attemptCapability: "capability-fork" } as const;
  const authority = { client: { async publishObject() {}, async submitReceipt() { return "unused"; }, async submitProposal() { return { proposalId: "unused", proposalDigest: "unused" }; }, async startDecisionSubscription() { return { resumeToken: "unused" }; }, async observeDecision() { return { resumeToken: "unused", decision: "accepted" as const }; } }, async sealProposal() { throw new Error("unused"); } };
  try {
    const makeRuntime = () => {
      const retained = createClaudeRetainedDeliveryAuthorityV1(retainedRoot);
      return createClaudeNativeContributionRuntimeV1([
        { capabilityReference: binding.attemptCapability, binding, adapter, authority, subscriptionId: "subscription" },
        { capabilityReference: forkBinding.attemptCapability, binding: forkBinding, adapter: createClaudeAdapterV1({ binding: forkBinding, credential: { schemaVersion: "1", kind: "host-reference", reference: "claude.grant.fork", scope: { workspaceId: forkBinding.workspaceId, adapterId: CLAUDE_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" }), authority, subscriptionId: "subscription-fork" },
      ], { retained, sessionStateDirectory: sessionRoot, initialAttemptCapabilityReference: binding.attemptCapability, attemptContexts: [{ attemptCapabilityReference: binding.attemptCapability, binding, renderedContext: "original", renderedContextDigest: "sha256:original" }, { attemptCapabilityReference: forkBinding.attemptCapability, binding: forkBinding, renderedContext: "fork", renderedContextDigest: "sha256:fork-context" }] });
    };
    const first = makeRuntime();
    await assert.rejects(() => first.deliverBatch([], undefined), /exactly five distinct scenario capabilities/);
    assert.equal((await first.registerSessionStart({ sessionId: "session-1", source: "startup" })).binding.attemptCapability, binding.attemptCapability);
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
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Claude MCP runtime rejects the first byte over its 8 KiB response bound", async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-claude-response-bound-"));
  const socketPath = join(root, "runtime.sock");
  const server = createServer(socket => {
    socket.on("data", () => socket.end("x".repeat(8_193)));
  });
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socketPath, resolve));
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../native/plugin/servers/horseness-worker.mjs", import.meta.url))], { env: { ...process.env, HORSENESS_CLAUDE_RUNTIME_SOCKET: socketPath, HORSENESS_CLAUDE_RUNTIME_NONCE: "n".repeat(32) }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => stdout += chunk);
    child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "horseness_worker_return", arguments: { scenarios: Array.from({ length: 5 }, (_, index) => ({ attemptCapabilityReference: `capability-${index}`, outputText: "o", evidenceClaim: "e" })) } } })}\n`);
    const status = await new Promise<number | null>(resolve => child.once("close", resolve));
    assert.equal(status, 0);
    const response = JSON.parse(stdout.trim()) as { result: { isError: boolean; content: readonly { text: string }[] } };
    assert.equal(response.result.isError, true);
    assert.equal(response.result.content[0]?.text, "HORSENESS_NATIVE_RUNTIME_RESPONSE_TOO_LARGE");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude live receipt validates complete candidate evidence and rejects auth/account fields", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const receiptBinding = { workspaceId: "w", runId: "r", taskId: "t", attemptId: "a", generation: 1, forkPinDigest: digest, contextManifestCoreDigest: digest, attemptContextBindingDigest: digest, receiptDigest: digest, proposalDigest: digest, outputDigest: digest, evidenceDigests: [digest] };
  const receipt: ClaudeSubscriptionLiveReceiptV1 = { schemaVersion: "ClaudeSubscriptionLiveReceiptV1", host: "claude", hostVersion: "2.1.228", observedModel: "claude-model", candidate: { head: "head", tree: "tree" }, command: { argv: ["pnpm", "host:smoke:claude"], digest, scenarioSetDigest: digest, batchResponseDigest: digest }, provenance: { archiveDigest: digest, archiveIdentity: "npm:claude", memberPath: "claude", executableDigest: digest, packageDigest: digest, contributions: [{ name: "plugin", digest }] }, bindings: Array.from({ length: 5 }, (_, index) => ({ ...receiptBinding, attemptId: `a-${index}` })), redactionAudit: { passed: true, prohibitedFields: ["account"] }, timing: { startedAt: "2026-08-14T00:00:00Z", finishedAt: "2026-08-14T00:00:01Z", durationMs: 1000 }, terminal: { result: "succeeded", reason: "CLAUDE_LIVE_SMOKE_SUCCEEDED" } };
  assert.deepEqual(validateClaudeSubscriptionLiveReceiptV1(receipt), receipt);
  const sharedAttemptBindings = receipt.bindings.map((item, index) => ({ ...item, workspaceId: `w-${index}`, attemptId: "shared-attempt" }));
  assert.deepEqual(validateClaudeSubscriptionLiveReceiptV1({ ...receipt, bindings: sharedAttemptBindings }).bindings, sharedAttemptBindings);
  assert.throws(() => validateClaudeSubscriptionLiveReceiptV1({ ...receipt, bindings: receipt.bindings.map(() => receipt.bindings[0]!) }), /INVALID/);
  assert.throws(() => validateClaudeSubscriptionLiveReceiptV1({ ...receipt, terminal: { ...receipt.terminal, account: "forbidden" } } as unknown as ClaudeSubscriptionLiveReceiptV1), /REDACTION/);
});
