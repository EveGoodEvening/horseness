import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { createBindingGuard, deliverWorkerReturn, parseCredentialReferenceV1, parseDoctorProbeResultV1, parseInstallContributionV1, SecureWorkerAdapterV1, type CredentialReferenceV1, type InstallContributionV1, type WorkerReturnClientV1, type WorkerReturnDeliveryAuthorityV1, type WorkerReturnDeliveryStepV1 } from "@horseness/adapter-kit";
import { sealAttemptReceipt, type AttemptReceiptEnvelopeV1, type JsonValue, type ProposalEnvelopeV1 } from "@horseness/domain";
import type { AdapterCapabilitiesV1, AdapterCancelRequestV1, AdapterLaunchRequestV1, AdapterOperationResultV1, AdapterReconcileRequestV1, AdapterResumeRequestV1, BoundAdapterOperationV1, DoctorProbeResultV1, NativePackageMetadataV1, WorkerAdapterV1, WorkerReturnV1 } from "@horseness/protocol";

export const ADAPTER_OMP_PACKAGE = "@horseness/adapter-omp" as const;
export const OMP_ADAPTER_ID = "horseness-omp-v1" as const;
export const OMP_ADAPTER_VERSION = "0.1.0" as const;
export const OMP_HOST_ID = "omp" as const;
export const OMP_HOST_VERSION = "17.2.15" as const;
export const OMP_PROVIDER_ID = "omp-native-provider-v1" as const;

export const OMP_NATIVE_PACKAGE_METADATA = Object.freeze({
  schemaVersion: "1",
  adapterId: OMP_ADAPTER_ID,
  adapterVersion: OMP_ADAPTER_VERSION,
  hostId: OMP_HOST_ID,
  hostVersionRange: "=17.2.15",
  packageDigest: "sha256:f86b5f75927e7a035b22a79a0d83c12f0c8775eb479d6ff76993d035d3d2e590",
  contributions: Object.freeze([
    Object.freeze({ kind: "extension", name: "extensions/horseness-omp.mjs", digest: "sha256:2f9383b01688ae498eb39488741fed77758282f41d85a5470f30fcb26f9256b8" }),
    Object.freeze({ kind: "manifest", name: "omp-package.json", digest: "sha256:072eb99066241d74146419ebdb6fe063286d480f262504b08b831ea42b56280b" }),
  ]),
}) satisfies NativePackageMetadataV1;

export const OMP_INSTALL_CONTRIBUTIONS = Object.freeze([
  parseInstallContributionV1({ schemaVersion: "1", kind: "plugin", contributionId: "horseness-omp-extension", relativePath: "extensions/horseness-omp.mjs", contentDigest: OMP_NATIVE_PACKAGE_METADATA.contributions[0]!.digest, sourceArtifactDigest: OMP_NATIVE_PACKAGE_METADATA.packageDigest, mode: "read-only", hostScope: OMP_HOST_ID }),
  parseInstallContributionV1({ schemaVersion: "1", kind: "file", contributionId: "horseness-omp-manifest", relativePath: "omp-package.json", contentDigest: OMP_NATIVE_PACKAGE_METADATA.contributions[1]!.digest, sourceArtifactDigest: OMP_NATIVE_PACKAGE_METADATA.packageDigest, mode: "read-only", hostScope: OMP_HOST_ID }),
]) satisfies readonly InstallContributionV1[];

export interface OMPNativeAttemptV1 {
  readonly providerOperationId: string;
  readonly nativeSessionId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly outputDigest: string | null;
  readonly evidence: readonly { readonly digest: string; readonly mediaType: string; readonly size: number }[];
  readonly provenance: JsonValue;
}

export interface OMPNativeRuntimeV1 {
  launch(request: Readonly<AdapterLaunchRequestV1>): Promise<OMPNativeAttemptV1>;
  cancel(request: Readonly<AdapterCancelRequestV1>): Promise<OMPNativeAttemptV1 | null>;
  reconcile(request: Readonly<AdapterReconcileRequestV1>): Promise<OMPNativeAttemptV1 | null>;
  resume(request: Readonly<AdapterResumeRequestV1>): Promise<OMPNativeAttemptV1 | null>;
  collect(binding: Readonly<BoundAdapterOperationV1>): Promise<OMPNativeAttemptV1 | null>;
}

