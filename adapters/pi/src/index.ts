import { createBindingGuard, parseCredentialReferenceV1, parseDoctorProbeResultV1, parseInstallContributionV1, SecureWorkerAdapterV1, type CredentialReferenceV1, type InstallContributionV1, type WorkerReturnClientV1 } from "@horseness/adapter-kit";
import { sealAttemptReceipt, type AttemptReceiptEnvelopeV1, type JsonValue, type ProposalEnvelopeV1 } from "@horseness/domain";
import type { AdapterCapabilitiesV1, AdapterCancelRequestV1, AdapterLaunchRequestV1, AdapterOperationResultV1, AdapterReconcileRequestV1, AdapterResumeRequestV1, BoundAdapterOperationV1, DoctorProbeResultV1, NativePackageMetadataV1, WorkerAdapterV1, WorkerReturnV1 } from "@horseness/protocol";

export const ADAPTER_PI_PACKAGE = "@horseness/adapter-pi" as const;
export const PI_ADAPTER_ID = "horseness-pi-v1" as const;
export const PI_ADAPTER_VERSION = "0.1.0" as const;
export const PI_HOST_ID = "pi" as const;
export const PI_HOST_VERSION = "0.73.1" as const;
export const PI_PROVIDER_ID = "pi-native-provider-v1" as const;

export const PI_NATIVE_PACKAGE_METADATA = Object.freeze({
  schemaVersion: "1",
  adapterId: PI_ADAPTER_ID,
  adapterVersion: PI_ADAPTER_VERSION,
  hostId: PI_HOST_ID,
  hostVersionRange: "=0.73.1",
  packageDigest: "sha256:3a80d611b28b2dfa16cbf84708ef55a9869b70110fd07f7977905e49a756d350",
  contributions: Object.freeze([
    Object.freeze({ kind: "extension", name: "extensions/horseness-pi.mjs", digest: "sha256:2e65ec2d93f2d8ed260dde788a9d88295c6617a597fa0a77574ad139acc24438" }),
    Object.freeze({ kind: "manifest", name: "pi-package.json", digest: "sha256:40e9360a415df49d0674f2bcd58464c9f34d082aded0d8b7d55f33ca04210ba6" }),
  ]),
}) satisfies NativePackageMetadataV1;

export const PI_INSTALL_CONTRIBUTIONS = Object.freeze([
  parseInstallContributionV1({ schemaVersion: "1", kind: "plugin", contributionId: "horseness-pi-extension", relativePath: "extensions/horseness-pi.mjs", contentDigest: PI_NATIVE_PACKAGE_METADATA.contributions[0]!.digest, sourceArtifactDigest: PI_NATIVE_PACKAGE_METADATA.packageDigest, mode: "read-only", hostScope: PI_HOST_ID }),
  parseInstallContributionV1({ schemaVersion: "1", kind: "file", contributionId: "horseness-pi-manifest", relativePath: "pi-package.json", contentDigest: PI_NATIVE_PACKAGE_METADATA.contributions[1]!.digest, sourceArtifactDigest: PI_NATIVE_PACKAGE_METADATA.packageDigest, mode: "read-only", hostScope: PI_HOST_ID }),
]) satisfies readonly InstallContributionV1[];

export interface PiNativeAttemptV1 {
  readonly providerOperationId: string;
  readonly nativeSessionId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly outputDigest: string | null;
  readonly evidence: readonly { readonly digest: string; readonly mediaType: string; readonly size: number }[];
  readonly provenance: JsonValue;
}

export interface PiNativeRuntimeV1 {
  launch(request: Readonly<AdapterLaunchRequestV1>): Promise<PiNativeAttemptV1>;
  cancel(request: Readonly<AdapterCancelRequestV1>): Promise<PiNativeAttemptV1 | null>;
  reconcile(request: Readonly<AdapterReconcileRequestV1>): Promise<PiNativeAttemptV1 | null>;
  resume(request: Readonly<AdapterResumeRequestV1>): Promise<PiNativeAttemptV1 | null>;
  collect(binding: Readonly<BoundAdapterOperationV1>): Promise<PiNativeAttemptV1 | null>;
}

