import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { verifyAttemptReceipt } from "@horseness/domain";
import { createClaudeAdapterV1, createClaudeRetainedDeliveryAuthorityV1, CLAUDE_ADAPTER_ID, CLAUDE_INSTALL_CONTRIBUTIONS, CLAUDE_NATIVE_PACKAGE_METADATA, CLAUDE_PROVIDER_ID, claudeDoctorV1, type ClaudeNativeAttemptV1, type ClaudeNativeRuntimeV1 } from "../src/index.js";

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
