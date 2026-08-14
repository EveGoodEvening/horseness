import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { createBindingGuard, deliverWorkerReturn, parseCredentialReferenceV1, parseDoctorProbeResultV1, parseInstallContributionV1, SecureWorkerAdapterV1, type CredentialReferenceV1, type InstallContributionV1, type WorkerReturnClientV1, type WorkerReturnDeliveryAuthorityV1, type WorkerReturnDeliveryStepV1 } from "@horseness/adapter-kit";
import { sealAttemptReceipt, type AttemptReceiptEnvelopeV1, type JsonValue, type ProposalEnvelopeV1 } from "@horseness/domain";
import type { AdapterCapabilitiesV1, AdapterCancelRequestV1, AdapterLaunchRequestV1, AdapterOperationResultV1, AdapterReconcileRequestV1, AdapterResumeRequestV1, BoundAdapterOperationV1, DoctorProbeResultV1, NativePackageMetadataV1, WorkerAdapterV1, WorkerReturnV1 } from "@horseness/protocol";

export const ADAPTER_CLAUDE_PACKAGE = "@horseness/adapter-claude" as const;
export const CLAUDE_ADAPTER_ID = "horseness-claude-v1" as const;
export const CLAUDE_ADAPTER_VERSION = "0.1.0" as const;
export const CLAUDE_HOST_ID = "claude" as const;
export const CLAUDE_HOST_VERSION = "2.1.228" as const;
export const CLAUDE_PROVIDER_ID = "claude-native-provider-v1" as const;

export const CLAUDE_NATIVE_PACKAGE_METADATA = Object.freeze({
  schemaVersion: "1",
  adapterId: CLAUDE_ADAPTER_ID,
  adapterVersion: CLAUDE_ADAPTER_VERSION,
  hostId: CLAUDE_HOST_ID,
  hostVersionRange: "=2.1.228",
  packageDigest: "sha256:2b6dafdfd8c722e0e09d06508f4e0c498b03bf72926a03d9496951a48dd65cfa",
  contributions: Object.freeze([
    Object.freeze({ kind: "manifest", name: "plugin/.claude-plugin/plugin.json", digest: "sha256:53ee18d5eef969cdf498841eca485b576a2edccdb226a37467cf540eab2d4e1a" }),
    Object.freeze({ kind: "manifest", name: "plugin/.mcp.json", digest: "sha256:c869a35a3efc77e3c9219d6fffc102cecfc2873343b1feee35b24f8806c53ad8" }),
    Object.freeze({ kind: "hook", name: "plugin/hooks/hooks.json", digest: "sha256:866e696b6c09b5e35f1bdf37684b4e91c5a8e63440b09c02ef4d2d69fb965b11" }),
    Object.freeze({ kind: "hook", name: "plugin/hooks/session-start.mjs", digest: "sha256:2200b5b19dd731022d9f1ee5191b9798b8f0a5a196149664d600c13d9b11c8fa" }),
    Object.freeze({ kind: "command", name: "plugin/commands/horseness-worker-return.md", digest: "sha256:90f5acb04bb6f63a998b9a56fa7d32db368df2f7f723618bc52a04599ddc9d25" }),
    Object.freeze({ kind: "agent", name: "plugin/agents/horseness-worker.md", digest: "sha256:9d77cb92c9a590fee55116ae630a29f3fe20904985bed578af2aecff9fb2ed60" }),
    Object.freeze({ kind: "skill", name: "plugin/skills/horseness-worker/SKILL.md", digest: "sha256:ce7e845ade17d5db50b3b5de058885dc3533aba2d58dc8279a881d9dcd1fa432" }),
    Object.freeze({ kind: "mcp-server", name: "plugin/servers/horseness-worker.mjs", digest: "sha256:c0996ec903fe0da27686166ccb4a9203cac91a35179413a9cda83009dc10a314" }),
  ]),
}) satisfies NativePackageMetadataV1;