export interface PiAdapterOptionsV1 {
  readonly binding: BoundAdapterOperationV1;
  readonly credential: CredentialReferenceV1;
  readonly runtime: PiNativeRuntimeV1;
  readonly producerPrincipalId: string;
  readonly producerGrantDigest: string;
}

export interface PiWorkerReturnAuthorityV1 {
  readonly client: WorkerReturnClientV1;
  sealProposal(binding: Readonly<BoundAdapterOperationV1>, receipt: AttemptReceiptEnvelopeV1): Promise<ProposalEnvelopeV1>;
}
export interface PiWorkerReturnDeliveryV1 { readonly receiptDigest: string; readonly decision: string; readonly resumeToken: string | null }
export interface PiWorkerReturnRegistrationV1 {
  readonly capabilityReference: string;
  readonly binding: BoundAdapterOperationV1;
  readonly adapter: SecureWorkerAdapterV1;
  readonly authority: PiWorkerReturnAuthorityV1;
  readonly subscriptionId: string;
}
export interface PiRetainedDeliveryV1 {
  readonly workerReturn: WorkerReturnV1;
  readonly receiptDigest: string;
  readonly proposalSubmitted: boolean;
  readonly resumeToken: string | null;
  readonly decision: string | null;
}
export interface PiRetainedDeliveryAuthorityV1 {
  load(attemptKey: string): PiRetainedDeliveryV1 | undefined;
  store(attemptKey: string, value: PiRetainedDeliveryV1): void;
  clear(): void;
}
export function createPiRetainedDeliveryAuthorityV1(): PiRetainedDeliveryAuthorityV1 {
  const records = new Map<string, PiRetainedDeliveryV1>();
  return Object.freeze({
    load(key: string) {
      const value = records.get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    store(key: string, value: PiRetainedDeliveryV1) {
      records.set(key, structuredClone(value));
    },
    clear() {
      records.clear();
    },
  });
}
export interface PiNativeContributionRuntimeOptionsV1 {
  readonly retained?: PiRetainedDeliveryAuthorityV1;
  readonly afterDecisionCheckpoint?: () => void;
}
export interface PiNativeContributionRuntimeV1 {
  deliver(capabilityReference: string, output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }): Promise<{ workerReturn: WorkerReturnV1; delivery: PiWorkerReturnDeliveryV1 }>;
  state(): Promise<{ readonly attemptKeys: readonly string[] }>;
  shutdown(): Promise<void>;
}
function attemptKey(binding: BoundAdapterOperationV1): string {
  return `${binding.workspaceId}:${binding.runId}:${binding.taskId}:${binding.attemptId}:${binding.generation}`;
}
export function createPiNativeContributionRuntimeV1(registrations: readonly PiWorkerReturnRegistrationV1[], options: PiNativeContributionRuntimeOptionsV1 = {}): PiNativeContributionRuntimeV1 {
  const active = new Map<string, PiWorkerReturnRegistrationV1>();
  const retained = options.retained ?? createPiRetainedDeliveryAuthorityV1();
  for (const registration of registrations) {
    const reference = parseCredentialReferenceV1({ schemaVersion: "1", kind: "host-reference", reference: registration.capabilityReference, scope: { workspaceId: registration.binding.workspaceId, adapterId: PI_ADAPTER_ID, purpose: "pi-attempt-return" } });
    if (reference.reference !== registration.binding.attemptCapability) throw new Error("Pi attempt capability reference does not match immutable binding");
    if (active.has(reference.reference)) throw new Error("duplicate Pi attempt capability reference");
    active.set(reference.reference, registration);
  }
  return Object.freeze({
    async deliver(capabilityReference: string, output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }) {
      const registration = active.get(capabilityReference);
      if (registration === undefined) throw new Error("unknown or revoked Pi attempt capability reference");
      const key = attemptKey(registration.binding);
      const receipt = await registration.adapter.collectReceipt(registration.binding);
      if (receipt.outputDigest !== output.digest || receipt.evidence.length !== 1 || receipt.evidence[0]?.digest !== evidence.digest || receipt.evidence[0]?.mediaType !== evidence.mediaType || receipt.evidence[0]?.size !== evidence.byteLength) throw new Error("provider output does not match the bound Pi attempt receipt");
      let record = retained.load(key);
      if (record !== undefined) {
        const publications = record.workerReturn.publications;
        if (record.workerReturn.receipt.receiptDigest !== receipt.receiptDigest || publications.length !== 2 || publications[0]?.kind !== "artifact" || publications[0].digest !== output.digest || publications[1]?.kind !== "evidence" || publications[1].digest !== evidence.digest) throw new Error("replayed Pi worker return substituted the canonical output/evidence tuple");
      } else {
        const proposal = await registration.authority.sealProposal(registration.binding, receipt);
        const workerReturn: WorkerReturnV1 = { schemaVersion: "1", binding: registration.binding, receipt, proposal, publications: [{ digest: output.digest, kind: "artifact" }, { digest: evidence.digest, kind: "evidence" }], decisionResume: { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, subscriptionId: registration.subscriptionId, resumeToken: null } };
        for (const publication of workerReturn.publications) await registration.authority.client.publishObject(publication.digest, publication.kind);
        const receiptDigest = await registration.authority.client.submitReceipt(receipt, registration.binding);
        const submitted = await registration.authority.client.submitProposal(proposal, registration.binding);
        if (submitted.proposalId !== proposal.proposalId || submitted.proposalDigest !== proposal.proposalDigest) throw new Error("Pi proposal submission returned a substituted binding");
        record = { workerReturn, receiptDigest, proposalSubmitted: true, resumeToken: null, decision: null };
        retained.store(key, record);
      }
      if (record.decision === null) {
        const observed = await registration.authority.client.subscribeDecision({ proposalId: record.workerReturn.proposal.proposalId, proposalDigest: record.workerReturn.proposal.proposalDigest, subscriptionId: registration.subscriptionId, resumeToken: record.resumeToken });
        if (observed.resumeToken === null) throw new Error("Pi decision authority did not issue a resumable token");
        if (options.afterDecisionCheckpoint !== undefined) {
          record = { ...record, resumeToken: observed.resumeToken };
          retained.store(key, record);
          options.afterDecisionCheckpoint();
        }
        record = { ...record, resumeToken: observed.resumeToken, decision: observed.decision };
        retained.store(key, record);
      }
      return structuredClone({ workerReturn: record.workerReturn, delivery: { receiptDigest: record.receiptDigest, decision: record.decision!, resumeToken: record.resumeToken } });
    },
    async state() { return { attemptKeys: registrations.map(registration => attemptKey(registration.binding)).filter(key => retained.load(key) !== undefined) }; },
    async shutdown() { active.clear(); retained.clear(); },
  });
}