export interface OMPAdapterOptionsV1 {
  readonly binding: BoundAdapterOperationV1;
  readonly credential: CredentialReferenceV1;
  readonly runtime: OMPNativeRuntimeV1;
  readonly producerPrincipalId: string;
  readonly producerGrantDigest: string;
}

export interface OMPWorkerReturnAuthorityV1 {
  readonly client: WorkerReturnClientV1;
  sealProposal(binding: Readonly<BoundAdapterOperationV1>, receipt: AttemptReceiptEnvelopeV1): Promise<ProposalEnvelopeV1>;
}
export interface OMPWorkerReturnDeliveryV1 { readonly receiptDigest: string; readonly decision: string; readonly resumeToken: string | null }
export interface OMPWorkerReturnRegistrationV1 {
  readonly capabilityReference: string;
  readonly binding: BoundAdapterOperationV1;
  readonly adapter: SecureWorkerAdapterV1;
  readonly authority: OMPWorkerReturnAuthorityV1;
  readonly subscriptionId: string;
}
export type OMPRetainedDeliveryPhaseV1 = "prepared" | "publication:0" | "publication:1" | "receipt" | "proposal" | "decision-resume" | "decision";
export interface OMPRetainedDeliveryV1 {
  readonly workerReturn: WorkerReturnV1;
  readonly phase: OMPRetainedDeliveryPhaseV1;
  readonly receiptDigest: string | null;
  readonly resumeToken: string | null;
  readonly decision: string | null;
}
export interface OMPRetainedDeliveryAuthorityV1 {
  load(attemptKey: string): OMPRetainedDeliveryV1 | undefined;
  create(attemptKey: string, value: OMPRetainedDeliveryV1): boolean;
  compareAndSet(attemptKey: string, expectedPhase: OMPRetainedDeliveryPhaseV1, value: OMPRetainedDeliveryV1): boolean;
  runExclusive<T>(attemptKey: string, operation: () => Promise<T>): Promise<T>;
  close(): void;
  clear(): void;
}
export function createOMPRetainedDeliveryAuthorityV1(stateDirectory: string): OMPRetainedDeliveryAuthorityV1 {
  if (!isAbsolute(stateDirectory)) throw new Error("OMP retained state directory must be absolute");
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const stateStat = lstatSync(stateDirectory);
  if (stateStat.isSymbolicLink() || !stateStat.isDirectory() || (stateStat.mode & 0o077) !== 0) throw new Error("OMP retained state directory must be a private, non-symlink directory");
  const root = realpathSync(stateDirectory);
  const records = join(root, "records");
  const locks = join(root, "locks");
  for (const directory of [records, locks]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const details = lstatSync(directory);
    if (details.isSymbolicLink() || !details.isDirectory() || (details.mode & 0o077) !== 0 || dirname(realpathSync(directory)) !== root) throw new Error("OMP retained state path must be a private, non-symlink directory");
  }
  let closed = false;
  type LockOwner = { readonly pid: number; readonly nonce: string; readonly incarnation: string };
  const held = new Map<string, LockOwner>();
  const assertOpen = () => { if (closed) throw new Error("OMP retained delivery authority is closed"); };
  const nameFor = (key: string) => createHash("sha256").update(key).digest("hex");
  const recordPath = (key: string) => join(records, `${nameFor(key)}.json`);
  const lockPath = (key: string) => join(locks, nameFor(key));
  const assertRegularPrivateFile = (path: string) => {
    const details = lstatSync(path);
    if (details.isSymbolicLink() || !details.isFile() || (details.mode & 0o077) !== 0) throw new Error("OMP retained state record must be a private regular file");
  };
  const readRecord = (key: string): OMPRetainedDeliveryV1 | undefined => {
    assertOpen();
    const path = recordPath(key);
    try { assertRegularPrivateFile(path); return JSON.parse(readFileSync(path, "utf8")) as OMPRetainedDeliveryV1; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  };
  const syncDirectory = (path: string) => { const descriptor = openSync(path, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } };
  const publish = (key: string, value: OMPRetainedDeliveryV1) => {
    const path = recordPath(key);
    const temporary = join(records, `.${nameFor(key)}.${process.pid}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, JSON.stringify(value), "utf8"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, path);
    syncDirectory(records);
  };
  const linuxProcessIncarnation = (pid: number): string => {
    if (process.platform !== "linux") throw new Error("OMP retained delivery locks require verifiable process incarnation identity");
    let stat: string;
    try { stat = readFileSync(`/proc/${pid}/stat`, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("OMP retained delivery lock owner process is absent");
      throw new Error("OMP retained delivery lock process incarnation could not be verified", { cause: error });
    }
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 2 || stat[commandEnd + 1] !== " ") throw new Error("OMP retained delivery lock process incarnation is invalid");
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    const starttime = fields[19];
    if (starttime === undefined || !/^[0-9]+$/.test(starttime)) throw new Error("OMP retained delivery lock process incarnation is invalid");
    return starttime;
  };
  const readOwner = (path: string): LockOwner => {
    assertRegularPrivateFile(path);
    const owner = JSON.parse(readFileSync(path, "utf8")) as LockOwner;
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.nonce !== "string" || owner.nonce.length === 0 || typeof owner.incarnation !== "string" || !/^[0-9]+$/.test(owner.incarnation)) throw new Error("OMP retained delivery lock owner is invalid");
    return owner;
  };
  const ownersMatch = (left: LockOwner, right: LockOwner): boolean => left.pid === right.pid && left.nonce === right.nonce && left.incarnation === right.incarnation;
  const ownerIsCurrent = (owner: LockOwner): boolean => {
    try { return linuxProcessIncarnation(owner.pid) === owner.incarnation; }
    catch (error) { if ((error as Error).message === "OMP retained delivery lock owner process is absent") return false; throw error; }
  };
  const acquire = async (key: string): Promise<LockOwner> => {
    assertOpen();
    const path = lockPath(key);
    const owner = { pid: process.pid, nonce: randomUUID(), incarnation: linuxProcessIncarnation(process.pid) } satisfies LockOwner;
    const deadline = Date.now() + 10_000;
    while (true) {
      try {
        mkdirSync(path, { mode: 0o700 });
        writeFileSync(join(path, "owner.json"), JSON.stringify(owner), { encoding: "utf8", flag: "wx", mode: 0o600 });
        syncDirectory(path); syncDirectory(locks);
        return owner;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const details = lstatSync(path);
        if (details.isSymbolicLink() || !details.isDirectory() || (details.mode & 0o077) !== 0) throw new Error("OMP retained lock path must be a private, non-symlink directory");
        let existing: LockOwner;
        try { existing = readOwner(join(path, "owner.json")); }
        catch (ownerError) {
          if (Date.now() - statSync(path).mtimeMs > 1_000) { rmSync(path, { recursive: true }); syncDirectory(locks); continue; }
          if (Date.now() >= deadline) throw new Error("OMP retained delivery lock acquisition timed out");
          const { promise: wait, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 10); await wait; continue;
        }
        if (!ownerIsCurrent(existing)) {
          const reread = readOwner(join(path, "owner.json"));
          if (ownersMatch(reread, existing)) { rmSync(path, { recursive: true }); syncDirectory(locks); continue; }
        }
        if (Date.now() >= deadline) throw new Error("OMP retained delivery lock acquisition timed out");
        const { promise: wait, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 10); await wait;
      }
    }
  };
  const release = (key: string, expected: LockOwner) => {
    const path = lockPath(key);
    const owner = readOwner(join(path, "owner.json"));
    if (!ownersMatch(owner, expected)) throw new Error("OMP retained delivery lock ownership changed before release");
    rmSync(path, { recursive: true }); syncDirectory(locks);
  };
  return Object.freeze({
    load(key: string) { const value = readRecord(key); return value === undefined ? undefined : structuredClone(value); },
    create(key: string, value: OMPRetainedDeliveryV1) { if (held.get(key) === undefined) throw new Error("OMP retained create requires the attempt lock"); if (readRecord(key) !== undefined) return false; publish(key, structuredClone(value)); return true; },
    compareAndSet(key: string, expectedPhase: OMPRetainedDeliveryPhaseV1, value: OMPRetainedDeliveryV1) { if (held.get(key) === undefined) throw new Error("OMP retained compare-and-set requires the attempt lock"); if (readRecord(key)?.phase !== expectedPhase) return false; publish(key, structuredClone(value)); return true; },
    async runExclusive<T>(key: string, operation: () => Promise<T>) { assertOpen(); const owner = await acquire(key); held.set(key, owner); try { return await operation(); } finally { held.delete(key); release(key, owner); } },
    close() { closed = true; },
    clear() { assertOpen(); for (const directory of [records, locks]) { rmSync(directory, { recursive: true }); mkdirSync(directory, { mode: 0o700 }); } syncDirectory(root); },
  });
}
export interface OMPNativeContributionRuntimeOptionsV1 { readonly retained: OMPRetainedDeliveryAuthorityV1 }
export interface OMPNativeContributionRuntimeV1 {
  deliver(capabilityReference: string, output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }): Promise<{ workerReturn: WorkerReturnV1; delivery: OMPWorkerReturnDeliveryV1 }>;
  state(): Promise<{ readonly attemptKeys: readonly string[] }>;
  shutdown(): Promise<void>;
}
function attemptKey(binding: BoundAdapterOperationV1): string {
  return `${binding.workspaceId}:${binding.runId}:${binding.taskId}:${binding.attemptId}:${binding.generation}`;
}
const DELIVERY_PHASES: readonly OMPRetainedDeliveryPhaseV1[] = ["prepared", "publication:0", "publication:1", "receipt", "proposal", "decision-resume", "decision"];
const publicationPhase = (step: WorkerReturnDeliveryStepV1): OMPRetainedDeliveryPhaseV1 => {
  if (step !== "publication:0" && step !== "publication:1") throw new Error("OMP retained delivery received an unsupported publication phase");
  return step;
};
const completedPhase = (step: WorkerReturnDeliveryStepV1): OMPRetainedDeliveryPhaseV1 => step === "decision-subscription" ? "decision-resume" : step === "decision" ? "decision" : step === "receipt" || step === "proposal" ? step : publicationPhase(step);
const hasCompleted = (record: OMPRetainedDeliveryV1, step: WorkerReturnDeliveryStepV1): boolean => DELIVERY_PHASES.indexOf(record.phase) >= DELIVERY_PHASES.indexOf(completedPhase(step));
class OMPRetainedWorkerReturnDeliveryV1 implements WorkerReturnDeliveryAuthorityV1 {
  constructor(private readonly retained: OMPRetainedDeliveryAuthorityV1, private readonly key: string) {}
  async perform<T>(step: WorkerReturnDeliveryStepV1, operation: () => Promise<T>): Promise<T> {
    const record = this.record();
    if (hasCompleted(record, step)) return this.completed<T>(record, step);
    const result = await operation();
    const next = { ...record, phase: completedPhase(step) };
    if (step === "receipt") next.receiptDigest = result as string;
    if (step === "decision-subscription") {
      const issued = result as { resumeToken: string };
      if (issued.resumeToken.length === 0) throw new Error("OMP decision authority did not issue a resumable token");
      next.resumeToken = issued.resumeToken;
      next.workerReturn = { ...record.workerReturn, decisionResume: { ...record.workerReturn.decisionResume, resumeToken: issued.resumeToken } };
    }
    if (step === "decision") {
      const observed = result as { resumeToken: string; decision: string };
      if (record.resumeToken === null || observed.resumeToken.length === 0) throw new Error("OMP decision observation lacks a retained resume token");
      next.resumeToken = observed.resumeToken; next.decision = observed.decision;
      next.workerReturn = { ...record.workerReturn, decisionResume: { ...record.workerReturn.decisionResume, resumeToken: observed.resumeToken } };
    }
    if (!this.retained.compareAndSet(this.key, record.phase, next)) throw new Error("OMP retained delivery phase compare-and-set conflict");
    return result;
  }
  private record(): OMPRetainedDeliveryV1 {
    const record = this.retained.load(this.key);
    if (record === undefined) throw new Error("OMP retained worker return is unavailable");
    return record;
  }
  private completed<T>(record: OMPRetainedDeliveryV1, step: WorkerReturnDeliveryStepV1): T {
    if (step === "receipt") { if (record.receiptDigest === null) throw new Error("OMP retained receipt digest is unavailable"); return record.receiptDigest as T; }
    if (step === "proposal") return { proposalId: record.workerReturn.proposal.proposalId, proposalDigest: record.workerReturn.proposal.proposalDigest } as T;
    if (step === "decision-subscription") { if (record.resumeToken === null) throw new Error("OMP retained decision subscription is unavailable"); return { resumeToken: record.resumeToken } as T; }
    if (step === "decision") { if (record.resumeToken === null || record.decision === null) throw new Error("OMP retained decision is unavailable"); return { resumeToken: record.resumeToken, decision: record.decision } as T; }
    return undefined as T;
  }
}
function assertCanonicalTuple(record: OMPRetainedDeliveryV1, receipt: AttemptReceiptEnvelopeV1, outputDigest: string, evidenceDigest: string): void {
  const publications = record.workerReturn.publications;
  if (record.workerReturn.receipt.receiptDigest !== receipt.receiptDigest || publications.length !== 2 || publications[0]?.kind !== "artifact" || publications[0].digest !== outputDigest || publications[1]?.kind !== "evidence" || publications[1].digest !== evidenceDigest) throw new Error("replayed OMP worker return substituted the canonical output/evidence tuple");
}
export function createOMPNativeContributionRuntimeV1(registrations: readonly OMPWorkerReturnRegistrationV1[], options: OMPNativeContributionRuntimeOptionsV1): OMPNativeContributionRuntimeV1 {
  if (options?.retained === undefined) throw new Error("OMP native contribution runtime requires a durable retained delivery authority");
  for (const registration of registrations) {
    const client = registration.authority.client as WorkerReturnClientV1 & Record<string, unknown>;
    if (typeof client.startDecisionSubscription !== "function" || typeof client.observeDecision !== "function") throw new Error("OMP native contribution runtime requires resumable startDecisionSubscription and observeDecision authority methods");
  }
  const active = new Map<string, OMPWorkerReturnRegistrationV1>();
  const retained = options.retained;
  for (const registration of registrations) {
    const reference = parseCredentialReferenceV1({ schemaVersion: "1", kind: "host-reference", reference: registration.capabilityReference, scope: { workspaceId: registration.binding.workspaceId, adapterId: OMP_ADAPTER_ID, purpose: "omp-attempt-return" } });
    if (reference.reference !== registration.binding.attemptCapability) throw new Error("OMP attempt capability reference does not match immutable binding");
    if (active.has(reference.reference)) throw new Error("duplicate OMP attempt capability reference");
    active.set(reference.reference, registration);
  }
  return Object.freeze({
    async deliver(capabilityReference: string, output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }) {
      const registration = active.get(capabilityReference);
      if (registration === undefined) throw new Error("unknown or revoked OMP attempt capability reference");
      const key = attemptKey(registration.binding);
      return retained.runExclusive(key, async () => {
        const receipt = await registration.adapter.collectReceipt(registration.binding);
        if (receipt.outputDigest !== output.digest || receipt.evidence.length !== 1 || receipt.evidence[0]?.digest !== evidence.digest || receipt.evidence[0]?.mediaType !== evidence.mediaType || receipt.evidence[0]?.size !== evidence.byteLength) throw new Error("provider output does not match the bound OMP attempt receipt");
        let record = retained.load(key);
        if (record === undefined) {
          const proposal = await registration.authority.sealProposal(registration.binding, receipt);
          const workerReturn: WorkerReturnV1 = { schemaVersion: "1", binding: registration.binding, receipt, proposal, publications: [{ digest: output.digest, kind: "artifact" }, { digest: evidence.digest, kind: "evidence" }], decisionResume: { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, subscriptionId: registration.subscriptionId, resumeToken: null } };
          record = { workerReturn, phase: "prepared", receiptDigest: null, resumeToken: null, decision: null };
          if (!retained.create(key, record)) throw new Error("OMP retained worker return create conflict");
        } else assertCanonicalTuple(record, receipt, output.digest, evidence.digest);
        const delivery = await deliverWorkerReturn(record.workerReturn, registration.authority.client, new OMPRetainedWorkerReturnDeliveryV1(retained, key));
        record = retained.load(key);
        if (record === undefined || record.phase !== "decision") throw new Error("OMP retained worker return did not reach a terminal decision");
        return structuredClone({ workerReturn: record.workerReturn, delivery });
      });
    },
    async state() { return { attemptKeys: registrations.map(registration => attemptKey(registration.binding)).filter(key => retained.load(key) !== undefined) }; },
    async shutdown() { active.clear(); retained.close(); },
  });
}

const result = (status: AdapterOperationResultV1["status"], attempt: OMPNativeAttemptV1 | null, details: JsonValue = {}): AdapterOperationResultV1 => ({ schemaVersion: "1", status, providerOperationId: attempt?.providerOperationId ?? null, nativeSessionId: attempt?.nativeSessionId ?? null, details });

class OMPWorkerAdapterV1 implements WorkerAdapterV1 {
  readonly #guard;
  readonly #runtime: OMPNativeRuntimeV1;
  readonly #producerPrincipalId: string;
  readonly #producerGrantDigest: string;
  #attempt: OMPNativeAttemptV1 | null = null;

  constructor(options: OMPAdapterOptionsV1) {
    this.#guard = createBindingGuard(options.binding);
    const credential = parseCredentialReferenceV1(options.credential);
    if (credential.scope.workspaceId !== options.binding.workspaceId || credential.scope.adapterId !== OMP_ADAPTER_ID || credential.scope.purpose !== "omp-provider-auth") throw new Error("OMP credential reference scope does not match immutable adapter binding");
    this.#runtime = options.runtime;
    this.#producerPrincipalId = options.producerPrincipalId;
    this.#producerGrantDigest = options.producerGrantDigest;
  }

  async detectCapabilities(): Promise<AdapterCapabilitiesV1> {
    return { schemaVersion: "1", adapterId: OMP_ADAPTER_ID, providerId: OMP_PROVIDER_ID, launch: true, cancel: true, reconcile: "supported", reattach: "supported", nativeResume: "supported", contextInjection: "native", receiptCollection: true, maxContextBytes: 1_048_576, outputMediaTypes: ["text/plain", "application/json"], evidenceMediaTypes: ["application/json"] };
  }

  async launch(request: AdapterLaunchRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.launch(Object.freeze(structuredClone(request))); return result("accepted", this.#attempt, { host: OMP_HOST_ID, hostVersion: OMP_HOST_VERSION }); }
  async cancel(request: AdapterCancelRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.cancel(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async reconcile(request: AdapterReconcileRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.reconcile(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async resume(request: AdapterResumeRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.resume(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async collectReceipt(binding: BoundAdapterOperationV1): Promise<AttemptReceiptEnvelopeV1> {
    this.#guard.assert(binding);
    const attempt = await this.#runtime.collect(this.#guard.binding) ?? this.#attempt;
    if (attempt === null) throw new Error("OMP native attempt receipt is unavailable");
    return sealAttemptReceipt({ schemaVersion: "1", workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, attemptContextBindingDigest: binding.attemptContextBindingDigest, contextManifestCoreDigest: binding.contextManifestCoreDigest, forkPinDigest: binding.forkPinDigest, providerId: OMP_PROVIDER_ID, providerOperationId: attempt.providerOperationId, providerIdempotencyKeyDigest: binding.providerIdempotencyKeyDigest, producerPrincipalId: this.#producerPrincipalId, producerGrantDigest: this.#producerGrantDigest, adapterId: OMP_ADAPTER_ID, adapterVersion: OMP_ADAPTER_VERSION, hostId: OMP_HOST_ID, hostVersion: OMP_HOST_VERSION, outcome: attempt.outcome, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, outputDigest: attempt.outputDigest, evidence: attempt.evidence, provenance: attempt.provenance, nonce: `${binding.attemptId}:${binding.generation}:${attempt.providerOperationId}` });
  }
}

export function createOMPAdapterV1(options: OMPAdapterOptionsV1): SecureWorkerAdapterV1 { return new SecureWorkerAdapterV1(options.binding, new OMPWorkerAdapterV1(options)); }
export function ompDoctorV1(input: { readonly nativePackageVersion: string | null; readonly loaderDigest: string | null; readonly contributionDigests: readonly string[] }): DoctorProbeResultV1 {
  const expected = OMP_NATIVE_PACKAGE_METADATA.contributions.map(item => item.digest);
  return parseDoctorProbeResultV1({ schemaVersion: "1", checks: [
    { code: "OMP_NATIVE_VERSION", status: input.nativePackageVersion === OMP_HOST_VERSION ? "ok" : "error", evidenceDigest: input.nativePackageVersion === null ? null : `version:${input.nativePackageVersion}` },
    { code: "OMP_EXTENSION_LOADER", status: input.loaderDigest === "sha256:c0076ad052d435ee1075abfa0682e83ad4a075a1415c720bbbdf71d9affcc48f" ? "ok" : "error", evidenceDigest: input.loaderDigest },
    { code: "OMP_CONTRIBUTIONS", status: expected.every(digest => input.contributionDigests.includes(digest)) && input.contributionDigests.length === expected.length ? "ok" : "error", evidenceDigest: OMP_NATIVE_PACKAGE_METADATA.packageDigest },
  ], restartRequired: false });
}
