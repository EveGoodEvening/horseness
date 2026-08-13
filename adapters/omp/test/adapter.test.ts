import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { verifyAttemptReceipt } from "@horseness/domain";
import { createOMPAdapterV1, createOMPRetainedDeliveryAuthorityV1, OMP_ADAPTER_ID, OMP_INSTALL_CONTRIBUTIONS, OMP_NATIVE_PACKAGE_METADATA, OMP_PROVIDER_ID, ompDoctorV1, type OMPNativeAttemptV1, type OMPNativeRuntimeV1 } from "../src/index.js";

const binding = { schemaVersion: "1", workspaceId: "ws", runId: "run", taskId: "task", attemptId: "attempt", generation: 1, forkPinDigest: "sha256:fork", contextManifestCoreDigest: "sha256:manifest", attemptContextBindingDigest: "sha256:binding", providerIdempotencyKeyDigest: "sha256:key", attemptCapability: "capability-ref" } as const;
const attempt: OMPNativeAttemptV1 = { providerOperationId: "omp-operation", nativeSessionId: "omp-session", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", outcome: "succeeded", outputDigest: "sha256:output", evidence: [{ digest: "sha256:evidence", mediaType: "application/json", size: 42 }], provenance: { package: "@oh-my-pi/pi-coding-agent", version: "17.2.15", loaderDigest: "sha256:c0076ad052d435ee1075abfa0682e83ad4a075a1415c720bbbdf71d9affcc48f" } };
const calls: string[] = [];
const runtime: OMPNativeRuntimeV1 = { async launch() { calls.push("launch"); return attempt; }, async cancel() { calls.push("cancel"); return attempt; }, async reconcile() { calls.push("reconcile"); return attempt; }, async resume(request) { calls.push(request.operation); return attempt; }, async collect() { calls.push("collect"); return attempt; } };
const adapter = createOMPAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "omp.provider.ref", scope: { workspaceId: "ws", adapterId: OMP_ADAPTER_ID, purpose: "omp-provider-auth" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" });

test("OMP package exposes meaningful immutable native contributions", () => { assert.equal(OMP_NATIVE_PACKAGE_METADATA.hostVersionRange, "=17.2.15"); assert.equal(OMP_INSTALL_CONTRIBUTIONS.length, 2); assert.deepEqual(OMP_INSTALL_CONTRIBUTIONS.map(item => item.mode), ["read-only", "read-only"]); });
test("OMP lifecycle retains binding, reconciles, resumes and seals a valid receipt", async () => { const capabilities = await adapter.detectCapabilities(); assert.equal(capabilities.providerId, OMP_PROVIDER_ID); const launched = await adapter.launch({ ...binding, operation: "launch", renderedContextDigest: "sha256:rendered", providerOptions: {} }); assert.equal(launched.providerOperationId, "omp-operation"); await adapter.reconcile({ ...binding, operation: "reconcile", providerOperationId: "omp-operation" }); await adapter.resume({ ...binding, operation: "reattach", providerOperationId: "omp-operation", nativeSessionId: "omp-session" }); await adapter.resume({ ...binding, operation: "resume", providerOperationId: "omp-operation", nativeSessionId: "omp-session" }); const receipt = await adapter.collectReceipt(binding); verifyAttemptReceipt(receipt); assert.equal(receipt.providerId, OMP_PROVIDER_ID); assert.deepEqual(calls, ["launch", "reconcile", "reattach", "resume", "collect"]); });
test("OMP rejects binding and credential scope substitution", () => { assert.throws(() => createOMPAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "omp.provider.ref", scope: { workspaceId: "other", adapterId: OMP_ADAPTER_ID, purpose: "omp-provider-auth" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" })); assert.throws(() => adapter.launch({ ...binding, generation: 2, operation: "launch", renderedContextDigest: "sha256:rendered", providerOptions: {} })); });
test("OMP doctor binds exact upstream loader and package resources", () => { assert.deepEqual(ompDoctorV1({ nativePackageVersion: "17.2.15", loaderDigest: "sha256:c0076ad052d435ee1075abfa0682e83ad4a075a1415c720bbbdf71d9affcc48f", contributionDigests: OMP_NATIVE_PACKAGE_METADATA.contributions.map(item => item.digest) }).checks.map(check => check.status), ["ok", "ok", "ok"]); });

test("OMP retained authority reclaims only a mismatched process incarnation", async () => {
  if (process.platform !== "linux") return;
  const root = await mkdtemp(join(tmpdir(), "horseness-omp-lock-incarnation-"));
  try {
    const key = "pid-reuse";
    const lock = join(root, "locks", createHash("sha256").update(key).digest("hex"));
    await mkdir(lock, { recursive: true, mode: 0o700 });
    const stat = await readFile(`/proc/${process.pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    const incarnation = stat.slice(commandEnd + 2).trim().split(/\s+/)[19]!;
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, nonce: randomUUID(), incarnation: `${BigInt(incarnation) + 1n}` }), { mode: 0o600 });
    const reclaimed = createOMPRetainedDeliveryAuthorityV1(root);
    let entered = false;
    await reclaimed.runExclusive(key, async () => { entered = true; });
    assert.equal(entered, true);

    const peer = createOMPRetainedDeliveryAuthorityV1(root);
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