export const CLAUDE_INSTALL_CONTRIBUTIONS = Object.freeze(CLAUDE_NATIVE_PACKAGE_METADATA.contributions.map((item, index) =>
  parseInstallContributionV1({ schemaVersion: "1", kind: index === 0 ? "plugin" : "file", contributionId: `horseness-claude-${index}`, relativePath: item.name, contentDigest: item.digest, sourceArtifactDigest: CLAUDE_NATIVE_PACKAGE_METADATA.packageDigest, mode: "read-only", hostScope: CLAUDE_HOST_ID }),
)) satisfies readonly InstallContributionV1[];

export interface ClaudeNativeAttemptV1 {
  readonly providerOperationId: string;
  readonly nativeSessionId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly outputDigest: string | null;
  readonly evidence: readonly { readonly digest: string; readonly mediaType: string; readonly size: number }[];
  readonly provenance: JsonValue;
}

export interface ClaudeNativeRuntimeV1 {
  launch(request: Readonly<AdapterLaunchRequestV1>): Promise<ClaudeNativeAttemptV1>;
  cancel(request: Readonly<AdapterCancelRequestV1>): Promise<ClaudeNativeAttemptV1 | null>;
  reconcile(request: Readonly<AdapterReconcileRequestV1>): Promise<ClaudeNativeAttemptV1 | null>;
  resume(request: Readonly<AdapterResumeRequestV1>): Promise<ClaudeNativeAttemptV1 | null>;
  collect(binding: Readonly<BoundAdapterOperationV1>): Promise<ClaudeNativeAttemptV1 | null>;
}

export interface ClaudeAdapterOptionsV1 {
  readonly binding: BoundAdapterOperationV1;
  readonly credential: CredentialReferenceV1;
  readonly runtime: ClaudeNativeRuntimeV1;
  readonly producerPrincipalId: string;
  readonly producerGrantDigest: string;
}

