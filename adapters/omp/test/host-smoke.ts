import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { WorkerReturnClientV1 } from "@horseness/adapter-kit";
import { NO_POLICY_DIGEST, NO_POLICY_V1, assertJsonValue, attemptContextBindingDigest, contextManifestCoreDigest, createRunGenesis, createWorkspaceGenesis, deltaAuthorityScopeDigest, jsonValueDigest, sealEventEnvelope, sealForkPin, sealProposal, type CapabilityV1, type CompositeCursorV1, type ContextManifestCoreV1, type DeltaAuthorityScopeV1, type JsonValue, type ProposalEnvelopeCoreV1 } from "@horseness/domain";
import { AdmissionService, loadRevision, type AdmissionCurrentAuthorityV1, type AdmissionRequestV1 } from "../../../packages/orchestrator/src/index.js";
import { sealPolicyDocument, type PolicyEffectV1 } from "../../../packages/policy/src/index.js";
import { SQLiteAuthority } from "../../../packages/store-sqlite/src/index.js";
import type { BoundAdapterOperationV1, WorkerReturnV1 } from "@horseness/protocol";
import { createOMPAdapterV1, createOMPNativeContributionRuntimeV1, createOMPRetainedDeliveryAuthorityV1, OMP_ADAPTER_ID, OMP_INSTALL_CONTRIBUTIONS, OMP_NATIVE_PACKAGE_METADATA, type OMPNativeAttemptV1, type OMPNativeRuntimeV1, type OMPRetainedDeliveryAuthorityV1, type OMPRetainedDeliveryPhaseV1, type OMPRetainedDeliveryV1 } from "../src/index.js";

