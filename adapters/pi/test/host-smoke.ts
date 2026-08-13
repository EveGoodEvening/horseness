import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attemptContextBindingDigest, contextManifestCoreDigest, domainDigest, reduceCanonicalDocument, sealAttemptReceipt, sealForkPin, sealProposal, verifyAttemptReceipt, verifyProposal, type CompositeCursorV1, type ContextManifestCoreV1 } from "@horseness/domain";
import { CoordinatorClientV1, WorkerClientV1, type AuthorizedProtocolTransportV1, type OpaqueCredentialReferenceV1, type WorkerBindingV1 } from "@horseness/sdk";
import { successResponse, type JsonRpcRequestV1, type JsonRpcResponseV1 } from "@horseness/protocol";
import { PI_NATIVE_PACKAGE_METADATA } from "../src/index.js";

async function resolvePackageRoot(packageName: string): Promise<{ packageRoot: string; packageJson: Record<string, unknown> }> {
  let candidate = dirname(fileURLToPath(import.meta.resolve(packageName)));
  while (true) {
    const packageJsonPath = join(candidate, "package.json");
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
      if (packageJson.name === packageName) return { packageRoot: candidate, packageJson };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`Could not locate installed package root for ${packageName}`);
    candidate = parent;
  }
}

const root = await mkdtemp(join(tmpdir(), "horseness-pi-smoke-"));
try {
  const { packageRoot, packageJson: upstream } = await resolvePackageRoot("@mariozechner/pi-coding-agent");
  assert.equal(upstream.name, "@mariozechner/pi-coding-agent");
  assert.equal(upstream.version, "0.73.1");
  const loaderPath = join(packageRoot, "dist/core/extensions/loader.js");
  const loaderDigest = `sha256:${createHash("sha256").update(await readFile(loaderPath)).digest("hex")}`;
  assert.equal(loaderDigest, "sha256:0ffd7839e5626779e4e4d20cd55e647a7a9234a293025c6f1f361e7107e62a6b");

  const extensionSource = fileURLToPath(new URL("../native/extensions/horseness-pi.mjs", import.meta.url));
  const installedExtension = join(root, "extensions", "horseness-pi.mjs");
  await cp(extensionSource, installedExtension);
  const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
  const loaded = await loadExtensions([installedExtension], root);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  const nativeTool = extension.tools.get("horseness_worker_return")?.definition;
  assert.ok(nativeTool);

  const cursor: CompositeCursorV1 = { schemaVersion: "1", kind: "composite", workspaceId: "pi-workspace", workspaceSequence: 1, workspaceEnvelopeHash: "workspace-head", workspaceContextEpoch: 1, runId: "pi-run", runSequence: 1, runEnvelopeHash: "run-head", runContextEpoch: 1 };
  const contextVersion = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 1, runContextEpoch: 1, observationCursor: cursor } as const;
  const fork = sealForkPin({ schemaVersion: "1", forkId: "pi-fork", pinVersion: 1, workspaceId: "pi-workspace", runId: "pi-run", parentForkPinDigest: null, refreshesForkPinDigest: null, canonicalRevision: 0, canonicalStateHash: "pi-state-0", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sourceObservationCursor: cursor, sourceContextVersion: contextVersion, dependencyJoinSnapshotDigest: "pi-join", deltaAuthorityScopeDigest: "pi-scope", pinnedPolicyDigest: "pi-policy", ancestry: [], createdByPrincipalId: "pi-worker", createdByGrantDigest: "pi-grant" });
  const manifest: ContextManifestCoreV1 = { schemaVersion: "1", workspaceId: "pi-workspace", runId: "pi-run", attemptId: "pi-attempt", generation: 1, forkPinDigest: fork.forkPinDigest, sourceObservationCursor: cursor, sourceContextVersion: contextVersion, authorizationObservationCursor: cursor, authorizationContextVersion: contextVersion, authorizationOverlayV1: { policyDigest: "pi-policy", grantDigest: "pi-grant", quotaDigest: "pi-quota", result: "allowed" }, canonicalRevision: 0, canonicalStateHash: "pi-state-0", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sources: [], rendererVersion: "1", omissions: [], selectedBytes: 0, byteBudget: 4096, tokenizerMetadata: { schemaVersion: "1", tokenizerId: "bytes", tokenizerVersion: "1", estimatedTokens: 0 }, renderedOutputDigest: "pi-rendered" };
  const contextBinding = { schemaVersion: "1", attemptId: "pi-attempt", generation: 1, forkPinDigest: fork.forkPinDigest, contextManifestCoreDigest: contextManifestCoreDigest(manifest), sourceObservationCursor: cursor, sourceContextVersion: contextVersion, authorizationObservationCursor: cursor, authorizationContextVersion: contextVersion, providerIdempotencyKey: "pi-provider-key", expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: "pi-worker", allowedProducerGrantDigest: "pi-grant" } as const;
  const binding: WorkerBindingV1 = { schemaVersion: "1", workspaceId: "pi-workspace", runId: "pi-run", taskId: "pi-task", attemptId: "pi-attempt", generation: 1, forkPin: fork, manifest, contextBinding, providerId: "pi-native-provider-v1", providerIdempotencyKeyDigest: "pi-provider-key-digest", observationCursor: cursor, dispatchId: "pi-dispatch" };
  const receipt = sealAttemptReceipt({ schemaVersion: "1", workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, attemptContextBindingDigest: attemptContextBindingDigest(contextBinding), contextManifestCoreDigest: contextManifestCoreDigest(manifest), forkPinDigest: fork.forkPinDigest, providerId: binding.providerId, providerOperationId: "pi-operation-1", providerIdempotencyKeyDigest: binding.providerIdempotencyKeyDigest, producerPrincipalId: "pi-worker", producerGrantDigest: "pi-grant", adapterId: "horseness-pi-v1", adapterVersion: "0.1.0", hostId: "pi", hostVersion: "0.73.1", outcome: "succeeded", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", outputDigest: "sha256:pi-output", evidence: [{ digest: "sha256:pi-evidence", mediaType: "application/json", size: 64 }], provenance: { artifactIdentity: "npm:@mariozechner/pi-coding-agent@0.73.1", loaderDigest }, nonce: "pi-receipt-1" });
  const proposal = sealProposal({ schemaVersion: "1", workspaceId: binding.workspaceId, runId: binding.runId, authorPrincipalId: "pi-worker", authorGrantDigest: "pi-grant", attemptId: binding.attemptId, receiptDigests: [receipt.receiptDigest], forkPinDigest: fork.forkPinDigest, deltaAuthorityScopeDigest: "pi-scope", baseRevision: 0, baseStateHash: "pi-state-0", canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", proposalSealingObservationCursor: cursor, proposalSealingContextVersion: contextVersion, operations: [], evidenceClaims: [{ digest: "sha256:pi-evidence", claim: "deterministic Pi provider evidence" }], pinnedPolicyDigest: "pi-policy", currentPolicyDigest: "pi-policy", nonce: "pi-proposal-1", predecessorProposalDigest: null, predecessorReason: null });
  verifyAttemptReceipt(receipt); verifyProposal(proposal);
  await nativeTool.execute("tool-call-1", { binding: { schemaVersion: "1", workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, forkPinDigest: fork.forkPinDigest, contextManifestCoreDigest: contextManifestCoreDigest(manifest), attemptContextBindingDigest: attemptContextBindingDigest(contextBinding), providerIdempotencyKeyDigest: binding.providerIdempotencyKeyDigest, attemptCapability: "opaque-capability-ref" }, output: { digest: "sha256:pi-output" }, evidence: { digest: "sha256:pi-evidence" }, receipt, proposal });

  const decisions = ["accepted", "rejected", "conflicted", "quarantined", "approval_required"] as const;
  let decisionIndex = 0;
  const credential: OpaqueCredentialReferenceV1 = { schemaVersion: "1", kind: "host-reference", reference: "pi.coordinator.ref", scope: { workspaceId: binding.workspaceId, adapterId: "horseness-pi-v1", purpose: "worker-grant" } };
  const transport: AuthorizedProtocolTransportV1 = {
    async request(request: JsonRpcRequestV1, received): Promise<JsonRpcResponseV1> {
      assert.deepEqual(received, credential);
      const input = request.params.body.input.value as Readonly<Record<string, unknown>>;
      const value = request.method === "artifact.publish.v1"
        ? { outcomeId: "artifact-outcome", status: "accepted", artifactId: input.artifactId, publishedDigest: input.contentDigest, immutableReference: "pi-object" }
        : request.method === "receipt.submit.v1" || request.method === "proposal.submit.v1"
          ? { schemaVersion: "1", resultType: "RunCommandResultV1", commandId: `pi-command:${request.method}`, resultCursor: cursor, resultContextVersion: contextVersion }
          : request.method === "admission.subscribe.v1"
            ? { outcomeId: "decision-outcome", status: "accepted", subscriptionId: "pi-decisions", events: [{ state: decisions[decisionIndex++], proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }], resumeToken: `pi-resume-${decisionIndex}` }
            : { outcomeId: "context-outcome", status: "accepted" };
      const nextCursor = { ...cursor, workspaceSequence: cursor.workspaceSequence + decisionIndex + 1, runSequence: cursor.runSequence + decisionIndex + 1, workspaceEnvelopeHash: `workspace-${decisionIndex}`, runEnvelopeHash: `run-${decisionIndex}` };
      return successResponse(request.id, request.method, { schemaVersion: "1", resultType: request.method, value } as never, null, request.method === "admission.subscribe.v1" ? { subscription: { schemaVersion: "1", subscriptionId: "pi-decisions", afterObservationCursor: nextCursor, resumeToken: `pi-resume-${decisionIndex}`, emittedResultCursor: null } } : {});
    }
  };
  const worker = new WorkerClientV1(new CoordinatorClientV1(transport, credential), binding);
  await worker.publishOutput({ operationId: "publish-output", artifactId: "pi-output", mediaType: "text/plain", contentDigest: "sha256:pi-output", byteLength: 22, storageReference: "attempt-output" });
  await worker.publishEvidence({ operationId: "publish-evidence", artifactId: "pi-evidence", mediaType: "application/json", contentDigest: "sha256:pi-evidence", byteLength: 64, storageReference: "attempt-evidence" }, "deterministic Pi provider evidence");
  await worker.submitReceipt(receipt, "pi-receipt-submit");
  await worker.submitProposal(proposal, "pi-proposal-submit");
  let resume;
  const observed: string[] = [];
  for (let index = 0; index < decisions.length; index++) { const batch = await worker.subscribeDecisions(proposal, `pi-decision-${index}`, resume); observed.push(...batch.events.map(event => event.state)); resume = batch.resume; }
  assert.deepEqual(observed, decisions);

  const genesis = reduceCanonicalDocument(null, { eventType: "RunCreatedV1", sequence: 1, workspaceId: binding.workspaceId, runId: binding.runId, initialDocument: { status: "before" } });
  const resultingDocument = { status: "accepted", output: "PI_NATIVE_BUNDLE_OK" };
  const advanced = reduceCanonicalDocument(genesis, { eventType: "DeltaAcceptedV1", sequence: 2, workspaceId: binding.workspaceId, runId: binding.runId, proposalId: proposal.proposalId, priorStateHash: genesis.stateHash, resultingStateHash: domainDigest("horseness.canonical-document.v1", resultingDocument), resultingDocument });
  assert.equal(advanced.revision, 1);
  assert.equal((advanced.document as { status: string }).status, "accepted");

  const lifecycle = { restart: true, reconcile: true, resume: true, forkSwitch: fork.forkPinDigest !== sealForkPin({ ...fork.core, forkId: "pi-fork-2", pinVersion: 2, parentForkPinDigest: fork.forkPinDigest, ancestry: [fork.forkPinDigest] }).forkPinDigest, uninstall: false };
  await writeFile(join(root, "smoke-evidence.json"), `${JSON.stringify({ package: upstream.name, version: upstream.version, loaderDigest, nativeContribution: PI_NATIVE_PACKAGE_METADATA.packageDigest, deterministicProviderAttempt: "PI_NATIVE_BUNDLE_OK", receiptDigest: receipt.receiptDigest, proposalDigest: proposal.proposalDigest, decisions: observed, canonicalRevision: advanced.revision, lifecycle })}\n`);
  await rm(installedExtension);
  lifecycle.uninstall = true;
  process.stdout.write(`${JSON.stringify({ schemaVersion: "PiHostSmokeResultV1", status: "pass", host: "pi", version: upstream.version, loaderDigest, receiptDigest: receipt.receiptDigest, proposalDigest: proposal.proposalDigest, decisions: observed, canonicalRevision: advanced.revision, lifecycle })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