export interface ClaudeWorkerReturnAuthorityV1 {
  readonly client: WorkerReturnClientV1;
  sealProposal(binding: Readonly<BoundAdapterOperationV1>, receipt: AttemptReceiptEnvelopeV1): Promise<ProposalEnvelopeV1>;
}
export interface ClaudeWorkerReturnDeliveryV1 { readonly receiptDigest: string; readonly decision: string; readonly resumeToken: string | null }
export interface ClaudeWorkerReturnRegistrationV1 {
  readonly capabilityReference: string;
  readonly binding: BoundAdapterOperationV1;
  readonly adapter: SecureWorkerAdapterV1;
  readonly authority: ClaudeWorkerReturnAuthorityV1;
  readonly subscriptionId: string;
}
export type ClaudeRetainedDeliveryPhaseV1 = "prepared" | "publication:0" | "publication:1" | "receipt" | "proposal" | "decision-resume" | "decision";
export interface ClaudeRetainedDeliveryV1 {
  readonly workerReturn: WorkerReturnV1;
  readonly phase: ClaudeRetainedDeliveryPhaseV1;
  readonly receiptDigest: string | null;
  readonly resumeToken: string | null;
  readonly decision: string | null;
}
export interface ClaudeRetainedDeliveryAuthorityV1 {
  load(attemptKey: string): ClaudeRetainedDeliveryV1 | undefined;
  create(attemptKey: string, value: ClaudeRetainedDeliveryV1): boolean;
  compareAndSet(attemptKey: string, expectedPhase: ClaudeRetainedDeliveryPhaseV1, value: ClaudeRetainedDeliveryV1): boolean;
  runExclusive<T>(attemptKey: string, operation: () => Promise<T>): Promise<T>;
  close(): void;
  clear(): void;
}
export function createClaudeRetainedDeliveryAuthorityV1(stateDirectory: string): ClaudeRetainedDeliveryAuthorityV1 {
  if (!isAbsolute(stateDirectory)) throw new Error("Claude retained state directory must be absolute");
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const stateStat = lstatSync(stateDirectory);
  if (stateStat.isSymbolicLink() || !stateStat.isDirectory() || (stateStat.mode & 0o077) !== 0) throw new Error("Claude retained state directory must be a private, non-symlink directory");
  const root = realpathSync(stateDirectory);
  const records = join(root, "records");
  const locks = join(root, "locks");
  for (const directory of [records, locks]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const details = lstatSync(directory);
    if (details.isSymbolicLink() || !details.isDirectory() || (details.mode & 0o077) !== 0 || dirname(realpathSync(directory)) !== root) throw new Error("Claude retained state path must be a private, non-symlink directory");
  }
  let closed = false;
  type LockOwner = { readonly pid: number; readonly nonce: string; readonly incarnation: string };
  const held = new Map<string, LockOwner>();
  const assertOpen = () => { if (closed) throw new Error("Claude retained delivery authority is closed"); };
  const nameFor = (key: string) => createHash("sha256").update(key).digest("hex");
  const recordPath = (key: string) => join(records, `${nameFor(key)}.json`);
  const lockPath = (key: string) => join(locks, nameFor(key));
  const assertRegularPrivateFile = (path: string) => {
    const details = lstatSync(path);
    if (details.isSymbolicLink() || !details.isFile() || (details.mode & 0o077) !== 0) throw new Error("Claude retained state record must be a private regular file");
  };
  const readRecord = (key: string): ClaudeRetainedDeliveryV1 | undefined => {
    assertOpen();
    const path = recordPath(key);
    try { assertRegularPrivateFile(path); return JSON.parse(readFileSync(path, "utf8")) as ClaudeRetainedDeliveryV1; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  };
  const syncDirectory = (path: string) => { const descriptor = openSync(path, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } };
  const publish = (key: string, value: ClaudeRetainedDeliveryV1) => {
    const path = recordPath(key);
    const temporary = join(records, `.${nameFor(key)}.${process.pid}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, JSON.stringify(value), "utf8"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, path);
    syncDirectory(records);
  };
  const linuxProcessIncarnation = (pid: number): string => {
    if (process.platform !== "linux") throw new Error("Claude retained delivery locks require verifiable process incarnation identity");
    let stat: string;
    try { stat = readFileSync(`/proc/${pid}/stat`, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Claude retained delivery lock owner process is absent");
      throw new Error("Claude retained delivery lock process incarnation could not be verified", { cause: error });
    }
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 2 || stat[commandEnd + 1] !== " ") throw new Error("Claude retained delivery lock process incarnation is invalid");
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    const starttime = fields[19];
    if (starttime === undefined || !/^[0-9]+$/.test(starttime)) throw new Error("Claude retained delivery lock process incarnation is invalid");
    return starttime;
  };
  const readOwner = (path: string): LockOwner => {
    assertRegularPrivateFile(path);
    const owner = JSON.parse(readFileSync(path, "utf8")) as LockOwner;
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.nonce !== "string" || owner.nonce.length === 0 || typeof owner.incarnation !== "string" || !/^[0-9]+$/.test(owner.incarnation)) throw new Error("Claude retained delivery lock owner is invalid");
    return owner;
  };
  const ownersMatch = (left: LockOwner, right: LockOwner): boolean => left.pid === right.pid && left.nonce === right.nonce && left.incarnation === right.incarnation;
  const ownerIsCurrent = (owner: LockOwner): boolean => {
    try { return linuxProcessIncarnation(owner.pid) === owner.incarnation; }
    catch (error) { if ((error as Error).message === "Claude retained delivery lock owner process is absent") return false; throw error; }
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
        if (details.isSymbolicLink() || !details.isDirectory() || (details.mode & 0o077) !== 0) throw new Error("Claude retained lock path must be a private, non-symlink directory");
        let existing: LockOwner;
        try { existing = readOwner(join(path, "owner.json")); }
        catch (ownerError) {
          if (Date.now() - statSync(path).mtimeMs > 1_000) { rmSync(path, { recursive: true }); syncDirectory(locks); continue; }
          if (Date.now() >= deadline) throw new Error("Claude retained delivery lock acquisition timed out");
          const { promise: wait, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 10); await wait; continue;
        }
        if (!ownerIsCurrent(existing)) {
          const reread = readOwner(join(path, "owner.json"));
          if (ownersMatch(reread, existing)) { rmSync(path, { recursive: true }); syncDirectory(locks); continue; }
        }
        if (Date.now() >= deadline) throw new Error("Claude retained delivery lock acquisition timed out");
        const { promise: wait, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 10); await wait;
      }
    }
  };
  const release = (key: string, expected: LockOwner) => {
    const path = lockPath(key);
    const owner = readOwner(join(path, "owner.json"));
    if (!ownersMatch(owner, expected)) throw new Error("Claude retained delivery lock ownership changed before release");
    rmSync(path, { recursive: true }); syncDirectory(locks);
  };
  return Object.freeze({
    load(key: string) { const value = readRecord(key); return value === undefined ? undefined : structuredClone(value); },
    create(key: string, value: ClaudeRetainedDeliveryV1) { if (held.get(key) === undefined) throw new Error("Claude retained create requires the attempt lock"); if (readRecord(key) !== undefined) return false; publish(key, structuredClone(value)); return true; },
    compareAndSet(key: string, expectedPhase: ClaudeRetainedDeliveryPhaseV1, value: ClaudeRetainedDeliveryV1) { if (held.get(key) === undefined) throw new Error("Claude retained compare-and-set requires the attempt lock"); if (readRecord(key)?.phase !== expectedPhase) return false; publish(key, structuredClone(value)); return true; },
    async runExclusive<T>(key: string, operation: () => Promise<T>) { assertOpen(); const owner = await acquire(key); held.set(key, owner); try { return await operation(); } finally { held.delete(key); release(key, owner); } },
    close() { closed = true; },
    clear() { assertOpen(); for (const directory of [records, locks]) { rmSync(directory, { recursive: true }); mkdirSync(directory, { mode: 0o700 }); } syncDirectory(root); },
  });
}
export interface ClaudeNativeAttemptContextV1 {
  readonly attemptCapabilityReference: string;
  readonly binding: BoundAdapterOperationV1;
  readonly renderedContext: string;
  readonly renderedContextDigest: string;
}
export interface ClaudeNativeContributionRuntimeOptionsV1 {
  readonly retained: ClaudeRetainedDeliveryAuthorityV1;
  readonly attemptContexts?: readonly ClaudeNativeAttemptContextV1[];
  readonly initialAttemptCapabilityReference?: string;
}
export interface ClaudeNativeBranchRegistrationV1 {
  readonly entryId: string;
  readonly previousSessionFile: string;
  readonly attemptCapabilityReference: string;
}
export interface ClaudeNativeContributionRuntimeV1 {
  deliver(capabilityReference: string, output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }): Promise<{ workerReturn: WorkerReturnV1; delivery: ClaudeWorkerReturnDeliveryV1 }>;
  state(): Promise<{ readonly attemptKeys: readonly string[] }>;
  contextForAttempt(): Promise<ClaudeNativeAttemptContextV1 | null>;
  registerBranch(registration: ClaudeNativeBranchRegistrationV1): void;
  beforeBranch(entryId: string): Promise<void>;
  activateSession(previousSessionFile: string | null): Promise<{ readonly forkPinDigest: string } | null>;
  registerRevoker(revoker: () => Promise<void>): void;
  revoke(): Promise<void>;
  sessionShutdown(): Promise<void>;
  shutdown(): Promise<void>;
}
function attemptKey(binding: BoundAdapterOperationV1): string {
  return `${binding.workspaceId}:${binding.runId}:${binding.taskId}:${binding.attemptId}:${binding.generation}`;
}
const DELIVERY_PHASES: readonly ClaudeRetainedDeliveryPhaseV1[] = ["prepared", "publication:0", "publication:1", "receipt", "proposal", "decision-resume", "decision"];
const publicationPhase = (step: WorkerReturnDeliveryStepV1): ClaudeRetainedDeliveryPhaseV1 => {
  if (step !== "publication:0" && step !== "publication:1") throw new Error("Claude retained delivery received an unsupported publication phase");
  return step;
};
const completedPhase = (step: WorkerReturnDeliveryStepV1): ClaudeRetainedDeliveryPhaseV1 => step === "decision-subscription" ? "decision-resume" : step === "decision" ? "decision" : step === "receipt" || step === "proposal" ? step : publicationPhase(step);
const hasCompleted = (record: ClaudeRetainedDeliveryV1, step: WorkerReturnDeliveryStepV1): boolean => DELIVERY_PHASES.indexOf(record.phase) >= DELIVERY_PHASES.indexOf(completedPhase(step));
class ClaudeRetainedWorkerReturnDeliveryV1 implements WorkerReturnDeliveryAuthorityV1 {
  constructor(private readonly retained: ClaudeRetainedDeliveryAuthorityV1, private readonly key: string) {}
  async perform<T>(step: WorkerReturnDeliveryStepV1, operation: () => Promise<T>): Promise<T> {
    const record = this.record();
    if (hasCompleted(record, step)) return this.completed<T>(record, step);
    const result = await operation();
    const next = { ...record, phase: completedPhase(step) };
    if (step === "receipt") next.receiptDigest = result as string;
    if (step === "decision-subscription") {
      const issued = result as { resumeToken: string };
      if (issued.resumeToken.length === 0) throw new Error("Claude decision authority did not issue a resumable token");
      next.resumeToken = issued.resumeToken;
      next.workerReturn = { ...record.workerReturn, decisionResume: { ...record.workerReturn.decisionResume, resumeToken: issued.resumeToken } };
    }
    if (step === "decision") {
      const observed = result as { resumeToken: string; decision: string };
      if (record.resumeToken === null || observed.resumeToken.length === 0) throw new Error("Claude decision observation lacks a retained resume token");
      next.resumeToken = observed.resumeToken; next.decision = observed.decision;
      next.workerReturn = { ...record.workerReturn, decisionResume: { ...record.workerReturn.decisionResume, resumeToken: observed.resumeToken } };
    }
    if (!this.retained.compareAndSet(this.key, record.phase, next)) throw new Error("Claude retained delivery phase compare-and-set conflict");
    return result;
  }
  private record(): ClaudeRetainedDeliveryV1 {
    const record = this.retained.load(this.key);
    if (record === undefined) throw new Error("Claude retained worker return is unavailable");
    return record;
  }
  private completed<T>(record: ClaudeRetainedDeliveryV1, step: WorkerReturnDeliveryStepV1): T {
    if (step === "receipt") { if (record.receiptDigest === null) throw new Error("Claude retained receipt digest is unavailable"); return record.receiptDigest as T; }
    if (step === "proposal") return { proposalId: record.workerReturn.proposal.proposalId, proposalDigest: record.workerReturn.proposal.proposalDigest } as T;
    if (step === "decision-subscription") { if (record.resumeToken === null) throw new Error("Claude retained decision subscription is unavailable"); return { resumeToken: record.resumeToken } as T; }
    if (step === "decision") { if (record.resumeToken === null || record.decision === null) throw new Error("Claude retained decision is unavailable"); return { resumeToken: record.resumeToken, decision: record.decision } as T; }
    return undefined as T;
  }
}
function assertCanonicalTuple(record: ClaudeRetainedDeliveryV1, receipt: AttemptReceiptEnvelopeV1, outputDigest: string, evidenceDigest: string): void {
  const publications = record.workerReturn.publications;
  if (record.workerReturn.receipt.receiptDigest !== receipt.receiptDigest || publications.length !== 2 || publications[0]?.kind !== "artifact" || publications[0].digest !== outputDigest || publications[1]?.kind !== "evidence" || publications[1].digest !== evidenceDigest) throw new Error("replayed Claude worker return substituted the canonical output/evidence tuple");
}
export function createClaudeNativeContributionRuntimeV1(registrations: readonly ClaudeWorkerReturnRegistrationV1[], options: ClaudeNativeContributionRuntimeOptionsV1): ClaudeNativeContributionRuntimeV1 {
  if (options?.retained === undefined) throw new Error("Claude native contribution runtime requires a durable retained delivery authority");
  for (const registration of registrations) {
    const client = registration.authority.client as WorkerReturnClientV1 & Record<string, unknown>;
    if (typeof client.startDecisionSubscription !== "function" || typeof client.observeDecision !== "function") throw new Error("Claude native contribution runtime requires resumable startDecisionSubscription and observeDecision authority methods");
  }
  const active = new Map<string, ClaudeWorkerReturnRegistrationV1>();
  const retained = options.retained;
  const contexts = new Map((options.attemptContexts ?? []).map(context => [context.attemptCapabilityReference, structuredClone(context)]));
  const branchesByEntry = new Map<string, ClaudeNativeBranchRegistrationV1>();
  const branchesBySession = new Map<string, ClaudeNativeBranchRegistrationV1>();
  let selectedCapability = options.initialAttemptCapabilityReference ?? registrations[0]?.capabilityReference ?? null;
  let pendingBranch: ClaudeNativeBranchRegistrationV1 | null = null;
  let revoker: (() => Promise<void>) | null = null;
  let revoked = false;
  for (const registration of registrations) {
    const reference = parseCredentialReferenceV1({ schemaVersion: "1", kind: "host-reference", reference: registration.capabilityReference, scope: { workspaceId: registration.binding.workspaceId, adapterId: CLAUDE_ADAPTER_ID, purpose: "claude-attempt-return" } });
    if (reference.reference !== registration.binding.attemptCapability) throw new Error("Claude attempt capability reference does not match immutable binding");
    if (active.has(reference.reference)) throw new Error("duplicate Claude attempt capability reference");
    active.set(reference.reference, registration);
  }
  return Object.freeze({
    async deliver(capabilityReference: string, output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }) {
      const registration = active.get(capabilityReference);
      if (registration === undefined) throw new Error("unknown or revoked Claude attempt capability reference");
      const key = attemptKey(registration.binding);
      return retained.runExclusive(key, async () => {
        const receipt = await registration.adapter.collectReceipt(registration.binding);
        if (receipt.outputDigest !== output.digest) throw new Error("Claude provider output digest does not match the bound attempt receipt");
        if (receipt.evidence.length !== 1 || receipt.evidence[0]?.digest !== evidence.digest) throw new Error("Claude provider evidence digest does not match the bound attempt receipt");
        if (receipt.evidence[0]?.mediaType !== evidence.mediaType || receipt.evidence[0]?.size !== evidence.byteLength) throw new Error("Claude provider evidence descriptor does not match the bound attempt receipt");
        let record = retained.load(key);
        if (record === undefined) {
          const proposal = await registration.authority.sealProposal(registration.binding, receipt);
          const workerReturn: WorkerReturnV1 = { schemaVersion: "1", binding: registration.binding, receipt, proposal, publications: [{ digest: output.digest, kind: "artifact" }, { digest: evidence.digest, kind: "evidence" }], decisionResume: { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, subscriptionId: registration.subscriptionId, resumeToken: null } };
          record = { workerReturn, phase: "prepared", receiptDigest: null, resumeToken: null, decision: null };
          if (!retained.create(key, record)) throw new Error("Claude retained worker return create conflict");
        } else assertCanonicalTuple(record, receipt, output.digest, evidence.digest);
        const delivery = await deliverWorkerReturn(record.workerReturn, registration.authority.client, new ClaudeRetainedWorkerReturnDeliveryV1(retained, key));
        record = retained.load(key);
        if (record === undefined || record.phase !== "decision") throw new Error("Claude retained worker return did not reach a terminal decision");
        return structuredClone({ workerReturn: record.workerReturn, delivery });
      });
    },
    async state() { return { attemptKeys: registrations.map(registration => attemptKey(registration.binding)).filter(key => retained.load(key) !== undefined) }; },
    async contextForAttempt() { if (revoked || selectedCapability === null) return null; const context = contexts.get(selectedCapability); return context === undefined ? null : structuredClone(context); },
    registerBranch(registration: ClaudeNativeBranchRegistrationV1) {
      if (revoked) throw new Error("Claude native contribution runtime is revoked");
      const { entryId, previousSessionFile, attemptCapabilityReference } = registration;
      if (entryId.length === 0 || previousSessionFile.length === 0) throw new Error("invalid Claude branch registration identifiers");
      if (!active.has(attemptCapabilityReference) || !contexts.has(attemptCapabilityReference)) throw new Error("Claude branch registration references an unknown attempt capability");
      const existingEntry = branchesByEntry.get(entryId);
      const existingSession = branchesBySession.get(previousSessionFile);
      if (existingEntry !== undefined || existingSession !== undefined) {
        const sameEntry = existingEntry?.previousSessionFile === previousSessionFile && existingEntry.attemptCapabilityReference === attemptCapabilityReference;
        const sameSession = existingSession?.entryId === entryId && existingSession.attemptCapabilityReference === attemptCapabilityReference;
        if (!sameEntry || !sameSession) throw new Error("Claude branch registration cannot overwrite or substitute an immutable mapping");
        return;
      }
      const immutable = Object.freeze({ entryId, previousSessionFile, attemptCapabilityReference });
      branchesByEntry.set(entryId, immutable);
      branchesBySession.set(previousSessionFile, immutable);
    },
    async beforeBranch(entryId: string) {
      if (revoked || typeof entryId !== "string" || entryId.length === 0) throw new Error("invalid Claude branch entry id");
      const branch = branchesByEntry.get(entryId);
      if (branch === undefined) throw new Error("unknown Claude branch entry id");
      pendingBranch = branch;
    },
    async activateSession(previousSessionFile: string | null) {
      if (revoked) return null;
      if (previousSessionFile !== null) {
        const pending = pendingBranch;
        pendingBranch = null;
        if (pending === null) throw new Error("Claude branch activation was not preceded by session_before_branch");
        const mapped = branchesBySession.get(previousSessionFile);
        if (mapped === undefined || mapped !== pending) throw new Error("Claude branch activation does not match the pending immutable mapping");
        selectedCapability = mapped.attemptCapabilityReference;
      }
      const context = selectedCapability === null ? undefined : contexts.get(selectedCapability);
      return context === undefined ? null : { forkPinDigest: context.binding.forkPinDigest };
    },
    registerRevoker(next: () => Promise<void>) { if (revoker !== null) throw new Error("Claude native grant revoker is already registered"); revoker = next; },
    async revoke() { if (revoked) return; revoked = true; active.clear(); contexts.clear(); branchesByEntry.clear(); branchesBySession.clear(); selectedCapability = null; pendingBranch = null; const current = revoker; revoker = null; if (current !== null) await current(); else retained.close(); },
    async sessionShutdown() { pendingBranch = null; },
    async shutdown() { active.clear(); contexts.clear(); branchesByEntry.clear(); branchesBySession.clear(); selectedCapability = null; pendingBranch = null; retained.close(); },
  });
}

const result = (status: AdapterOperationResultV1["status"], attempt: ClaudeNativeAttemptV1 | null, details: JsonValue = {}): AdapterOperationResultV1 => ({ schemaVersion: "1", status, providerOperationId: attempt?.providerOperationId ?? null, nativeSessionId: attempt?.nativeSessionId ?? null, details });

class ClaudeWorkerAdapterV1 implements WorkerAdapterV1 {
  readonly #guard;
  readonly #runtime: ClaudeNativeRuntimeV1;
  readonly #producerPrincipalId: string;
  readonly #producerGrantDigest: string;
  #attempt: ClaudeNativeAttemptV1 | null = null;

  constructor(options: ClaudeAdapterOptionsV1) {
    this.#guard = createBindingGuard(options.binding);
    const credential = parseCredentialReferenceV1(options.credential);
    if (credential.scope.workspaceId !== options.binding.workspaceId || credential.scope.adapterId !== CLAUDE_ADAPTER_ID || credential.scope.purpose !== "horseness-attempt-grant") throw new Error("Claude Horseness grant reference scope does not match immutable adapter binding");
    this.#runtime = options.runtime;
    this.#producerPrincipalId = options.producerPrincipalId;
    this.#producerGrantDigest = options.producerGrantDigest;
  }

  async detectCapabilities(): Promise<AdapterCapabilitiesV1> {
    return { schemaVersion: "1", adapterId: CLAUDE_ADAPTER_ID, providerId: CLAUDE_PROVIDER_ID, launch: true, cancel: true, reconcile: "supported", reattach: "supported", nativeResume: "supported", contextInjection: "native", receiptCollection: true, maxContextBytes: 1_048_576, outputMediaTypes: ["text/plain", "application/json"], evidenceMediaTypes: ["application/json"] };
  }

  async launch(request: AdapterLaunchRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.launch(Object.freeze(structuredClone(request))); return result("accepted", this.#attempt, { host: CLAUDE_HOST_ID, hostVersion: CLAUDE_HOST_VERSION }); }
  async cancel(request: AdapterCancelRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.cancel(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async reconcile(request: AdapterReconcileRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.reconcile(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async resume(request: AdapterResumeRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.resume(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async collectReceipt(binding: BoundAdapterOperationV1): Promise<AttemptReceiptEnvelopeV1> {
    this.#guard.assert(binding);
    const attempt = await this.#runtime.collect(this.#guard.binding) ?? this.#attempt;
    if (attempt === null) throw new Error("Claude native attempt receipt is unavailable");
    return sealAttemptReceipt({ schemaVersion: "1", workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, attemptContextBindingDigest: binding.attemptContextBindingDigest, contextManifestCoreDigest: binding.contextManifestCoreDigest, forkPinDigest: binding.forkPinDigest, providerId: CLAUDE_PROVIDER_ID, providerOperationId: attempt.providerOperationId, providerIdempotencyKeyDigest: binding.providerIdempotencyKeyDigest, producerPrincipalId: this.#producerPrincipalId, producerGrantDigest: this.#producerGrantDigest, adapterId: CLAUDE_ADAPTER_ID, adapterVersion: CLAUDE_ADAPTER_VERSION, hostId: CLAUDE_HOST_ID, hostVersion: CLAUDE_HOST_VERSION, outcome: attempt.outcome, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, outputDigest: attempt.outputDigest, evidence: attempt.evidence, provenance: attempt.provenance, nonce: `${binding.attemptId}:${binding.generation}:${attempt.providerOperationId}` });
  }
}

export function createClaudeAdapterV1(options: ClaudeAdapterOptionsV1): SecureWorkerAdapterV1 { return new SecureWorkerAdapterV1(options.binding, new ClaudeWorkerAdapterV1(options)); }
export function claudeDoctorV1(input: { readonly nativePackageVersion: string | null; readonly loaderDigest: string | null; readonly contributionDigests: readonly string[] }): DoctorProbeResultV1 {
  const expected = CLAUDE_NATIVE_PACKAGE_METADATA.contributions.map(item => item.digest);
  return parseDoctorProbeResultV1({ schemaVersion: "1", checks: [
    { code: "CLAUDE_NATIVE_VERSION", status: input.nativePackageVersion === CLAUDE_HOST_VERSION ? "ok" : "error", evidenceDigest: input.nativePackageVersion === null ? null : `version:${input.nativePackageVersion}` },
    { code: "Claude_EXTENSION_LOADER", status: input.loaderDigest === "sha256:d535985e6941a3eb00179ccd7f52ceb0c6623a0305a518ebc4e6514f84a94c99" ? "ok" : "error", evidenceDigest: input.loaderDigest },
    { code: "Claude_CONTRIBUTIONS", status: expected.every(digest => input.contributionDigests.includes(digest)) && input.contributionDigests.length === expected.length ? "ok" : "error", evidenceDigest: CLAUDE_NATIVE_PACKAGE_METADATA.packageDigest },
  ], restartRequired: false });
}