const result = (status: AdapterOperationResultV1["status"], attempt: PiNativeAttemptV1 | null, details: JsonValue = {}): AdapterOperationResultV1 => ({ schemaVersion: "1", status, providerOperationId: attempt?.providerOperationId ?? null, nativeSessionId: attempt?.nativeSessionId ?? null, details });

class PiWorkerAdapterV1 implements WorkerAdapterV1 {
  readonly #guard;
  readonly #runtime: PiNativeRuntimeV1;
  readonly #producerPrincipalId: string;
  readonly #producerGrantDigest: string;
  #attempt: PiNativeAttemptV1 | null = null;

  constructor(options: PiAdapterOptionsV1) {
    this.#guard = createBindingGuard(options.binding);
    const credential = parseCredentialReferenceV1(options.credential);
    if (credential.scope.workspaceId !== options.binding.workspaceId || credential.scope.adapterId !== PI_ADAPTER_ID || credential.scope.purpose !== "pi-provider-auth") throw new Error("Pi credential reference scope does not match immutable adapter binding");
    this.#runtime = options.runtime;
    this.#producerPrincipalId = options.producerPrincipalId;
    this.#producerGrantDigest = options.producerGrantDigest;
  }

  async detectCapabilities(): Promise<AdapterCapabilitiesV1> {
    return { schemaVersion: "1", adapterId: PI_ADAPTER_ID, providerId: PI_PROVIDER_ID, launch: true, cancel: true, reconcile: "supported", reattach: "supported", nativeResume: "supported", contextInjection: "native", receiptCollection: true, maxContextBytes: 1_048_576, outputMediaTypes: ["text/plain", "application/json"], evidenceMediaTypes: ["application/json"] };
  }

