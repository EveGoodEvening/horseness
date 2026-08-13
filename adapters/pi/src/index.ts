import { createBindingGuard, parseCredentialReferenceV1, parseDoctorProbeResultV1, parseInstallContributionV1, SecureWorkerAdapterV1, type CredentialReferenceV1, type InstallContributionV1 } from "@horseness/adapter-kit";
import { sealAttemptReceipt, type AttemptReceiptEnvelopeV1, type JsonValue } from "@horseness/domain";
import type { AdapterCapabilitiesV1, AdapterCancelRequestV1, AdapterLaunchRequestV1, AdapterOperationResultV1, AdapterReconcileRequestV1, AdapterResumeRequestV1, BoundAdapterOperationV1, DoctorProbeResultV1, NativePackageMetadataV1, WorkerAdapterV1 } from "@horseness/protocol";

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
  packageDigest: "sha256:34682e5766cc61288f793fc1bd8d348870bab5c278997e9e68ac4bc70e3f3f65",
  contributions: Object.freeze([
    Object.freeze({ kind: "extension", name: "extensions/horseness-pi.mjs", digest: "sha256:056d1f66f801ca9d804bbb0913f45d33e99578ee8fdf9da2c222ba9bb10702d0" }),
    Object.freeze({ kind: "manifest", name: "pi-package.json", digest: "sha256:a6a1ba487b4639db7f718bffc9c70fa5e1594d7c4689db46e6c939be3d76fa34" }),
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
