import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyAttemptReceipt } from "@horseness/domain";
import { createCodexAdapterV1, createCodexNativeContributionRuntimeV1, createCodexRetainedDeliveryAuthorityV1, validateCodexSubscriptionLiveReceiptV1, CODEX_ADAPTER_ID, CODEX_INSTALL_CONTRIBUTIONS, CODEX_NATIVE_PACKAGE_METADATA, CODEX_PROVIDER_ID, codexDoctorV1, type CodexNativeAttemptV1, type CodexNativeRuntimeV1, type CodexSubscriptionLiveReceiptV1 } from "../src/index.js";

const binding = { schemaVersion: "1", workspaceId: "ws", runId: "run", taskId: "task", attemptId: "attempt", generation: 1, forkPinDigest: "sha256:fork", contextManifestCoreDigest: "sha256:manifest", attemptContextBindingDigest: "sha256:binding", providerIdempotencyKeyDigest: "sha256:key", attemptCapability: "capability-ref" } as const;
const attempt: CodexNativeAttemptV1 = { providerOperationId: "codex-operation", nativeSessionId: "codex-session", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", outcome: "succeeded", outputDigest: "sha256:output", evidence: [{ digest: "sha256:evidence", mediaType: "application/json", size: 42 }], provenance: { package: "@openai/codex", version: "0.144.1-linux-x64", loaderDigest: "sha256:a96f944d1a596dbfb7fdd84f482be5c50e34b04bb371126840d873e4ebf26902" } };
const calls: string[] = [];
const runtime: CodexNativeRuntimeV1 = { async launch() { calls.push("launch"); return attempt; }, async cancel() { calls.push("cancel"); return attempt; }, async reconcile() { calls.push("reconcile"); return attempt; }, async resume(request) { calls.push(request.operation); return attempt; }, async collect() { calls.push("collect"); return attempt; } };
const adapter = createCodexAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "codex.grant.ref", scope: { workspaceId: "ws", adapterId: CODEX_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" });

test("Codex package exposes meaningful immutable native contributions", () => { assert.equal(CODEX_NATIVE_PACKAGE_METADATA.hostVersionRange, "=0.144.1-linux-x64"); assert.equal(CODEX_INSTALL_CONTRIBUTIONS.length, 5); assert.deepEqual(CODEX_INSTALL_CONTRIBUTIONS.map(item => item.mode), Array(5).fill("read-only")); });
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
    await writeFile(join(copiedRoot, "plugin/AGENTS.md"), "tampered\n");
    assert.deepEqual(codexDoctorV1({ nativePackageVersion: "0.144.1-linux-x64", loaderDigest: "sha256:a96f944d1a596dbfb7fdd84f482be5c50e34b04bb371126840d873e4ebf26902", contributions: await hashContributions() }).checks.map(check => check.status), ["ok", "ok", "error"]);
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
    const makeRuntime = () => {
      const retained = createCodexRetainedDeliveryAuthorityV1(retainedRoot);
      return createCodexNativeContributionRuntimeV1([
        { capabilityReference: binding.attemptCapability, binding, adapter, authority, subscriptionId: "subscription" },
        { capabilityReference: forkBinding.attemptCapability, binding: forkBinding, adapter: createCodexAdapterV1({ binding: forkBinding, credential: { schemaVersion: "1", kind: "host-reference", reference: "codex.grant.fork", scope: { workspaceId: forkBinding.workspaceId, adapterId: CODEX_ADAPTER_ID, purpose: "horseness-attempt-grant" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" }), authority, subscriptionId: "subscription-fork" },
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


test("Codex live receipt validates the required subscription auth mode and rejects auth/account fields", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const receiptBinding = { workspaceId: "w", runId: "r", taskId: "t", attemptId: "a", generation: 1, forkPinDigest: digest, contextManifestCoreDigest: digest, attemptContextBindingDigest: digest, receiptDigest: digest, proposalDigest: digest, outputDigest: digest, evidenceDigests: [digest] };
  const receipt: CodexSubscriptionLiveReceiptV1 = { schemaVersion: "CodexSubscriptionLiveReceiptV1", host: "codex", authMode: "existing-user-subscription-session", hostVersion: "0.144.1-linux-x64", observedModel: "codex-model", candidate: { head: "head", tree: "tree" }, command: { argv: ["pnpm", "host:smoke:codex"], digest, scenarioSetDigest: digest, batchResponseDigest: digest }, provenance: { archiveDigest: digest, archiveIdentity: "npm:codex", memberPath: "codex", executableDigest: digest, packageDigest: CODEX_NATIVE_PACKAGE_METADATA.packageDigest, contributions: CODEX_NATIVE_PACKAGE_METADATA.contributions.map(({ name, digest: contributionDigest }) => ({ name, digest: contributionDigest })) }, bindings: Array.from({ length: 5 }, (_, index) => ({ ...receiptBinding, attemptId: `a-${index}` })), redactionAudit: { passed: true, prohibitedFields: [] }, timing: { startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", durationMs: 1000 }, terminal: { result: "succeeded", reason: "CODEX_LIVE_SMOKE_SUCCEEDED" } };
  assert.deepEqual(validateCodexSubscriptionLiveReceiptV1(receipt), receipt);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, authMode: undefined } as unknown as CodexSubscriptionLiveReceiptV1), /INVALID/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, authMode: "api-key" } as unknown as CodexSubscriptionLiveReceiptV1), /INVALID/);
  const sharedAttemptBindings = receipt.bindings.map((item, index) => ({ ...item, workspaceId: `w-${index}`, attemptId: "shared-attempt" }));
  assert.deepEqual(validateCodexSubscriptionLiveReceiptV1({ ...receipt, bindings: sharedAttemptBindings }).bindings, sharedAttemptBindings);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, bindings: receipt.bindings.map(() => receipt.bindings[0]!) }), /INVALID/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, provenance: { ...receipt.provenance, contributions: receipt.provenance.contributions.map((item, index) => index === 0 ? { ...item, digest } : item) } }), /PROVENANCE_MISMATCH/);
  assert.throws(() => validateCodexSubscriptionLiveReceiptV1({ ...receipt, terminal: { ...receipt.terminal, account: "forbidden" } } as unknown as CodexSubscriptionLiveReceiptV1), /REDACTION/);
});