async function resolvePackageRoot(packageName: string): Promise<{ packageRoot: string; packageJson: Record<string, unknown> }> {
  let candidate = dirname(fileURLToPath(import.meta.resolve(packageName)));
  while (true) {
    try { const packageJson = JSON.parse(await readFile(join(candidate, "package.json"), "utf8")) as Record<string, unknown>; if (packageJson.name === packageName) return { packageRoot: candidate, packageJson }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(candidate); if (parent === candidate) throw new Error(`Could not locate ${packageName}`); candidate = parent;
  }
}
const digestFile = async (path: string) => `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
const packageDigest = (extensionDigest: string, manifestDigest: string) => `sha256:${createHash("sha256").update(`horseness-omp-shipped-artifact-v1\nextensions/horseness-omp.mjs\0${extensionDigest}\nomp-package.json\0${manifestDigest}\n`).digest("hex")}`;
async function runBunProbe(args: readonly string[], cwd: string): Promise<string> {
  const child = spawn("bun", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  let spawnError: Error | undefined;
  let timedOut = false;
  let forceKill: NodeJS.Timeout | undefined;

  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.once("error", error => { spawnError = error; });

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
  }, 30_000);

  const { exitCode, signal } = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => {
    clearTimeout(timeout);
    clearTimeout(forceKill);
  });

  const evidence = `stdout:\n${stdout || "<empty>"}\nstderr:\n${stderr || "<empty>"}`;
  assert.equal(spawnError, undefined, `Bun loader probe failed to start: ${spawnError?.message}\n${evidence}`);
  assert.equal(timedOut, false, `Bun loader probe timed out after 30000ms (signal ${signal ?? "none"})\n${evidence}`);
  assert.equal(signal, null, `Bun loader probe terminated by ${signal}\n${evidence}`);
  assert.equal(exitCode, 0, `Bun loader probe exited with ${exitCode}\n${evidence}`);
  return stdout;
}

type WorkerToolDetails = { workerReturn: WorkerReturnV1; delivery: { decision: string; resumeToken: string | null } };
type NativeTool = { execute(id: string, input: unknown): Promise<{ details: WorkerToolDetails }> };
type StateTool = { execute(id: string, input: unknown): Promise<{ details: { activeForkPinDigest: string | null } }> };
type ExtensionTool = { definition: unknown };
type Extension = { tools: Map<string, ExtensionTool>; handlers: Map<string, Array<(event: unknown, context: unknown) => Promise<unknown>>> };
const emit = async (extension: Extension, name: string, event: unknown) => { const results = []; for (const handler of extension.handlers.get(name) ?? []) results.push(await handler(event, Object.freeze({}))); return results; };
const jsonWireValue = (value: unknown): JsonValue => { const wire: unknown = JSON.parse(JSON.stringify(value)); assertJsonValue(wire); return wire; };
class CrashableRetainedDeliveryAuthority implements OMPRetainedDeliveryAuthorityV1 {
  private crashAfter: OMPRetainedDeliveryPhaseV1 | null = null;
  private retained: OMPRetainedDeliveryAuthorityV1;
  constructor(private readonly stateDirectory: string) { this.retained = createOMPRetainedDeliveryAuthorityV1(stateDirectory); }
  injectAfter(phase: OMPRetainedDeliveryPhaseV1 | null): void { this.crashAfter = phase; }
  reopen(): void { this.retained.close(); this.retained = createOMPRetainedDeliveryAuthorityV1(this.stateDirectory); }
  load(attemptKey: string): OMPRetainedDeliveryV1 | undefined { return this.retained.load(attemptKey); }
  create(attemptKey: string, value: OMPRetainedDeliveryV1): boolean { return this.retained.create(attemptKey, value); }
  compareAndSet(attemptKey: string, expectedPhase: OMPRetainedDeliveryPhaseV1, value: OMPRetainedDeliveryV1): boolean { const stored = this.retained.compareAndSet(attemptKey, expectedPhase, value); if (stored && value.phase === this.crashAfter) { this.crashAfter = null; throw new Error(`simulated native host crash after ${value.phase}`); } return stored; }
  runExclusive<T>(attemptKey: string, operation: () => Promise<T>): Promise<T> { return this.retained.runExclusive(attemptKey, operation); }
  close(): void { this.retained.close(); }
  clear(): void { this.retained.clear(); }
}

let extension: Extension | null = null;
const root = await mkdtemp(join(tmpdir(), "horseness-omp-smoke-"));
try {
  const { packageRoot, packageJson: upstream } = await resolvePackageRoot("@oh-my-pi/pi-coding-agent");
  assert.equal(upstream.version, "17.2.15");
  const loaderPath = join(packageRoot, "src/extensibility/extensions/loader.ts");
  const loaderDigest = await digestFile(loaderPath);
  assert.equal(loaderDigest, "sha256:c0076ad052d435ee1075abfa0682e83ad4a075a1415c720bbbdf71d9affcc48f");
  const extensionSource = fileURLToPath(new URL("../native/extensions/horseness-omp.mjs", import.meta.url));
  const manifestSource = fileURLToPath(new URL("../native/omp-package.json", import.meta.url));
  const extensionDigest = await digestFile(extensionSource); const manifestDigest = await digestFile(manifestSource);
  assert.deepEqual([extensionDigest, manifestDigest], OMP_NATIVE_PACKAGE_METADATA.contributions.map(item => item.digest));
  assert.equal(packageDigest(extensionDigest, manifestDigest), OMP_NATIVE_PACKAGE_METADATA.packageDigest);

  const installedExtension = join(root, "extensions", "horseness-omp.mjs"); await cp(extensionSource, installedExtension);
  const probeOutput = await runBunProbe([fileURLToPath(new URL("./load-native.ts", import.meta.url)), loaderPath, installedExtension, root], root);
  const nativeInventory = JSON.parse(probeOutput) as { tools: string[]; commands: string[]; handlers: string[] };
  assert.deepEqual(nativeInventory.tools, ["horseness_worker_return", "horseness_native_state"]); assert.deepEqual(nativeInventory.commands, ["horseness-state"]); assert.ok(nativeInventory.handlers.includes("agent_start"));
  const loadContribution = async (): Promise<Extension> => {
    const tools = new Map<string, ExtensionTool>(); const handlers = new Map<string, Array<(event: unknown, context: unknown) => Promise<unknown>>>(); const commands = new Map<string, unknown>();
    const api = { registerTool(definition: { name: string }) { tools.set(definition.name, { definition }); }, registerCommand(name: string, definition: unknown) { commands.set(name, definition); }, on(name: string, handler: (event: unknown, context: unknown) => Promise<unknown>) { const current = handlers.get(name) ?? []; current.push(handler); handlers.set(name, current); } };
    const module = await import(pathToFileURL(installedExtension).href); // Runtime-installed native contribution under test.
    module.default(api); return { tools, handlers, commands } as Extension;
  };
  let nativeTool: NativeTool | undefined; let stateTool: StateTool | undefined;

  const outcomes = ["accepted", "rejected", "conflicted", "quarantined", "approval_required"] as const;
  const observed: string[] = []; let acceptedRevision = 0; let acceptedDocument: JsonValue = null; let acceptedReturn: WorkerReturnV1 | null = null;
  for (const desired of outcomes) {
    const scenarioRoot = join(root, desired); await mkdir(scenarioRoot, { recursive: true }); const authority = new SQLiteAuthority(join(scenarioRoot, "authority.sqlite"), join(scenarioRoot, "artifacts"));
    try {
      const workspaceId = `omp-${desired}`; const runId = "run"; const taskId = "task"; const attemptId = "attempt";
      const workspace = createWorkspaceGenesis({ workspaceId, authorityPrincipalId: "authority", initialGrantDigest: "grant", authorityConsumptionMarker: "marker", activePolicyDigest: NO_POLICY_DIGEST, commandId: "workspace" });
      authority.appendAtomic({ commandId: "workspace", workspace: { streamKind: "workspace", workspaceId, streamId: workspaceId, expectedSequence: 0, expectedEnvelopeHash: null, events: [workspace.event] } });
      const absent = { schemaVersion: "1", kind: "absent-run-genesis", workspaceId, workspaceSequence: 1, workspaceEnvelopeHash: workspace.event.envelopeHash, workspaceContextEpoch: 0, runId, expectedRunHead: "absent" } as const;
      const run = createRunGenesis({ observationCursor: absent, initialDocument: { value: 1 }, principalId: "worker", commandId: "run" }); authority.appendAtomic({ commandId: "run", runGenesis: { observationCursor: absent, event: run.event } });
      const cursor: CompositeCursorV1 = run.resultCursor; const revision = loadRevision(authority, workspaceId, runId);
      const scope: DeltaAuthorityScopeV1 = { schemaVersion: "1", workspaceId, runId, taskId, roots: ["/value"] };
      const effect: PolicyEffectV1 = desired === "rejected" ? "rejected" : desired === "approval_required" ? "approval_required" : "accepted";
      const policy = effect === "accepted" ? NO_POLICY_V1 : sealPolicyDocument({ schemaVersion: "1", kind: "policy", policyId: `policy-${desired}`, revision: 0, predecessorDigest: null, rules: [{ ruleId: "rule", subject: { action: null, pathPrefix: null, version: null }, effect, constraints: [], evidence: [] }] });
      const policyDigest = "policyDigest" in policy ? policy.policyDigest : NO_POLICY_DIGEST;
      const stale = desired === "conflicted";
      const fork = sealForkPin({ schemaVersion: "1", forkId: `fork-${desired}`, pinVersion: 1, workspaceId, runId, parentForkPinDigest: null, refreshesForkPinDigest: null, canonicalRevision: stale ? revision.revision + 1 : revision.revision, canonicalStateHash: stale ? "stale-state" : revision.stateHash, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sourceObservationCursor: cursor, sourceContextVersion: { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 0, runContextEpoch: 0, observationCursor: cursor }, dependencyJoinSnapshotDigest: "join", deltaAuthorityScopeDigest: deltaAuthorityScopeDigest(scope), pinnedPolicyDigest: policyDigest, ancestry: [], createdByPrincipalId: "worker", createdByGrantDigest: "grant" });
      const manifest: ContextManifestCoreV1 = { schemaVersion: "1", workspaceId, runId, attemptId, generation: 1, forkPinDigest: fork.forkPinDigest, sourceObservationCursor: cursor, sourceContextVersion: fork.core.sourceContextVersion, authorizationObservationCursor: cursor, authorizationContextVersion: fork.core.sourceContextVersion, authorizationOverlayV1: { policyDigest, grantDigest: "grant", quotaDigest: "quota-digest", result: "allowed" }, canonicalRevision: revision.revision, canonicalStateHash: revision.stateHash, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", sources: [], rendererVersion: "1", omissions: [], selectedBytes: 0, byteBudget: 4096, tokenizerMetadata: { schemaVersion: "1", tokenizerId: "bytes", tokenizerVersion: "1", estimatedTokens: 0, bytesPerTokenNumerator: 1, bytesPerTokenDenominator: 1 }, renderedOutputDigest: "rendered" };
      const contextBinding = { schemaVersion: "1", attemptId, generation: 1, forkPinDigest: fork.forkPinDigest, contextManifestCoreDigest: contextManifestCoreDigest(manifest), sourceObservationCursor: cursor, sourceContextVersion: fork.core.sourceContextVersion, authorizationObservationCursor: cursor, authorizationContextVersion: fork.core.sourceContextVersion, providerIdempotencyKey: `provider-${desired}`, expectedReceiptSchemaVersion: "1", allowedProducerPrincipalId: "worker", allowedProducerGrantDigest: "grant" } as const;
      const binding: BoundAdapterOperationV1 = { schemaVersion: "1", workspaceId, runId, taskId, attemptId, generation: 1, forkPinDigest: fork.forkPinDigest, contextManifestCoreDigest: contextManifestCoreDigest(manifest), attemptContextBindingDigest: attemptContextBindingDigest(contextBinding), providerIdempotencyKeyDigest: `provider-digest-${desired}`, attemptCapability: `omp-attempt-capability-${desired}` };
      const output = { digest: createHash("sha256").update(`output-${desired}`).digest("hex"), mediaType: "text/plain", byteLength: Buffer.byteLength(`output-${desired}`) };
      const evidence = { digest: createHash("sha256").update(`evidence-${desired}`).digest("hex"), mediaType: "application/json", byteLength: Buffer.byteLength(`evidence-${desired}`), claim: `OMP ${desired} evidence` };
      const attempt: OMPNativeAttemptV1 = { providerOperationId: `operation-${desired}`, nativeSessionId: `session-${desired}`, startedAt: "2026-08-13T00:00:00Z", finishedAt: "2026-08-13T00:00:01Z", outcome: "succeeded", outputDigest: output.digest, evidence: [{ digest: evidence.digest, mediaType: evidence.mediaType, size: evidence.byteLength }], provenance: { host: "omp", version: "17.2.15" } };
      let deliveredDecision: typeof desired | null = null;
      let authorityCursor: CompositeCursorV1 | null = null;
      const publicationKinds: string[] = [];
      const delivery = {
        subscriptionId: `subscription-${desired}`,
        sealProposal: (core: ProposalEnvelopeCoreV1, receipt: WorkerReturnV1["receipt"]) => {
          const head = authority.replay(workspaceId, "run", runId).at(-1)!;
          const payload = { eventType: "AttemptReceiptRecordedV1", workspaceId, runId, receiptId: receipt.receiptId, receiptDigest: receipt.receiptDigest, outcome: receipt.outcome } as const;
          const event = sealEventEnvelope({ schemaVersion: "1", streamKind: "run", workspaceId, streamId: runId, sequence: head.envelope.sequence + 1, priorEnvelopeHash: head.envelopeHash, eventId: `receipt-${desired}`, eventType: payload.eventType, payload, principalId: "worker", causationId: `receipt-${desired}`, correlationId: `receipt-${desired}`, idempotencyKey: `receipt-${desired}` });
          authorityCursor = { ...cursor, runSequence: event.envelope.sequence, runEnvelopeHash: event.envelopeHash, runContextEpoch: event.envelope.sequence - 1 };
          const capability: CapabilityV1 = { schemaVersion: "1", workspaceId, runId, commands: ["submit-proposal"], issuer: "authority", delegatee: "worker", issuedObservationSequence: 1, expiresObservationSequence: 100, nonce: `cap-${desired}`, revocationSequence: null };
          const current: AdmissionCurrentAuthorityV1 = { schemaVersion: "1", evaluationObservationCursor: authorityCursor, currentPolicy: policy, authorization: { role: "worker", capabilityId: "capability", capability, grantDigest: "grant", revoked: false }, quota: { id: "quota", digest: "quota-digest", available: desired !== "quarantined" }, authenticatedApproverPrincipalId: "approver", authorityTime: "2026-08-13T00:00:02Z" };
          authority.publishAndAppendAtomic({ commandId: `receipt-${desired}`, run: { streamKind: "run", workspaceId, streamId: runId, expectedSequence: head.envelope.sequence, expectedEnvelopeHash: head.envelopeHash, events: [event] }, artifacts: [], snapshots: [
            { workspaceId, streamKind: "run", streamId: runId, sequence: authorityCursor.runSequence, envelopeHash: authorityCursor.runEnvelopeHash, projectionName: "admission-sealing", projectionVersion: "1", state: jsonWireValue({ schemaVersion: "1", observationCursor: authorityCursor, fork, scope, receipts: [receipt], pinnedPolicy: policy, evidence: [] }) },
            { workspaceId, streamKind: "run", streamId: runId, sequence: authorityCursor.runSequence, envelopeHash: authorityCursor.runEnvelopeHash, projectionName: "admission-current", projectionVersion: "1", state: jsonWireValue(current) },
          ] });
          const sealingContextVersion = { schemaVersion: "1", kind: "composite", workspaceContextEpoch: authorityCursor.workspaceContextEpoch, runContextEpoch: authorityCursor.runContextEpoch, observationCursor: authorityCursor } as const;
          return sealProposal({ ...core, receiptDigests: [receipt.receiptDigest], evidenceClaims: [], proposalSealingObservationCursor: authorityCursor, proposalSealingContextVersion: sealingContextVersion });
        },
        async publishObject(digest: string, kind: "artifact" | "evidence") { publicationKinds.push(kind); const isEvidence = kind === "evidence"; const content = isEvidence ? `evidence-${desired}` : `output-${desired}`; const record = authority.artifacts.publishAndRegister(content, isEvidence ? evidence.mediaType : output.mediaType); assert.equal(record.digest, digest); },
        async submitReceipt(receipt: WorkerReturnV1["receipt"]) { return receipt.receiptDigest; },
        async submitProposal(proposal: WorkerReturnV1["proposal"]) { assert.ok(authorityCursor); const request: AdmissionRequestV1 = { schemaVersion: "1", commandId: `admit-${desired}`, proposal, scopeDigest: proposal.core.deltaAuthorityScopeDigest, forkPinDigest: proposal.core.forkPinDigest, receiptDigests: proposal.core.receiptDigests, evidenceIds: [], policyDigest, quotaId: "quota", evaluationClock: { schemaVersion: "1", authorityTime: "2026-08-13T00:00:02Z", observationCursor: authorityCursor }, approval: null, authorization: { capabilityId: "capability" }, action: "apply-delta", version: "1" }; const authorityResult = new AdmissionService(authority).evaluateAndApply(request); deliveredDecision = authorityResult.state; return { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }; },
        async startDecisionSubscription(input: { resumeToken: string | null }) { assert.equal(input.resumeToken, null); return { resumeToken: `authority-resume-${desired}` }; },
        async observeDecision(input: { resumeToken: string }) { assert.equal(input.resumeToken, `authority-resume-${desired}`); assert.equal(deliveredDecision, desired); return { resumeToken: input.resumeToken, decision: deliveredDecision! }; },
      };
      const proposalCore: ProposalEnvelopeCoreV1 = { schemaVersion: "1", workspaceId, runId, authorPrincipalId: "worker", authorGrantDigest: "grant", attemptId, receiptDigests: [], forkPinDigest: fork.forkPinDigest, deltaAuthorityScopeDigest: deltaAuthorityScopeDigest(scope), baseRevision: fork.core.canonicalRevision, baseStateHash: fork.core.canonicalStateHash, canonicalizerVersion: "jcs-v1", hashVersion: "sha256-v1", proposalSealingObservationCursor: cursor, proposalSealingContextVersion: { schemaVersion: "1", kind: "composite", workspaceContextEpoch: 0, runContextEpoch: 0, observationCursor: cursor }, operations: [{ op: "replace", path: "/value", expectedValueDigest: jsonValueDigest(1), value: 2 }], evidenceClaims: [], pinnedPolicyDigest: policyDigest, currentPolicyDigest: policyDigest, nonce: `proposal-${desired}`, predecessorProposalDigest: null, predecessorReason: null };
      const providerRuntime: OMPNativeRuntimeV1 = { async launch() { return attempt; }, async cancel() { return attempt; }, async reconcile() { return attempt; }, async resume() { return attempt; }, async collect() { return attempt; } };
      const adapter = createOMPAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "omp.provider.ref", scope: { workspaceId, adapterId: OMP_ADAPTER_ID, purpose: "omp-provider-auth" } }, runtime: providerRuntime, producerPrincipalId: "worker", producerGrantDigest: "grant" });
      await adapter.launch({ ...binding, operation: "launch", renderedContextDigest: "rendered", providerOptions: {} });
      const retained = createOMPRetainedDeliveryAuthorityV1(join(scenarioRoot, "omp-retained"));
      Object.defineProperty(globalThis, Symbol.for("horseness.adapter.omp.native-runtime.v1"), { configurable: true, value: createOMPNativeContributionRuntimeV1([{ capabilityReference: binding.attemptCapability, binding, adapter, authority: { client: delivery as WorkerReturnClientV1, async sealProposal(_binding, receipt) { return delivery.sealProposal(proposalCore, receipt); } }, subscriptionId: delivery.subscriptionId }], { retained }), writable: true });
      extension = await loadContribution(); nativeTool = extension.tools.get("horseness_worker_return")?.definition as NativeTool | undefined; stateTool = extension.tools.get("horseness_native_state")?.definition as StateTool | undefined; assert.ok(nativeTool); assert.ok(stateTool);
      const native = await nativeTool.execute(`tool-${desired}`, { attemptCapabilityReference: binding.attemptCapability, output, evidence }); observed.push(native.details.delivery.decision);
      assert.equal(native.details.workerReturn.schemaVersion, "1"); assert.equal(native.details.workerReturn.binding.attemptCapability, binding.attemptCapability); assert.equal(native.details.delivery.resumeToken, `authority-resume-${desired}`); assert.deepEqual(publicationKinds, ["artifact", "evidence"]);
      const duplicate = await nativeTool.execute(`tool-${desired}-duplicate`, { attemptCapabilityReference: binding.attemptCapability, output, evidence }); assert.deepEqual(duplicate.details, native.details);
      await assert.rejects(() => nativeTool!.execute(`tool-${desired}-substituted`, { attemptCapabilityReference: binding.attemptCapability, output: { ...output, digest: createHash("sha256").update(`substituted-output-${desired}`).digest("hex") }, evidence }), /does not match the bound OMP attempt receipt|substituted the canonical output\/evidence tuple/);
      if (desired === "accepted") { const canonical = loadRevision(authority, workspaceId, runId); acceptedRevision = canonical.revision; acceptedDocument = canonical.document; acceptedReturn = native.details.workerReturn; assert.deepEqual(canonical.document, { value: 2 }); }
    } finally { authority.close(); }
  }

  {
    const workerReturn = acceptedReturn!;
    const binding = workerReturn.binding;
    const runtime: OMPNativeRuntimeV1 = { async launch() { throw new Error("not used"); }, async cancel() { return null; }, async reconcile() { return null; }, async resume() { return null; }, async collect() { return { providerOperationId: workerReturn.receipt.providerOperationId, nativeSessionId: "restart-session", startedAt: workerReturn.receipt.startedAt, finishedAt: workerReturn.receipt.finishedAt, outcome: workerReturn.receipt.outcome, outputDigest: workerReturn.receipt.outputDigest, evidence: workerReturn.receipt.evidence.map(item => ({ digest: item.digest, mediaType: item.mediaType, size: item.size })), provenance: workerReturn.receipt.provenance }; } };
    const adapter = createOMPAdapterV1({ binding, credential: { schemaVersion: "1", kind: "host-reference", reference: "omp.provider.restart", scope: { workspaceId: binding.workspaceId, adapterId: OMP_ADAPTER_ID, purpose: "omp-provider-auth" } }, runtime, producerPrincipalId: workerReturn.receipt.producerPrincipalId, producerGrantDigest: workerReturn.receipt.producerGrantDigest });
    const output = { digest: workerReturn.publications[0]!.digest, mediaType: "text/plain", byteLength: Buffer.byteLength("output-accepted") };
    const evidence = { digest: workerReturn.publications[1]!.digest, mediaType: "application/json", byteLength: Buffer.byteLength("evidence-accepted") };
    {
      let sideEffects = 0;
      const legacyClient = {
        async publishObject() { sideEffects++; },
        async submitReceipt() { sideEffects++; return workerReturn.receipt.receiptDigest; },
        async submitProposal() { sideEffects++; return { proposalId: workerReturn.proposal.proposalId, proposalDigest: workerReturn.proposal.proposalDigest }; },
        async subscribeDecision() { sideEffects++; return { resumeToken: "legacy", decision: "accepted" }; },
      } as unknown as WorkerReturnClientV1;
      const retained = createOMPRetainedDeliveryAuthorityV1(join(root, "legacy-decision-client"));
      assert.throws(() => createOMPNativeContributionRuntimeV1([{ capabilityReference: binding.attemptCapability, binding, adapter, authority: { client: legacyClient, async sealProposal() { sideEffects++; return workerReturn.proposal; } }, subscriptionId: workerReturn.decisionResume.subscriptionId }], { retained }), /requires resumable startDecisionSubscription and observeDecision/);
      assert.equal(sideEffects, 0);
      retained.close();
    }
    const crashPhases: readonly OMPRetainedDeliveryPhaseV1[] = ["publication:0", "publication:1", "receipt", "proposal", "decision-resume", "decision"];
    for (const crashPhase of crashPhases) {
      const retained = new CrashableRetainedDeliveryAuthority(join(root, `restart-${crashPhase.replace(":", "-")}`));
      const published = new Set<string>(); const submittedReceipts = new Set<string>(); const submittedProposals = new Set<string>();
      let publishes = 0; let receipts = 0; let proposals = 0; let seals = 0; let starts = 0;
      const resumeTokens: Array<string | null> = [];
      const client: WorkerReturnClientV1 = {
        async publishObject(digest) { if (!published.has(digest)) { published.add(digest); publishes++; } },
        async submitReceipt(receipt) { if (!submittedReceipts.has(receipt.receiptDigest)) { submittedReceipts.add(receipt.receiptDigest); receipts++; } return receipt.receiptDigest; },
        async submitProposal(proposal) { if (!submittedProposals.has(proposal.proposalDigest)) { submittedProposals.add(proposal.proposalDigest); proposals++; } return { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }; },
        async startDecisionSubscription(input) { starts++; resumeTokens.push(input.resumeToken); assert.equal(input.resumeToken, null); return { resumeToken: "authority-restart-token" }; },
        async observeDecision(input) { resumeTokens.push(input.resumeToken); assert.notEqual(input.resumeToken, null); return { resumeToken: "authority-final-token", decision: "accepted" }; },
      };
      const registration = { capabilityReference: binding.attemptCapability, binding, adapter, authority: { client, async sealProposal() { seals++; return workerReturn.proposal; } }, subscriptionId: workerReturn.decisionResume.subscriptionId };
      retained.injectAfter(crashPhase);
      const interrupted = createOMPNativeContributionRuntimeV1([registration], { retained });
      await assert.rejects(() => interrupted.deliver(binding.attemptCapability, output, evidence), new RegExp(`simulated native host crash after ${crashPhase}`));
      await interrupted.shutdown(); retained.reopen();
      const restarted = createOMPNativeContributionRuntimeV1([registration], { retained });
      const [first, duplicate] = await Promise.all([restarted.deliver(binding.attemptCapability, output, evidence), restarted.deliver(binding.attemptCapability, output, evidence)]);
      assert.deepEqual(duplicate, first); assert.equal(first.delivery.decision, "accepted"); assert.equal(first.delivery.resumeToken, "authority-final-token");
      assert.deepEqual([publishes, receipts, proposals, seals, starts], [2, 1, 1, 1, 1]);
      assert.equal(resumeTokens.filter(token => token === null).length, 1); if (crashPhase === "decision-resume") assert.deepEqual(resumeTokens, [null, "authority-restart-token"]);
      await assert.rejects(() => restarted.deliver(binding.attemptCapability, { ...output, digest: createHash("sha256").update(`substituted-${crashPhase}`).digest("hex") }, evidence), /does not match the bound OMP attempt receipt|substituted the canonical output\/evidence tuple/);
    }
    {
      const raceRoot = join(root, "cross-instance-race");
      const sideEffectCounts = { publishes: 0, receipts: 0, proposals: 0, seals: 0, starts: 0, observations: 0 };
      const retainedA = createOMPRetainedDeliveryAuthorityV1(join(raceRoot, "shared"));
      const retainedB = createOMPRetainedDeliveryAuthorityV1(join(raceRoot, "shared"));
      const makeClient = (_label: string): WorkerReturnClientV1 => ({
        async publishObject(_digest) { sideEffectCounts.publishes++; },
        async submitReceipt(receipt) { sideEffectCounts.receipts++; return receipt.receiptDigest; },
        async submitProposal(proposal) { sideEffectCounts.proposals++; return { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }; },
        async startDecisionSubscription(input) { sideEffectCounts.starts++; assert.equal(input.resumeToken, null); return { resumeToken: "race-resume-token" }; },
        async observeDecision(input) { sideEffectCounts.observations++; assert.notEqual(input.resumeToken, null); return { resumeToken: input.resumeToken, decision: "accepted" }; },
      });
      const makeRegistration = (_label: string) => ({ capabilityReference: binding.attemptCapability, binding, adapter, authority: { client: makeClient(_label), async sealProposal() { sideEffectCounts.seals++; return workerReturn.proposal; } }, subscriptionId: workerReturn.decisionResume.subscriptionId });
      const runtimeA = createOMPNativeContributionRuntimeV1([makeRegistration("A")], { retained: retainedA });
      const runtimeB = createOMPNativeContributionRuntimeV1([makeRegistration("B")], { retained: retainedB });
      const [resultA, resultB] = await Promise.all([runtimeA.deliver(binding.attemptCapability, output, evidence), runtimeB.deliver(binding.attemptCapability, output, evidence)]);
      assert.deepEqual(resultB, resultA); assert.equal(resultA.delivery.decision, "accepted");
      assert.equal(sideEffectCounts.publishes, 2); assert.equal(sideEffectCounts.receipts, 1); assert.equal(sideEffectCounts.proposals, 1); assert.equal(sideEffectCounts.seals, 1); assert.equal(sideEffectCounts.starts, 1); assert.equal(sideEffectCounts.observations, 1);
      await runtimeA.shutdown(); await runtimeB.shutdown();
    }
    {
      const raceRoot = join(root, "cross-instance-distinct");
      const retainedA = createOMPRetainedDeliveryAuthorityV1(join(raceRoot, "shared"));
      const retainedB = createOMPRetainedDeliveryAuthorityV1(join(raceRoot, "shared"));
      const distinctBinding: BoundAdapterOperationV1 = { ...binding, attemptCapability: `${binding.attemptCapability}-distinct`, attemptId: `${binding.attemptId}-distinct`, providerIdempotencyKeyDigest: `${binding.providerIdempotencyKeyDigest}-distinct` };
      const distinctAttempt: OMPNativeAttemptV1 = { providerOperationId: "operation-distinct", nativeSessionId: "session-distinct", startedAt: "2026-08-13T00:00:00Z", finishedAt: "2026-08-13T00:00:01Z", outcome: "succeeded", outputDigest: createHash("sha256").update("output-distinct").digest("hex"), evidence: [{ digest: createHash("sha256").update("evidence-distinct").digest("hex"), mediaType: "application/json", size: 17 }], provenance: {} };
      const distinctRuntime: OMPNativeRuntimeV1 = { async launch() { return distinctAttempt; }, async cancel() { return distinctAttempt; }, async reconcile() { return distinctAttempt; }, async resume() { return distinctAttempt; }, async collect() { return distinctAttempt; } };
      const distinctAdapter = createOMPAdapterV1({ binding: distinctBinding, credential: { schemaVersion: "1", kind: "host-reference", reference: "omp.provider.distinct", scope: { workspaceId: distinctBinding.workspaceId, adapterId: OMP_ADAPTER_ID, purpose: "omp-provider-auth" } }, runtime: distinctRuntime, producerPrincipalId: "worker", producerGrantDigest: "grant" });
      await distinctAdapter.launch({ ...distinctBinding, operation: "launch", renderedContextDigest: "rendered", providerOptions: {} });
      const distinctOutput = { digest: distinctAttempt.outputDigest!, mediaType: "text/plain", byteLength: 15 };
      const distinctEvidence = { digest: distinctAttempt.evidence[0]!.digest, mediaType: "application/json", byteLength: distinctAttempt.evidence[0]!.size };
      const makeClient = (_label: string): WorkerReturnClientV1 => ({
        async publishObject() { },
        async submitReceipt(receipt) { return receipt.receiptDigest; },
        async submitProposal(proposal) { return { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest }; },
        async startDecisionSubscription() { return { resumeToken: `distinct-resume-${_label}` }; },
        async observeDecision(input) { return { resumeToken: input.resumeToken, decision: "accepted" }; },
      });
      const registrationA = { capabilityReference: binding.attemptCapability, binding, adapter, authority: { client: makeClient("A"), async sealProposal() { return workerReturn.proposal; } }, subscriptionId: workerReturn.decisionResume.subscriptionId };
      const registrationB = { capabilityReference: distinctBinding.attemptCapability, binding: distinctBinding, adapter: distinctAdapter, authority: { client: makeClient("B"), async sealProposal(_binding: unknown, _receipt: unknown) { const sealed = await distinctAdapter.collectReceipt(distinctBinding); const sourceCore = workerReturn.proposal.core; const distinctProposalCore: ProposalEnvelopeCoreV1 = { schemaVersion: sourceCore.schemaVersion, workspaceId: distinctBinding.workspaceId, runId: distinctBinding.runId, authorPrincipalId: sourceCore.authorPrincipalId, authorGrantDigest: sourceCore.authorGrantDigest, attemptId: distinctBinding.attemptId, receiptDigests: [sealed.receiptDigest], forkPinDigest: distinctBinding.forkPinDigest, deltaAuthorityScopeDigest: sourceCore.deltaAuthorityScopeDigest, baseRevision: sourceCore.baseRevision, baseStateHash: sourceCore.baseStateHash, canonicalizerVersion: sourceCore.canonicalizerVersion, hashVersion: sourceCore.hashVersion, proposalSealingObservationCursor: sourceCore.proposalSealingObservationCursor, proposalSealingContextVersion: sourceCore.proposalSealingContextVersion, operations: sourceCore.operations, evidenceClaims: sourceCore.evidenceClaims, pinnedPolicyDigest: sourceCore.pinnedPolicyDigest, currentPolicyDigest: sourceCore.currentPolicyDigest, nonce: sourceCore.nonce, predecessorProposalDigest: sourceCore.predecessorProposalDigest, predecessorReason: sourceCore.predecessorReason }; return sealProposal(distinctProposalCore); } }, subscriptionId: workerReturn.decisionResume.subscriptionId };
      const runtimeA = createOMPNativeContributionRuntimeV1([registrationA], { retained: retainedA });
      const runtimeB = createOMPNativeContributionRuntimeV1([registrationB], { retained: retainedB });
      const [resultA, resultB] = await Promise.all([runtimeA.deliver(binding.attemptCapability, output, evidence), runtimeB.deliver(distinctBinding.attemptCapability, distinctOutput, distinctEvidence)]);
      assert.equal(resultA.delivery.decision, "accepted"); assert.equal(resultB.delivery.decision, "accepted"); assert.notDeepEqual(resultA.workerReturn.binding.attemptCapability, resultB.workerReturn.binding.attemptCapability);
      await runtimeA.shutdown(); await runtimeB.shutdown();
    }
  }

  const lifecycleCalls: string[] = []; const nativeAttempt: OMPNativeAttemptV1 = { providerOperationId: "omp-operation", nativeSessionId: "omp-session", startedAt: "2026-08-13T00:00:00Z", finishedAt: "2026-08-13T00:00:01Z", outcome: "succeeded", outputDigest: "output", evidence: [], provenance: {} };
  const runtime: OMPNativeRuntimeV1 = { async launch() { lifecycleCalls.push("launch"); return nativeAttempt; }, async cancel() { lifecycleCalls.push("cancel"); return nativeAttempt; }, async reconcile() { lifecycleCalls.push("reconcile"); return nativeAttempt; }, async resume(request) { lifecycleCalls.push(request.operation); return nativeAttempt; }, async collect() { lifecycleCalls.push("collect"); return nativeAttempt; } };
  const lifecycleBinding = acceptedReturn!.binding;
  const adapterOptions = { binding: lifecycleBinding, credential: { schemaVersion: "1" as const, kind: "host-reference" as const, reference: "omp.provider.ref", scope: { workspaceId: lifecycleBinding.workspaceId, adapterId: OMP_ADAPTER_ID, purpose: "omp-provider-auth" } }, runtime, producerPrincipalId: "worker", producerGrantDigest: "grant" };
  const launched = await createOMPAdapterV1(adapterOptions).launch({ ...lifecycleBinding, operation: "launch", renderedContextDigest: "rendered", providerOptions: {} });
  assert.equal(launched.providerOperationId, nativeAttempt.providerOperationId); assert.equal(launched.nativeSessionId, nativeAttempt.nativeSessionId);
  const restartedAdapter = createOMPAdapterV1(adapterOptions);
  const reconciled = await restartedAdapter.reconcile({ ...lifecycleBinding, operation: "reconcile", providerOperationId: nativeAttempt.providerOperationId });
  const reattached = await restartedAdapter.resume({ ...lifecycleBinding, operation: "reattach", providerOperationId: nativeAttempt.providerOperationId, nativeSessionId: nativeAttempt.nativeSessionId });
  const resumed = await restartedAdapter.resume({ ...lifecycleBinding, operation: "resume", providerOperationId: nativeAttempt.providerOperationId, nativeSessionId: nativeAttempt.nativeSessionId });
  const collected = await restartedAdapter.collectReceipt(lifecycleBinding);
  assert.deepEqual([reconciled.providerOperationId, reattached.nativeSessionId, resumed.nativeSessionId], [nativeAttempt.providerOperationId, nativeAttempt.nativeSessionId, nativeAttempt.nativeSessionId]); assert.equal(collected.providerOperationId, nativeAttempt.providerOperationId);
  assert.deepEqual(lifecycleCalls, ["launch", "reconcile", "reattach", "resume", "collect"]);
  assert.ok(extension); assert.ok(stateTool); assert.ok(nativeTool);
  const nextFork = `sha256:${createHash("sha256").update("active-fork-2").digest("hex")}`; await emit(extension, "session_before_branch", { type: "session_before_branch", entryId: "fork-entry", nextForkPinDigest: nextFork }); await emit(extension, "session_branch", { type: "session_branch", forkPinDigest: nextFork });
  const switched = await stateTool.execute("state", {}); assert.equal(switched.details.activeForkPinDigest, nextFork);
  await emit(extension, "session_shutdown", { type: "session_shutdown", reason: "uninstall" }); await rm(installedExtension); assert.equal(await import("node:fs").then(fs => fs.existsSync(installedExtension)), false); await assert.rejects(() => nativeTool.execute("after-uninstall", {}), /credential is disabled/);
  assert.deepEqual(OMP_INSTALL_CONTRIBUTIONS.map(item => item.contributionId), ["horseness-omp-extension", "horseness-omp-manifest"]);

  process.stdout.write(`${JSON.stringify({ schemaVersion: "OMPHostSmokeResultV1", host: "omp", version: upstream.version, loaderDigest, packageDigest: OMP_NATIVE_PACKAGE_METADATA.packageDigest, receiptDigest: acceptedReturn!.receipt.receiptDigest, proposalDigest: acceptedReturn!.proposal.proposalDigest, decisions: observed, canonicalRevision: acceptedRevision, canonicalDocument: acceptedDocument, lifecycle: { calls: lifecycleCalls, activeForkPinDigest: nextFork, uninstallDiscovery: "disabled", credential: "revoked" } })}\n`);
} finally { await rm(root, { recursive: true, force: true }); }
