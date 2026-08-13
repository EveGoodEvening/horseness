import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { createBindingGuard, deliverWorkerReturn, parseCredentialReferenceV1, parseDoctorProbeResultV1, parseInstallContributionV1, SecureWorkerAdapterV1, type CredentialReferenceV1, type InstallContributionV1, type WorkerReturnClientV1, type WorkerReturnDeliveryAuthorityV1, type WorkerReturnDeliveryStepV1 } from "@horseness/adapter-kit";
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
export type PiRetainedDeliveryPhaseV1 = "prepared" | "publication:0" | "publication:1" | "receipt" | "proposal" | "decision-resume" | "decision";
export interface PiRetainedDeliveryV1 {
  readonly workerReturn: WorkerReturnV1;
  readonly phase: PiRetainedDeliveryPhaseV1;
  readonly receiptDigest: string | null;
  readonly resumeToken: string | null;
  readonly decision: string | null;
}
export interface PiRetainedDeliveryAuthorityV1 {
  load(attemptKey: string): PiRetainedDeliveryV1 | undefined;
  create(attemptKey: string, value: PiRetainedDeliveryV1): boolean;
  compareAndSet(attemptKey: string, expectedPhase: PiRetainedDeliveryPhaseV1, value: PiRetainedDeliveryV1): boolean;
  runExclusive<T>(attemptKey: string, operation: () => Promise<T>): Promise<T>;
  close(): void;
  clear(): void;
}
export function createPiRetainedDeliveryAuthorityV1(stateDirectory: string): PiRetainedDeliveryAuthorityV1 {
  if (!isAbsolute(stateDirectory)) throw new Error("Pi retained state directory must be absolute");
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const stateStat = lstatSync(stateDirectory);
  if (stateStat.isSymbolicLink() || !stateStat.isDirectory() || (stateStat.mode & 0o077) !== 0) throw new Error("Pi retained state directory must be a private, non-symlink directory");
  const root = realpathSync(stateDirectory);
  const records = join(root, "records");
  const locks = join(root, "locks");
  for (const directory of [records, locks]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const details = lstatSync(directory);
    if (details.isSymbolicLink() || !details.isDirectory() || (details.mode & 0o077) !== 0 || dirname(realpathSync(directory)) !== root) throw new Error("Pi retained state path must be a private, non-symlink directory");
  }
  let closed = false;
  const held = new Map<string, string>();
  const assertOpen = () => { if (closed) throw new Error("Pi retained delivery authority is closed"); };
  const nameFor = (key: string) => createHash("sha256").update(key).digest("hex");
  const recordPath = (key: string) => join(records, `${nameFor(key)}.json`);
  const lockPath = (key: string) => join(locks, nameFor(key));
  const assertRegularPrivateFile = (path: string) => {
    const details = lstatSync(path);
    if (details.isSymbolicLink() || !details.isFile() || (details.mode & 0o077) !== 0) throw new Error("Pi retained state record must be a private regular file");
  };
  const readRecord = (key: string): PiRetainedDeliveryV1 | undefined => {
    assertOpen();
    const path = recordPath(key);
    try { assertRegularPrivateFile(path); return JSON.parse(readFileSync(path, "utf8")) as PiRetainedDeliveryV1; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  };
  const syncDirectory = (path: string) => { const descriptor = openSync(path, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } };
  const publish = (key: string, value: PiRetainedDeliveryV1) => {
    const path = recordPath(key);
    const temporary = join(records, `.${nameFor(key)}.${process.pid}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, JSON.stringify(value), "utf8"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, path);
    syncDirectory(records);
  };
  const ownerAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } };
  const acquire = async (key: string): Promise<string> => {
    assertOpen();
    const path = lockPath(key);
    const nonce = randomUUID();
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        mkdirSync(path, { mode: 0o700 });
        writeFileSync(join(path, "owner.json"), JSON.stringify({ pid: process.pid, nonce }), { encoding: "utf8", flag: "wx", mode: 0o600 });
        syncDirectory(path); syncDirectory(locks);
        return nonce;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const details = lstatSync(path);
        if (details.isSymbolicLink() || !details.isDirectory() || (details.mode & 0o077) !== 0) throw new Error("Pi retained lock path must be a private, non-symlink directory");
        let owner: { pid: number; nonce: string };
        try { assertRegularPrivateFile(join(path, "owner.json")); owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as { pid: number; nonce: string }; }
        catch (ownerError) {
          if (Date.now() - statSync(path).mtimeMs > 1_000) { rmSync(path, { recursive: true }); syncDirectory(locks); continue; }
          if (Date.now() >= deadline) throw new Error("Pi retained delivery lock acquisition timed out");
          const { promise: wait, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 10); await wait; continue;
        }
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.nonce !== "string") throw new Error("Pi retained delivery lock owner is invalid");
        if (!ownerAlive(owner.pid)) {
          const reread = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as { pid: number; nonce: string };
          if (reread.pid === owner.pid && reread.nonce === owner.nonce) { rmSync(path, { recursive: true }); syncDirectory(locks); continue; }
        }
        if (Date.now() >= deadline) throw new Error("Pi retained delivery lock acquisition timed out");
        const { promise: wait, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 10); await wait;
      }
    }
  };
  const release = (key: string, nonce: string) => {
    const path = lockPath(key);
    const owner = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as { pid: number; nonce: string };
    if (owner.pid !== process.pid || owner.nonce !== nonce) throw new Error("Pi retained delivery lock ownership changed before release");
    rmSync(path, { recursive: true }); syncDirectory(locks);
  };
  return Object.freeze({
    load(key: string) { const value = readRecord(key); return value === undefined ? undefined : structuredClone(value); },
    create(key: string, value: PiRetainedDeliveryV1) { if (held.get(key) === undefined) throw new Error("Pi retained create requires the attempt lock"); if (readRecord(key) !== undefined) return false; publish(key, structuredClone(value)); return true; },
    compareAndSet(key: string, expectedPhase: PiRetainedDeliveryPhaseV1, value: PiRetainedDeliveryV1) { if (held.get(key) === undefined) throw new Error("Pi retained compare-and-set requires the attempt lock"); if (readRecord(key)?.phase !== expectedPhase) return false; publish(key, structuredClone(value)); return true; },
    async runExclusive<T>(key: string, operation: () => Promise<T>) { assertOpen(); const nonce = await acquire(key); held.set(key, nonce); try { return await operation(); } finally { held.delete(key); release(key, nonce); } },
    close() { closed = true; },
    clear() { assertOpen(); for (const directory of [records, locks]) { rmSync(directory, { recursive: true }); mkdirSync(directory, { mode: 0o700 }); } syncDirectory(root); },
  });
}
export interface PiNativeContributionRuntimeOptionsV1 { readonly retained: PiRetainedDeliveryAuthorityV1 }
export interface PiNativeContributionRuntimeV1 {
  deliver(capabilityReference: string, output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }): Promise<{ workerReturn: WorkerReturnV1; delivery: PiWorkerReturnDeliveryV1 }>;
  state(): Promise<{ readonly attemptKeys: readonly string[] }>;
  shutdown(): Promise<void>;
}
function attemptKey(binding: BoundAdapterOperationV1): string {
  return `${binding.workspaceId}:${binding.runId}:${binding.taskId}:${binding.attemptId}:${binding.generation}`;
}
const DELIVERY_PHASES: readonly PiRetainedDeliveryPhaseV1[] = ["prepared", "publication:0", "publication:1", "receipt", "proposal", "decision-resume", "decision"];
const publicationPhase = (step: WorkerReturnDeliveryStepV1): PiRetainedDeliveryPhaseV1 => {
  if (step !== "publication:0" && step !== "publication:1") throw new Error("Pi retained delivery received an unsupported publication phase");
  return step;
};
const completedPhase = (step: WorkerReturnDeliveryStepV1): PiRetainedDeliveryPhaseV1 => step === "decision-subscription" ? "decision-resume" : step === "decision" ? "decision" : step === "receipt" || step === "proposal" ? step : publicationPhase(step);
const hasCompleted = (record: PiRetainedDeliveryV1, step: WorkerReturnDeliveryStepV1): boolean => DELIVERY_PHASES.indexOf(record.phase) >= DELIVERY_PHASES.indexOf(completedPhase(step));
class PiRetainedWorkerReturnDeliveryV1 implements WorkerReturnDeliveryAuthorityV1 {
  constructor(private readonly retained: PiRetainedDeliveryAuthorityV1, private readonly key: string) {}
  async perform<T>(step: WorkerReturnDeliveryStepV1, operation: () => Promise<T>): Promise<T> {
    const record = this.record();
    if (hasCompleted(record, step)) return this.completed<T>(record, step);
    const result = await operation();
    const next = { ...record, phase: completedPhase(step) };
    if (step === "receipt") next.receiptDigest = result as string;
    if (step === "decision-subscription") {
      const issued = result as { resumeToken: string };
      if (issued.resumeToken.length === 0) throw new Error("Pi decision authority did not issue a resumable token");
      next.resumeToken = issued.resumeToken;
      next.workerReturn = { ...record.workerReturn, decisionResume: { ...record.workerReturn.decisionResume, resumeToken: issued.resumeToken } };
    }
    if (step === "decision") {
      const observed = result as { resumeToken: string; decision: string };
      if (record.resumeToken === null || observed.resumeToken.length === 0) throw new Error("Pi decision observation lacks a retained resume token");
      next.resumeToken = observed.resumeToken; next.decision = observed.decision;
      next.workerReturn = { ...record.workerReturn, decisionResume: { ...record.workerReturn.decisionResume, resumeToken: observed.resumeToken } };
    }
    if (!this.retained.compareAndSet(this.key, record.phase, next)) throw new Error("Pi retained delivery phase compare-and-set conflict");
    return result;
  }
  private record(): PiRetainedDeliveryV1 {
    const record = this.retained.load(this.key);
    if (record === undefined) throw new Error("Pi retained worker return is unavailable");
    return record;
  }
  private completed<T>(record: PiRetainedDeliveryV1, step: WorkerReturnDeliveryStepV1): T {
    if (step === "receipt") { if (record.receiptDigest === null) throw new Error("Pi retained receipt digest is unavailable"); return record.receiptDigest as T; }
    if (step === "proposal") return { proposalId: record.workerReturn.proposal.proposalId, proposalDigest: record.workerReturn.proposal.proposalDigest } as T;
    if (step === "decision-subscription") { if (record.resumeToken === null) throw new Error("Pi retained decision subscription is unavailable"); return { resumeToken: record.resumeToken } as T; }
    if (step === "decision") { if (record.resumeToken === null || record.decision === null) throw new Error("Pi retained decision is unavailable"); return { resumeToken: record.resumeToken, decision: record.decision } as T; }
    return undefined as T;
  }
}
function assertCanonicalTuple(record: PiRetainedDeliveryV1, receipt: AttemptReceiptEnvelopeV1, outputDigest: string, evidenceDigest: string): void {
  const publications = record.workerReturn.publications;
  if (record.workerReturn.receipt.receiptDigest !== receipt.receiptDigest || publications.length !== 2 || publications[0]?.kind !== "artifact" || publications[0].digest !== outputDigest || publications[1]?.kind !== "evidence" || publications[1].digest !== evidenceDigest) throw new Error("replayed Pi worker return substituted the canonical output/evidence tuple");
}
export function createPiNativeContributionRuntimeV1(registrations: readonly PiWorkerReturnRegistrationV1[], options: PiNativeContributionRuntimeOptionsV1): PiNativeContributionRuntimeV1 {
  if (options?.retained === undefined) throw new Error("Pi native contribution runtime requires a durable retained delivery authority");
  for (const registration of registrations) {
    const client = registration.authority.client as WorkerReturnClientV1 & Record<string, unknown>;
    if (typeof client.startDecisionSubscription !== "function" || typeof client.observeDecision !== "function") throw new Error("Pi native contribution runtime requires resumable startDecisionSubscription and observeDecision authority methods");
  }
  const active = new Map<string, PiWorkerReturnRegistrationV1>();
  const retained = options.retained;
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
      return retained.runExclusive(key, async () => {
        const receipt = await registration.adapter.collectReceipt(registration.binding);
        if (receipt.outputDigest !== output.digest || receipt.evidence.length !== 1 || receipt.evidence[0]?.digest !== evidence.digest || receipt.evidence[0]?.mediaType !== evidence.mediaType || receipt.evidence[0]?.size !== evidence.byteLength) throw new Error("provider output does not match the bound Pi attempt receipt");
        let record = retained.load(key);
        if (record === undefined) {
          const proposal = await registration.authority.sealProposal(registration.binding, receipt);
          const workerReturn: WorkerReturnV1 = { schemaVersion: "1", binding: registration.binding, receipt, proposal, publications: [{ digest: output.digest, kind: "artifact" }, { digest: evidence.digest, kind: "evidence" }], decisionResume: { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, subscriptionId: registration.subscriptionId, resumeToken: null } };
          record = { workerReturn, phase: "prepared", receiptDigest: null, resumeToken: null, decision: null };
          if (!retained.create(key, record)) throw new Error("Pi retained worker return create conflict");
        } else assertCanonicalTuple(record, receipt, output.digest, evidence.digest);
        const delivery = await deliverWorkerReturn(record.workerReturn, registration.authority.client, new PiRetainedWorkerReturnDeliveryV1(retained, key));
        record = retained.load(key);
        if (record === undefined || record.phase !== "decision") throw new Error("Pi retained worker return did not reach a terminal decision");
        return structuredClone({ workerReturn: record.workerReturn, delivery });
      });
    },
    async state() { return { attemptKeys: registrations.map(registration => attemptKey(registration.binding)).filter(key => retained.load(key) !== undefined) }; },
    async shutdown() { active.clear(); retained.close(); },
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