  async launch(request: AdapterLaunchRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.launch(Object.freeze(structuredClone(request))); return result("accepted", this.#attempt, { host: PI_HOST_ID, hostVersion: PI_HOST_VERSION }); }
  async cancel(request: AdapterCancelRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.cancel(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async reconcile(request: AdapterReconcileRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.reconcile(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async resume(request: AdapterResumeRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.resume(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async collectReceipt(binding: BoundAdapterOperationV1): Promise<AttemptReceiptEnvelopeV1> {
    this.#guard.assert(binding);
    const attempt = await this.#runtime.collect(this.#guard.binding) ?? this.#attempt;
    if (attempt === null) throw new Error("Pi native attempt receipt is unavailable");
    return sealAttemptReceipt({ schemaVersion: "1", workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, attemptContextBindingDigest: binding.attemptContextBindingDigest, contextManifestCoreDigest: binding.contextManifestCoreDigest, forkPinDigest: binding.forkPinDigest, providerId: PI_PROVIDER_ID, providerOperationId: attempt.providerOperationId, providerIdempotencyKeyDigest: binding.providerIdempotencyKeyDigest, producerPrincipalId: this.#producerPrincipalId, producerGrantDigest: this.#producerGrantDigest, adapterId: PI_ADAPTER_ID, adapterVersion: PI_ADAPTER_VERSION, hostId: PI_HOST_ID, hostVersion: PI_HOST_VERSION, outcome: attempt.outcome, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, outputDigest: attempt.outputDigest, evidence: attempt.evidence, provenance: attempt.provenance, nonce: `${binding.attemptId}:${binding.generation}:${attempt.providerOperationId}` });
  }
}

export function createPiAdapterV1(options: PiAdapterOptionsV1): SecureWorkerAdapterV1 { return new SecureWorkerAdapterV1(options.binding, new PiWorkerAdapterV1(options)); }
export function piDoctorV1(input: { readonly nativePackageVersion: string | null; readonly loaderDigest: string | null; readonly contributionDigests: readonly string[] }): DoctorProbeResultV1 {
  const expected = PI_NATIVE_PACKAGE_METADATA.contributions.map(item => item.digest);
  return parseDoctorProbeResultV1({ schemaVersion: "1", checks: [
    { code: "PI_NATIVE_VERSION", status: input.nativePackageVersion === PI_HOST_VERSION ? "ok" : "error", evidenceDigest: input.nativePackageVersion === null ? null : `version:${input.nativePackageVersion}` },
    { code: "PI_EXTENSION_LOADER", status: input.loaderDigest === "sha256:0ffd7839e5626779e4e4d20cd55e647a7a9234a293025c6f1f361e7107e62a6b" ? "ok" : "error", evidenceDigest: input.loaderDigest },
    { code: "PI_CONTRIBUTIONS", status: expected.every(digest => input.contributionDigests.includes(digest)) && input.contributionDigests.length === expected.length ? "ok" : "error", evidenceDigest: PI_NATIVE_PACKAGE_METADATA.packageDigest },
  ], restartRequired: false });
}
