import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { createBindingGuard, deliverWorkerReturn, parseCredentialReferenceV1, parseDoctorProbeResultV1, parseInstallContributionV1, SecureWorkerAdapterV1, type CredentialReferenceV1, type InstallContributionV1, type WorkerReturnClientV1, type WorkerReturnDeliveryAuthorityV1, type WorkerReturnDeliveryStepV1 } from "@horseness/adapter-kit";
import { sealAttemptReceipt, type AttemptReceiptEnvelopeV1, type JsonValue, type ProposalEnvelopeV1 } from "@horseness/domain";
import type { AdapterCapabilitiesV1, AdapterCancelRequestV1, AdapterLaunchRequestV1, AdapterOperationResultV1, AdapterReconcileRequestV1, AdapterResumeRequestV1, BoundAdapterOperationV1, DoctorProbeResultV1, NativePackageMetadataV1, WorkerAdapterV1, WorkerReturnV1 } from "@horseness/protocol";

export const ADAPTER_CODEX_PACKAGE = "@horseness/adapter-codex" as const;
export const CODEX_ADAPTER_ID = "horseness-codex-v1" as const;
export const CODEX_ADAPTER_VERSION = "0.1.0" as const;
export const CODEX_HOST_ID = "codex" as const;
export const CODEX_HOST_VERSION = "0.144.1-linux-x64" as const;
export const CODEX_PROVIDER_ID = "codex-native-provider-v1" as const;

export type CodexNativeContributionDigestV1 = { readonly kind: string; readonly name: string; readonly digest: string };
export function codexNativePackageDigestV1(contributions: readonly CodexNativeContributionDigestV1[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({ schemaVersion: "CodexNativePackageDigestV1", contributions })).digest("hex")}`;
}
const CODEX_NATIVE_CONTRIBUTIONS = Object.freeze([
  Object.freeze({ kind: "manifest", name: "plugin/.codex-plugin/plugin.json", digest: "sha256:415074c1915211d7fff075c9b9766f103f0d333109372c6951feb0165ee623bc" }),
  Object.freeze({ kind: "manifest", name: "plugin/.mcp.json", digest: "sha256:bb7e4e5e1b5308c9a2a707b6da146c7b1ab31b497e6a7857fe10c90e75c8a4d2" }),
  Object.freeze({ kind: "context", name: "plugin/AGENTS.md", digest: "sha256:cd540129304ac027174d9afefbf1903cc97a78b89b34036bfb2d15328fd0aad2" }),
  Object.freeze({ kind: "skill", name: "plugin/skills/horseness-worker/SKILL.md", digest: "sha256:eb743ae05ccb2616264680ce20dd74d0293eac2d1b6bf4beb4f60e2f421d083e" }),
  Object.freeze({ kind: "mcp-server", name: "plugin/servers/horseness-worker.mjs", digest: "sha256:71e11ebf8ea39956998957ef3ddb66af4d061c89396283c226b7ee2385b18e33" }),
]) satisfies readonly CodexNativeContributionDigestV1[];
function observedCodexContribution(item: { readonly name: string; readonly digest: string }): CodexNativeContributionDigestV1 | null {
  const expected = CODEX_NATIVE_CONTRIBUTIONS.find(contribution => contribution.name === item.name);
  return expected === undefined ? null : { kind: expected.kind, name: item.name, digest: item.digest };
}
export const CODEX_NATIVE_PACKAGE_METADATA = Object.freeze({
  schemaVersion: "1",
  adapterId: CODEX_ADAPTER_ID,
  adapterVersion: CODEX_ADAPTER_VERSION,
  hostId: CODEX_HOST_ID,
  hostVersionRange: "=0.144.1-linux-x64",
  packageDigest: "sha256:b956415fe5ce831ecb94509e3153d084b4a6ef18b5b93c6b2cf37daab4b1d828",
  contributions: CODEX_NATIVE_CONTRIBUTIONS,
}) satisfies NativePackageMetadataV1;

export const CODEX_INSTALL_CONTRIBUTIONS = Object.freeze(CODEX_NATIVE_PACKAGE_METADATA.contributions.map((item, index) =>
  parseInstallContributionV1({ schemaVersion: "1", kind: index === 0 ? "plugin" : "file", contributionId: `horseness-codex-${index}`, relativePath: item.name, contentDigest: item.digest, sourceArtifactDigest: CODEX_NATIVE_PACKAGE_METADATA.packageDigest, mode: "read-only", hostScope: CODEX_HOST_ID }),
)) satisfies readonly InstallContributionV1[];

export interface CodexSubscriptionLiveReceiptV1 {
  readonly schemaVersion: "CodexSubscriptionLiveReceiptV1";
  readonly host: "codex";
  readonly authMode: "existing-user-subscription-session";
  readonly hostVersion: string;
  readonly observedModel: string;
  readonly candidate: { readonly head: string; readonly tree: string };
  readonly command: { readonly argv: readonly string[]; readonly digest: string; readonly scenarioSetDigest: string; readonly batchResponseDigest: string };
  readonly provenance: { readonly archiveDigest: string; readonly archiveIdentity: string; readonly memberPath: string; readonly executableDigest: string; readonly packageDigest: string; readonly contributions: readonly { readonly name: string; readonly digest: string }[]; readonly nativePlugin: { readonly observedPluginId: string; readonly nativeItemPluginId: string; readonly installedVersion: string; readonly installedPackageDigest: string; readonly installedContributions: readonly CodexNativeContributionDigestV1[]; readonly resolvedDeclarationDigest: string } };
  readonly bindings: readonly { readonly workspaceId: string; readonly runId: string; readonly taskId: string; readonly attemptId: string; readonly generation: number; readonly forkPinDigest: string; readonly contextManifestCoreDigest: string; readonly attemptContextBindingDigest: string; readonly receiptDigest: string; readonly proposalDigest: string; readonly outputDigest: string; readonly evidenceDigests: readonly string[] }[];
  readonly redactionAudit: { readonly passed: true; readonly prohibitedFields: readonly string[] };
  readonly timing: { readonly startedAt: string; readonly finishedAt: string; readonly durationMs: number };
  readonly terminal: { readonly result: "succeeded" | "failed"; readonly reason: string };
}
export function validateCodexSubscriptionLiveReceiptV1(value: CodexSubscriptionLiveReceiptV1): CodexSubscriptionLiveReceiptV1 {
  const bindingIdentities = value.bindings.map(item => `${item.workspaceId}:${item.runId}:${item.taskId}:${item.attemptId}:${item.generation}`);
  if (value.schemaVersion !== "CodexSubscriptionLiveReceiptV1" || value.host !== "codex" || value.authMode !== "existing-user-subscription-session" || value.observedModel.length === 0 || value.candidate.head.length === 0 || value.candidate.tree.length === 0 || value.command.argv.length === 0 || value.bindings.length !== 5 || new Set(bindingIdentities).size !== 5 || value.provenance.contributions.length === 0 || value.provenance.nativePlugin.observedPluginId.length === 0 || value.provenance.nativePlugin.nativeItemPluginId !== value.provenance.nativePlugin.observedPluginId || !/^0\.1\.0\+horseness\.[a-f0-9]{16}$/.test(value.provenance.nativePlugin.installedVersion) || value.timing.durationMs < 0 || value.timing.durationMs > 120_000 || Date.parse(value.timing.finishedAt) - Date.parse(value.timing.startedAt) !== value.timing.durationMs || value.terminal.result !== "succeeded" || value.redactionAudit.passed !== true) throw new Error("CODEX_LIVE_RECEIPT_INVALID");
  const digests = [value.command.digest, value.command.scenarioSetDigest, value.command.batchResponseDigest, value.provenance.archiveDigest, value.provenance.executableDigest, value.provenance.packageDigest, value.provenance.nativePlugin.installedPackageDigest, value.provenance.nativePlugin.resolvedDeclarationDigest, ...value.provenance.contributions.map(item => item.digest), ...value.provenance.nativePlugin.installedContributions.map(item => item.digest), ...value.bindings.flatMap(item => [item.forkPinDigest, item.contextManifestCoreDigest, item.attemptContextBindingDigest, item.receiptDigest, item.proposalDigest, item.outputDigest, ...item.evidenceDigests])];
  if (digests.some(digest => !/^(?:sha256:)?[a-f0-9]{64}$/.test(digest))) throw new Error("CODEX_LIVE_RECEIPT_DIGEST_INVALID");
  const observedContributions = value.provenance.contributions.map(observedCodexContribution);
  const installedIdentityMatches = value.provenance.nativePlugin.installedContributions.every((item, index) => {
    const shipped = CODEX_NATIVE_CONTRIBUTIONS[index];
    return shipped !== undefined && item.name === shipped.name && item.kind === shipped.kind && (item.name === "plugin/.codex-plugin/plugin.json" || item.digest === shipped.digest);
  });
  if (observedContributions.some(item => item === null) || JSON.stringify(value.provenance.contributions) !== JSON.stringify(CODEX_NATIVE_CONTRIBUTIONS.map(({ name, digest }) => ({ name, digest }))) || value.provenance.packageDigest !== codexNativePackageDigestV1(observedContributions as CodexNativeContributionDigestV1[]) || value.provenance.packageDigest !== CODEX_NATIVE_PACKAGE_METADATA.packageDigest || value.provenance.nativePlugin.installedVersion !== `0.1.0+horseness.${value.provenance.packageDigest.slice("sha256:".length, "sha256:".length + 16)}` || value.provenance.nativePlugin.installedContributions.length !== CODEX_NATIVE_CONTRIBUTIONS.length || !installedIdentityMatches || value.provenance.nativePlugin.installedPackageDigest !== codexNativePackageDigestV1(value.provenance.nativePlugin.installedContributions)) throw new Error("CODEX_LIVE_RECEIPT_PROVENANCE_MISMATCH");
  if (JSON.stringify(value).match(/"(?:account|email|subscriptionId|credential|authorization|token|cookie|authPath|tokenFingerprint)"\s*:/i)) throw new Error("CODEX_LIVE_RECEIPT_REDACTION_FAILED");
  return Object.freeze(structuredClone(value));
}
export interface CodexNativeAttemptV1 {
  readonly providerOperationId: string;
  readonly nativeSessionId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly outputDigest: string | null;
  readonly evidence: readonly { readonly digest: string; readonly mediaType: string; readonly size: number }[];
  readonly provenance: JsonValue;
}

export interface CodexNativeRuntimeV1 {
  launch(request: Readonly<AdapterLaunchRequestV1>): Promise<CodexNativeAttemptV1>;
  cancel(request: Readonly<AdapterCancelRequestV1>): Promise<CodexNativeAttemptV1 | null>;
  reconcile(request: Readonly<AdapterReconcileRequestV1>): Promise<CodexNativeAttemptV1 | null>;
  resume(request: Readonly<AdapterResumeRequestV1>): Promise<CodexNativeAttemptV1 | null>;
  collect(binding: Readonly<BoundAdapterOperationV1>): Promise<CodexNativeAttemptV1 | null>;
}

export interface CodexAdapterOptionsV1 {
  readonly binding: BoundAdapterOperationV1;
  readonly credential: CredentialReferenceV1;
  readonly runtime: CodexNativeRuntimeV1;
  readonly producerPrincipalId: string;
  readonly producerGrantDigest: string;
}

export interface CodexWorkerReturnAuthorityV1 {
  readonly client: WorkerReturnClientV1;
  sealProposal(binding: Readonly<BoundAdapterOperationV1>, receipt: AttemptReceiptEnvelopeV1): Promise<ProposalEnvelopeV1>;
  canonicalAcceptedAdvance?(): Promise<{ readonly workspaceId: string; readonly runId: string; readonly revision: number; readonly stateHash: string }>;
}
export interface CodexWorkerReturnDeliveryV1 { readonly receiptDigest: string; readonly decision: string; readonly resumeToken: string | null }
export interface CodexWorkerReturnRegistrationV1 {
  readonly capabilityReference: string;
  readonly binding: BoundAdapterOperationV1;
  readonly adapter: SecureWorkerAdapterV1;
  readonly authority: CodexWorkerReturnAuthorityV1;
  readonly subscriptionId: string;
}
export type CodexRetainedDeliveryPhaseV1 = "prepared" | "publication:0" | "publication:1" | "receipt" | "proposal" | "decision-resume" | "decision";
export interface CodexRetainedDeliveryV1 {
  readonly workerReturn: WorkerReturnV1;
  readonly phase: CodexRetainedDeliveryPhaseV1;
  readonly receiptDigest: string | null;
  readonly resumeToken: string | null;
  readonly decision: string | null;
}
export interface CodexRetainedDeliveryAuthorityV1 {
  load(attemptKey: string): CodexRetainedDeliveryV1 | undefined;
  create(attemptKey: string, value: CodexRetainedDeliveryV1): boolean;
  compareAndSet(attemptKey: string, expectedPhase: CodexRetainedDeliveryPhaseV1, value: CodexRetainedDeliveryV1): boolean;
  runExclusive<T>(attemptKey: string, operation: () => Promise<T>): Promise<T>;
  close(): void;
  clear(): void;
}
export function createCodexRetainedDeliveryAuthorityV1(stateDirectory: string): CodexRetainedDeliveryAuthorityV1 {
  if (!isAbsolute(stateDirectory)) throw new Error("Codex retained state directory must be absolute");
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const stateStat = lstatSync(stateDirectory);
  if (stateStat.isSymbolicLink() || !stateStat.isDirectory() || (stateStat.mode & 0o077) !== 0) throw new Error("Codex retained state directory must be a private, non-symlink directory");
  const root = realpathSync(stateDirectory);
  const records = join(root, "records");
  const locks = join(root, "locks");
  for (const directory of [records, locks]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const details = lstatSync(directory);
    if (details.isSymbolicLink() || !details.isDirectory() || (details.mode & 0o077) !== 0 || dirname(realpathSync(directory)) !== root) throw new Error("Codex retained state path must be a private, non-symlink directory");
  }
  let closed = false;
  type LockOwner = { readonly pid: number; readonly nonce: string; readonly incarnation: string };
  const held = new Map<string, LockOwner>();
  const assertOpen = () => { if (closed) throw new Error("Codex retained delivery authority is closed"); };
  const nameFor = (key: string) => createHash("sha256").update(key).digest("hex");
  const recordPath = (key: string) => join(records, `${nameFor(key)}.json`);
  const lockPath = (key: string) => join(locks, nameFor(key));
  const assertRegularPrivateFile = (path: string) => {
    const details = lstatSync(path);
    if (details.isSymbolicLink() || !details.isFile() || (details.mode & 0o077) !== 0) throw new Error("Codex retained state record must be a private regular file");
  };
  const readRecord = (key: string): CodexRetainedDeliveryV1 | undefined => {
    assertOpen();
    const path = recordPath(key);
    try { assertRegularPrivateFile(path); return JSON.parse(readFileSync(path, "utf8")) as CodexRetainedDeliveryV1; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  };
  const syncDirectory = (path: string) => { const descriptor = openSync(path, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } };
  const publish = (key: string, value: CodexRetainedDeliveryV1) => {
    const path = recordPath(key);
    const temporary = join(records, `.${nameFor(key)}.${process.pid}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, JSON.stringify(value), "utf8"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, path);
    syncDirectory(records);
  };
  const linuxProcessIncarnation = (pid: number): string => {
    if (process.platform !== "linux") throw new Error("Codex retained delivery locks require verifiable process incarnation identity");
    let stat: string;
    try { stat = readFileSync(`/proc/${pid}/stat`, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Codex retained delivery lock owner process is absent");
      throw new Error("Codex retained delivery lock process incarnation could not be verified", { cause: error });
    }
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 2 || stat[commandEnd + 1] !== " ") throw new Error("Codex retained delivery lock process incarnation is invalid");
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
    const starttime = fields[19];
    if (starttime === undefined || !/^[0-9]+$/.test(starttime)) throw new Error("Codex retained delivery lock process incarnation is invalid");
    return starttime;
  };
  const readOwner = (path: string): LockOwner => {
    assertRegularPrivateFile(path);
    const owner = JSON.parse(readFileSync(path, "utf8")) as LockOwner;
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.nonce !== "string" || owner.nonce.length === 0 || typeof owner.incarnation !== "string" || !/^[0-9]+$/.test(owner.incarnation)) throw new Error("Codex retained delivery lock owner is invalid");
    return owner;
  };
  const ownersMatch = (left: LockOwner, right: LockOwner): boolean => left.pid === right.pid && left.nonce === right.nonce && left.incarnation === right.incarnation;
  const ownerIsCurrent = (owner: LockOwner): boolean => {
    try { return linuxProcessIncarnation(owner.pid) === owner.incarnation; }
    catch (error) { if ((error as Error).message === "Codex retained delivery lock owner process is absent") return false; throw error; }
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
        if (details.isSymbolicLink() || !details.isDirectory() || (details.mode & 0o077) !== 0) throw new Error("Codex retained lock path must be a private, non-symlink directory");
        let existing: LockOwner;
        try { existing = readOwner(join(path, "owner.json")); }
        catch (ownerError) {
          if (Date.now() - statSync(path).mtimeMs > 1_000) { rmSync(path, { recursive: true }); syncDirectory(locks); continue; }
          if (Date.now() >= deadline) throw new Error("Codex retained delivery lock acquisition timed out");
          const { promise: wait, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 10); await wait; continue;
        }
        if (!ownerIsCurrent(existing)) {
          const reread = readOwner(join(path, "owner.json"));
          if (ownersMatch(reread, existing)) { rmSync(path, { recursive: true }); syncDirectory(locks); continue; }
        }
        if (Date.now() >= deadline) throw new Error("Codex retained delivery lock acquisition timed out");
        const { promise: wait, resolve } = Promise.withResolvers<void>(); setTimeout(resolve, 10); await wait;
      }
    }
  };
  const release = (key: string, expected: LockOwner) => {
    const path = lockPath(key);
    const owner = readOwner(join(path, "owner.json"));
    if (!ownersMatch(owner, expected)) throw new Error("Codex retained delivery lock ownership changed before release");
    rmSync(path, { recursive: true }); syncDirectory(locks);
  };
  return Object.freeze({
    load(key: string) { const value = readRecord(key); return value === undefined ? undefined : structuredClone(value); },
    create(key: string, value: CodexRetainedDeliveryV1) { if (held.get(key) === undefined) throw new Error("Codex retained create requires the attempt lock"); if (readRecord(key) !== undefined) return false; publish(key, structuredClone(value)); return true; },
    compareAndSet(key: string, expectedPhase: CodexRetainedDeliveryPhaseV1, value: CodexRetainedDeliveryV1) { if (held.get(key) === undefined) throw new Error("Codex retained compare-and-set requires the attempt lock"); if (readRecord(key)?.phase !== expectedPhase) return false; publish(key, structuredClone(value)); return true; },
    async runExclusive<T>(key: string, operation: () => Promise<T>) { assertOpen(); const owner = await acquire(key); held.set(key, owner); try { return await operation(); } finally { held.delete(key); release(key, owner); } },
    close() { closed = true; },
    clear() { assertOpen(); for (const directory of [records, locks]) { rmSync(directory, { recursive: true }); mkdirSync(directory, { mode: 0o700 }); } syncDirectory(root); },
  });
}
export interface CodexNativeAttemptContextV1 {
  readonly attemptCapabilityReference: string;
  readonly binding: BoundAdapterOperationV1;
  readonly renderedContext: string;
  readonly renderedContextDigest: string;
}
export interface CodexNativeContributionRuntimeOptionsV1 {
  readonly retained: CodexRetainedDeliveryAuthorityV1;
  readonly attemptContexts?: readonly CodexNativeAttemptContextV1[];
  readonly initialAttemptCapabilityReference?: string;
  readonly sessionStateDirectory?: string;
  readonly killSwitchPath?: string;
}
export interface CodexNativeBranchRegistrationV1 {
  readonly entryId: string;
  readonly previousSessionFile: string;
  readonly attemptCapabilityReference: string;
}
export interface CodexNativeSessionStartV1 {
  readonly sessionId: string;
  readonly source: "startup" | "resume" | "fork" | "clear" | "compact";
  readonly previousSessionId?: string;
  readonly branchEntryId?: string;
}
export interface CodexNativeThreadClaimV1 {
  readonly claim: string;
  readonly attemptCapabilityReferences: readonly string[];
  readonly primaryAttemptCapabilityReference: string;
}
export interface CodexNativeWorkerReturnInputV1 {
  readonly attemptCapabilityReference: string;
  readonly output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number };
  readonly evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number };
}
export interface CodexNativeWorkerReturnResultV1 { readonly workerReturn: WorkerReturnV1; readonly delivery: CodexWorkerReturnDeliveryV1 }
export interface CodexNativeWorkerReturnBatchEvidenceV1 {
  readonly workspaceId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly decision: string;
  readonly receiptDigest: string;
  readonly proposalDigest: string;
  readonly outputDigest: string;
  readonly evidenceDigests: readonly string[];
}
export interface CodexNativeWorkerReturnBatchResultV1 {
  readonly schemaVersion: "HorsenessCodexWorkerReturnBatchResultV1";
  readonly sessionId: string;
  readonly results: readonly CodexNativeWorkerReturnBatchEvidenceV1[];
  readonly canonicalAcceptedAdvance: { readonly workspaceId: string; readonly runId: string; readonly revision: number; readonly stateHash: string };
}

export interface CodexNativeContributionRuntimeV1 {
  deliver(capabilityReference: string, output: CodexNativeWorkerReturnInputV1["output"], evidence: CodexNativeWorkerReturnInputV1["evidence"], sessionId: string): Promise<CodexNativeWorkerReturnResultV1>;
  deliverBatch(inputs: readonly CodexNativeWorkerReturnInputV1[], claim: string, sessionId: string): Promise<CodexNativeWorkerReturnBatchResultV1>;
  registerThreadClaim(registration: CodexNativeThreadClaimV1): void;
  bindThreadClaim(claim: string, sessionId: string, start: Omit<CodexNativeSessionStartV1, "sessionId">): Promise<CodexNativeAttemptContextV1>;
  sessionForThreadClaim(claim: string): string;
  state(): Promise<{ readonly attemptKeys: readonly string[] }>;
  contextForAttempt(): Promise<CodexNativeAttemptContextV1 | null>;
  registerSessionStart(start: CodexNativeSessionStartV1): Promise<CodexNativeAttemptContextV1>;
  registerBranch(registration: CodexNativeBranchRegistrationV1): void;
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
const DELIVERY_PHASES: readonly CodexRetainedDeliveryPhaseV1[] = ["prepared", "publication:0", "publication:1", "receipt", "proposal", "decision-resume", "decision"];
const publicationPhase = (step: WorkerReturnDeliveryStepV1): CodexRetainedDeliveryPhaseV1 => {
  if (step !== "publication:0" && step !== "publication:1") throw new Error("Codex retained delivery received an unsupported publication phase");
  return step;
};
function completedPhase(step: WorkerReturnDeliveryStepV1): CodexRetainedDeliveryPhaseV1 {
  if (step === "decision-subscription") return "decision-resume";
  if (step === "decision" || step === "receipt" || step === "proposal") return step;
  return publicationPhase(step);
}
const hasCompleted = (record: CodexRetainedDeliveryV1, step: WorkerReturnDeliveryStepV1): boolean => DELIVERY_PHASES.indexOf(record.phase) >= DELIVERY_PHASES.indexOf(completedPhase(step));
class CodexRetainedWorkerReturnDeliveryV1 implements WorkerReturnDeliveryAuthorityV1 {
  constructor(private readonly retained: CodexRetainedDeliveryAuthorityV1, private readonly key: string) {}
  async perform<T>(step: WorkerReturnDeliveryStepV1, operation: () => Promise<T>): Promise<T> {
    const record = this.record();
    if (hasCompleted(record, step)) return this.completed<T>(record, step);
    const result = await operation();
    const next = { ...record, phase: completedPhase(step) };
    if (step === "receipt") next.receiptDigest = result as string;
    if (step === "decision-subscription") {
      const issued = result as { resumeToken: string };
      if (issued.resumeToken.length === 0) throw new Error("Codex decision authority did not issue a resumable token");
      next.resumeToken = issued.resumeToken;
      next.workerReturn = { ...record.workerReturn, decisionResume: { ...record.workerReturn.decisionResume, resumeToken: issued.resumeToken } };
    }
    if (step === "decision") {
      const observed = result as { resumeToken: string; decision: string };
      if (record.resumeToken === null || observed.resumeToken.length === 0) throw new Error("Codex decision observation lacks a retained resume token");
      next.resumeToken = observed.resumeToken; next.decision = observed.decision;
      next.workerReturn = { ...record.workerReturn, decisionResume: { ...record.workerReturn.decisionResume, resumeToken: observed.resumeToken } };
    }
    if (!this.retained.compareAndSet(this.key, record.phase, next)) throw new Error("Codex retained delivery phase compare-and-set conflict");
    return result;
  }
  private record(): CodexRetainedDeliveryV1 {
    const record = this.retained.load(this.key);
    if (record === undefined) throw new Error("Codex retained worker return is unavailable");
    return record;
  }
  private completed<T>(record: CodexRetainedDeliveryV1, step: WorkerReturnDeliveryStepV1): T {
    if (step === "receipt") { if (record.receiptDigest === null) throw new Error("Codex retained receipt digest is unavailable"); return record.receiptDigest as T; }
    if (step === "proposal") return { proposalId: record.workerReturn.proposal.proposalId, proposalDigest: record.workerReturn.proposal.proposalDigest } as T;
    if (step === "decision-subscription") { if (record.resumeToken === null) throw new Error("Codex retained decision subscription is unavailable"); return { resumeToken: record.resumeToken } as T; }
    if (step === "decision") { if (record.resumeToken === null || record.decision === null) throw new Error("Codex retained decision is unavailable"); return { resumeToken: record.resumeToken, decision: record.decision } as T; }
    return undefined as T;
  }
}
function assertCanonicalTuple(record: CodexRetainedDeliveryV1, receipt: AttemptReceiptEnvelopeV1, outputDigest: string, evidenceDigest: string): void {
  const publications = record.workerReturn.publications;
  if (record.workerReturn.receipt.receiptDigest !== receipt.receiptDigest || publications.length !== 2 || publications[0]?.kind !== "artifact" || publications[0].digest !== outputDigest || publications[1]?.kind !== "evidence" || publications[1].digest !== evidenceDigest) throw new Error("replayed Codex worker return substituted the canonical output/evidence tuple");
}
type CodexThreadClaimStateV1 = { readonly attemptCapabilityReferences: readonly string[]; readonly primaryAttemptCapabilityReference: string; readonly sessionId: string | null };
type CodexSessionBindingStateV1 = {
  readonly schemaVersion: "CodexSessionBindingStateV1";
  readonly sessions: Readonly<Record<string, string>>;
  readonly branches: Readonly<Record<string, CodexNativeBranchRegistrationV1>>;
  readonly claims: Readonly<Record<string, CodexThreadClaimStateV1>>;
};
function createSessionBindingStore(directory: string | undefined) {
  if (directory === undefined || !isAbsolute(directory)) throw new Error("Codex session binding state directory must be absolute");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const root = realpathSync(directory);
  const path = join(root, "session-bindings.json");
  const read = (): CodexSessionBindingStateV1 => {
    try {
      const details = lstatSync(path);
      if (details.isSymbolicLink() || !details.isFile() || (details.mode & 0o077) !== 0) throw new Error("Codex session binding state must be a private regular file");
      const parsed = JSON.parse(readFileSync(path, "utf8")) as CodexSessionBindingStateV1;
      if (parsed.schemaVersion !== "CodexSessionBindingStateV1" || parsed.sessions === null || parsed.branches === null) throw new Error("Codex session binding state is invalid");
      return { ...parsed, claims: parsed.claims ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: "CodexSessionBindingStateV1", sessions: {}, branches: {}, claims: {} };
      throw error;
    }
  };
  const publish = (state: CodexSessionBindingStateV1) => {
    const temporary = join(root, `.session-bindings.${process.pid}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporary, "wx", 0o600);
    try { writeFileSync(descriptor, JSON.stringify(state), "utf8"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, path);
    const rootDescriptor = openSync(root, "r"); try { fsyncSync(rootDescriptor); } finally { closeSync(rootDescriptor); }
  };
  return { read, publish };
}
const CODEX_UNINSTALL_PHASES = ["kill_switch_written", "discovery_disabled", "authority_revoked", "complete"] as const;
function readActiveCodexKillSwitch(path: string): boolean {
  if (!isAbsolute(path)) throw new Error("CODEX_KILL_SWITCH_PATH_INVALID");
  const parent = dirname(path);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o077) !== 0 || realpathSync(parent) !== parent) throw new Error("CODEX_KILL_SWITCH_PARENT_INVALID");
  let fileStat;
  try { fileStat = lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o077) !== 0 || realpathSync(path) !== path) throw new Error("CODEX_KILL_SWITCH_FILE_INVALID");
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expectedKeys = ["installedPluginRoot", "killSwitch", "marketplaceName", "pluginId", "schemaVersion", "state"].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys) || value.schemaVersion !== "CodexUninstallStateV1" || value.killSwitch !== true || value.pluginId !== "horseness-codex@horseness-c18" || value.marketplaceName !== "horseness-c18" || !CODEX_UNINSTALL_PHASES.includes(value.state as typeof CODEX_UNINSTALL_PHASES[number]) || typeof value.installedPluginRoot !== "string" || !isAbsolute(value.installedPluginRoot)) throw new Error("CODEX_KILL_SWITCH_JOURNAL_INVALID");
  return true;
}

export function createCodexNativeContributionRuntimeV1(registrations: readonly CodexWorkerReturnRegistrationV1[], options: CodexNativeContributionRuntimeOptionsV1): CodexNativeContributionRuntimeV1 {
  if (options?.retained === undefined) throw new Error("Codex native contribution runtime requires a durable retained delivery authority");
  for (const registration of registrations) {
    const client = registration.authority.client as WorkerReturnClientV1 & Record<string, unknown>;
    if (typeof client.startDecisionSubscription !== "function" || typeof client.observeDecision !== "function") throw new Error("Codex native contribution runtime requires resumable startDecisionSubscription and observeDecision authority methods");
  }
  const active = new Map<string, CodexWorkerReturnRegistrationV1>();
  const retained = options.retained;
  const contexts = new Map((options.attemptContexts ?? []).map(context => [context.attemptCapabilityReference, structuredClone(context)]));
  const sessionStore = createSessionBindingStore(options.sessionStateDirectory);
  const persisted = sessionStore.read();
  const branchesByEntry = new Map(Object.entries(persisted.branches));
  const branchesBySession = new Map(Object.values(persisted.branches).map(branch => [branch.previousSessionFile, branch]));
  const sessions = new Map(Object.entries(persisted.sessions));
  const claims = new Map(Object.entries(persisted.claims));
  let selectedCapability = options.initialAttemptCapabilityReference ?? registrations[0]?.capabilityReference ?? null;
  let pendingBranch: CodexNativeBranchRegistrationV1 | null = null;
  let revoker: (() => Promise<void>) | null = null;
  let revoked = false;
  const assertEnabled = () => {
    if (revoked) throw new Error("Codex native contribution runtime is revoked");
    if (options.killSwitchPath === undefined) return;
    if (readActiveCodexKillSwitch(options.killSwitchPath)) throw new Error("Codex native contribution kill switch is active");
  };
  const persistSessions = () => sessionStore.publish({ schemaVersion: "CodexSessionBindingStateV1", sessions: Object.fromEntries(sessions), branches: Object.fromEntries(branchesByEntry), claims: Object.fromEntries(claims) });
  for (const registration of registrations) {
    const reference = parseCredentialReferenceV1({ schemaVersion: "1", kind: "host-reference", reference: registration.capabilityReference, scope: { workspaceId: registration.binding.workspaceId, adapterId: CODEX_ADAPTER_ID, purpose: "codex-attempt-return" } });
    if (reference.reference !== registration.binding.attemptCapability) throw new Error("Codex attempt capability reference does not match immutable binding");
    if (active.has(reference.reference)) throw new Error("duplicate Codex attempt capability reference");
    active.set(reference.reference, registration);
  }
  return Object.freeze({
    async deliver(capabilityReference: string, output: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, evidence: { readonly digest: string; readonly mediaType: string; readonly byteLength: number }, sessionId: string) {
      assertEnabled();
      if (sessionId.length === 0 || sessions.get(sessionId) !== capabilityReference) throw new Error("Codex session capability substitution rejected");
      const registration = active.get(capabilityReference);
      if (registration === undefined) throw new Error("unknown or revoked Codex attempt capability reference");
      const key = attemptKey(registration.binding);
      return retained.runExclusive(key, async () => {
        assertEnabled();
        const receipt = await registration.adapter.collectReceipt(registration.binding);
        if (receipt.outputDigest !== output.digest) throw new Error("Codex provider output digest does not match the bound attempt receipt");
        if (receipt.evidence.length !== 1 || receipt.evidence[0]?.digest !== evidence.digest) throw new Error("Codex provider evidence digest does not match the bound attempt receipt");
        if (receipt.evidence[0]?.mediaType !== evidence.mediaType || receipt.evidence[0]?.size !== evidence.byteLength) throw new Error("Codex provider evidence descriptor does not match the bound attempt receipt");
        let record = retained.load(key);
        if (record === undefined) {
          const proposal = await registration.authority.sealProposal(registration.binding, receipt);
          const workerReturn: WorkerReturnV1 = { schemaVersion: "1", binding: registration.binding, receipt, proposal, publications: [{ digest: output.digest, kind: "artifact" }, { digest: evidence.digest, kind: "evidence" }], decisionResume: { proposalId: proposal.proposalId, proposalDigest: proposal.proposalDigest, subscriptionId: registration.subscriptionId, resumeToken: null } };
          record = { workerReturn, phase: "prepared", receiptDigest: null, resumeToken: null, decision: null };
          if (!retained.create(key, record)) throw new Error("Codex retained worker return create conflict");
        } else assertCanonicalTuple(record, receipt, output.digest, evidence.digest);
        const delivery = await deliverWorkerReturn(record.workerReturn, registration.authority.client, new CodexRetainedWorkerReturnDeliveryV1(retained, key));
        record = retained.load(key);
        if (record === undefined || record.phase !== "decision") throw new Error("Codex retained worker return did not reach a terminal decision");
        return structuredClone({ workerReturn: record.workerReturn, delivery });
      });
    },
    async deliverBatch(inputs: readonly CodexNativeWorkerReturnInputV1[], claim: string, sessionId: string) {
      assertEnabled();
      if (inputs.length !== 5 || new Set(inputs.map(input => input.attemptCapabilityReference)).size !== 5) throw new Error("Codex native worker return batch requires exactly five distinct scenario capabilities");
      const claimState = claims.get(claim);
      if (claimState === undefined || claimState.sessionId !== sessionId) throw new Error("Codex worker return thread claim is unknown, unbound, reused, or substituted");
      const expected = [...claimState.attemptCapabilityReferences].sort();
      const supplied = inputs.map(input => input.attemptCapabilityReference).sort();
      if (JSON.stringify(expected) !== JSON.stringify(supplied)) throw new Error("Codex worker return thread claim capability substitution rejected");
      claims.delete(claim); persistSessions();
      const results: CodexNativeWorkerReturnBatchEvidenceV1[] = [];
      let canonicalAcceptedAdvance: CodexNativeWorkerReturnBatchResultV1["canonicalAcceptedAdvance"] | null = null;
      for (const input of inputs) {
        sessions.set(sessionId, input.attemptCapabilityReference);
        const delivered = await this.deliver(input.attemptCapabilityReference, input.output, input.evidence, sessionId);
        const { binding, receipt, proposal } = delivered.workerReturn;
        results.push({ workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, decision: delivered.delivery.decision, receiptDigest: receipt.receiptDigest, proposalDigest: proposal.proposalDigest, outputDigest: receipt.outputDigest!, evidenceDigests: receipt.evidence.map(item => item.digest) });
        if (delivered.delivery.decision === "accepted") {
          const authority = active.get(input.attemptCapabilityReference)?.authority;
          if (canonicalAcceptedAdvance !== null || authority?.canonicalAcceptedAdvance === undefined) throw new Error("Codex native worker return batch lacks one authoritative accepted canonical advance");
          canonicalAcceptedAdvance = await authority.canonicalAcceptedAdvance();
        }
      }
      sessions.set(sessionId, claimState.primaryAttemptCapabilityReference); persistSessions();
      if (canonicalAcceptedAdvance === null) throw new Error("Codex native worker return batch lacks one authoritative accepted canonical advance");
      return structuredClone({ schemaVersion: "HorsenessCodexWorkerReturnBatchResultV1" as const, sessionId, results, canonicalAcceptedAdvance });
    },
    registerThreadClaim(registration: CodexNativeThreadClaimV1) {
      assertEnabled();
      if (registration.claim.length < 32 || claims.has(registration.claim) || registration.attemptCapabilityReferences.length === 0 || !registration.attemptCapabilityReferences.includes(registration.primaryAttemptCapabilityReference) || registration.attemptCapabilityReferences.some(reference => !active.has(reference))) throw new Error("invalid or reused Codex thread claim");
      claims.set(registration.claim, { attemptCapabilityReferences: [...registration.attemptCapabilityReferences], primaryAttemptCapabilityReference: registration.primaryAttemptCapabilityReference, sessionId: null }); persistSessions();
    },
    async bindThreadClaim(claim: string, sessionId: string, start: Omit<CodexNativeSessionStartV1, "sessionId">) {
      assertEnabled();
      const claimState = claims.get(claim);
      if (claimState === undefined || claimState.sessionId !== null) throw new Error("Codex thread claim is unknown, reused, or already bound");
      selectedCapability = claimState.primaryAttemptCapabilityReference;
      const context = await this.registerSessionStart({ ...start, sessionId });
      if (context.attemptCapabilityReference !== claimState.primaryAttemptCapabilityReference) throw new Error("Codex thread claim context substitution rejected");
      claims.set(claim, { ...claimState, sessionId }); persistSessions();
      return context;
    },
    sessionForThreadClaim(claim: string) { assertEnabled(); const value = claims.get(claim); if (value?.sessionId === null || value === undefined) throw new Error("Codex thread claim is unknown or unbound"); return value.sessionId; },
    async state() { return { attemptKeys: registrations.map(registration => attemptKey(registration.binding)).filter(key => retained.load(key) !== undefined) }; },
    async contextForAttempt() { if (revoked || selectedCapability === null) return null; const context = contexts.get(selectedCapability); return context === undefined ? null : structuredClone(context); },
    async registerSessionStart(start: CodexNativeSessionStartV1) {
      assertEnabled();
      if (start.sessionId.length === 0) throw new Error("invalid Codex session start");
      const existing = sessions.get(start.sessionId);
      if (existing !== undefined) {
        if (start.source === "startup" || (start.previousSessionId !== undefined && sessions.get(start.previousSessionId) !== existing)) throw new Error("Codex session binding substitution rejected");
        const context = contexts.get(existing); if (context === undefined) throw new Error("Codex session references an unknown attempt capability"); return structuredClone(context);
      }
      let capability: string | undefined;
      if (start.source === "startup") capability = selectedCapability ?? undefined;
      else if (start.source === "fork") {
        if (start.branchEntryId === undefined) throw new Error("Codex fork requires a pre-registered branch entry id");
        const branch = branchesByEntry.get(start.branchEntryId);
        if (branch === undefined) throw new Error("unknown Codex branch entry id");
        if (start.previousSessionId !== branch.previousSessionFile || sessions.get(start.previousSessionId) === undefined) throw new Error("Codex branch source session does not match the immutable mapping");
        capability = branch.attemptCapabilityReference;
      } else {
        if (start.branchEntryId !== undefined) throw new Error("Codex branch entry id is only valid for a fork session");
        if (start.previousSessionId !== undefined) capability = sessions.get(start.previousSessionId);
      }
      if (capability === undefined || !active.has(capability) || !contexts.has(capability)) throw new Error("Codex session source is unknown or unbound");
      sessions.set(start.sessionId, capability); selectedCapability = capability; persistSessions();
      return structuredClone(contexts.get(capability)!);
    },
    registerBranch(registration: CodexNativeBranchRegistrationV1) {
      assertEnabled();
      const { entryId, previousSessionFile, attemptCapabilityReference } = registration;
      if (entryId.length === 0 || previousSessionFile.length === 0) throw new Error("invalid Codex branch registration identifiers");
      if (!active.has(attemptCapabilityReference) || !contexts.has(attemptCapabilityReference)) throw new Error("Codex branch registration references an unknown attempt capability");
      const existingEntry = branchesByEntry.get(entryId);
      const existingSession = branchesBySession.get(previousSessionFile);
      if (existingEntry !== undefined || existingSession !== undefined) {
        const sameEntry = existingEntry?.previousSessionFile === previousSessionFile && existingEntry.attemptCapabilityReference === attemptCapabilityReference;
        const sameSession = existingSession?.entryId === entryId && existingSession.attemptCapabilityReference === attemptCapabilityReference;
        if (!sameEntry || !sameSession) throw new Error("Codex branch registration cannot overwrite or substitute an immutable mapping");
        return;
      }
      const immutable = Object.freeze({ entryId, previousSessionFile, attemptCapabilityReference });
      branchesByEntry.set(entryId, immutable);
      branchesBySession.set(previousSessionFile, immutable);
      persistSessions();
    },
    async beforeBranch(entryId: string) {
      assertEnabled();
      if (typeof entryId !== "string" || entryId.length === 0) throw new Error("invalid Codex branch entry id");
      const branch = branchesByEntry.get(entryId);
      if (branch === undefined) throw new Error("unknown Codex branch entry id");
      pendingBranch = branch;
    },
    async activateSession(previousSessionFile: string | null) {
      assertEnabled();
      if (previousSessionFile !== null) {
        const pending = pendingBranch;
        pendingBranch = null;
        if (pending === null) throw new Error("Codex branch activation was not preceded by session_before_branch");
        const mapped = branchesBySession.get(previousSessionFile);
        if (mapped === undefined || mapped !== pending) throw new Error("Codex branch activation does not match the pending immutable mapping");
        selectedCapability = mapped.attemptCapabilityReference;
      }
      const context = selectedCapability === null ? undefined : contexts.get(selectedCapability);
      return context === undefined ? null : { forkPinDigest: context.binding.forkPinDigest };
    },
    registerRevoker(next: () => Promise<void>) { if (revoker !== null) throw new Error("Codex native grant revoker is already registered"); revoker = next; },
    async revoke() { if (revoked) return; revoked = true; active.clear(); contexts.clear(); branchesByEntry.clear(); branchesBySession.clear(); sessions.clear(); claims.clear(); selectedCapability = null; pendingBranch = null; persistSessions(); const current = revoker; revoker = null; if (current !== null) await current(); else retained.close(); },
    async sessionShutdown() { assertEnabled(); pendingBranch = null; },
    async shutdown() { active.clear(); contexts.clear(); branchesByEntry.clear(); branchesBySession.clear(); sessions.clear(); claims.clear(); selectedCapability = null; pendingBranch = null; retained.close(); },
  });
}

const result = (status: AdapterOperationResultV1["status"], attempt: CodexNativeAttemptV1 | null, details: JsonValue = {}): AdapterOperationResultV1 => ({ schemaVersion: "1", status, providerOperationId: attempt?.providerOperationId ?? null, nativeSessionId: attempt?.nativeSessionId ?? null, details });

class CodexWorkerAdapterV1 implements WorkerAdapterV1 {
  readonly #guard;
  readonly #runtime: CodexNativeRuntimeV1;
  readonly #producerPrincipalId: string;
  readonly #producerGrantDigest: string;
  #attempt: CodexNativeAttemptV1 | null = null;

  constructor(options: CodexAdapterOptionsV1) {
    this.#guard = createBindingGuard(options.binding);
    const credential = parseCredentialReferenceV1(options.credential);
    if (credential.scope.workspaceId !== options.binding.workspaceId || credential.scope.adapterId !== CODEX_ADAPTER_ID || credential.scope.purpose !== "horseness-attempt-grant") throw new Error("Codex Horseness grant reference scope does not match immutable adapter binding");
    this.#runtime = options.runtime;
    this.#producerPrincipalId = options.producerPrincipalId;
    this.#producerGrantDigest = options.producerGrantDigest;
  }

  async detectCapabilities(): Promise<AdapterCapabilitiesV1> {
    return { schemaVersion: "1", adapterId: CODEX_ADAPTER_ID, providerId: CODEX_PROVIDER_ID, launch: true, cancel: true, reconcile: "supported", reattach: "supported", nativeResume: "supported", contextInjection: "native", receiptCollection: true, maxContextBytes: 1_048_576, outputMediaTypes: ["text/plain", "application/json"], evidenceMediaTypes: ["application/json"] };
  }

  async launch(request: AdapterLaunchRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.launch(Object.freeze(structuredClone(request))); return result("accepted", this.#attempt, { host: CODEX_HOST_ID, hostVersion: CODEX_HOST_VERSION }); }
  async cancel(request: AdapterCancelRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.cancel(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async reconcile(request: AdapterReconcileRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.reconcile(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async resume(request: AdapterResumeRequestV1): Promise<AdapterOperationResultV1> { this.#guard.assert(request); this.#attempt = await this.#runtime.resume(Object.freeze(structuredClone(request))); return result(this.#attempt === null ? "not-found" : "found", this.#attempt); }
  async collectReceipt(binding: BoundAdapterOperationV1): Promise<AttemptReceiptEnvelopeV1> {
    this.#guard.assert(binding);
    const attempt = await this.#runtime.collect(this.#guard.binding) ?? this.#attempt;
    if (attempt === null) throw new Error("Codex native attempt receipt is unavailable");
    return sealAttemptReceipt({ schemaVersion: "1", workspaceId: binding.workspaceId, runId: binding.runId, taskId: binding.taskId, attemptId: binding.attemptId, generation: binding.generation, attemptContextBindingDigest: binding.attemptContextBindingDigest, contextManifestCoreDigest: binding.contextManifestCoreDigest, forkPinDigest: binding.forkPinDigest, providerId: CODEX_PROVIDER_ID, providerOperationId: attempt.providerOperationId, providerIdempotencyKeyDigest: binding.providerIdempotencyKeyDigest, producerPrincipalId: this.#producerPrincipalId, producerGrantDigest: this.#producerGrantDigest, adapterId: CODEX_ADAPTER_ID, adapterVersion: CODEX_ADAPTER_VERSION, hostId: CODEX_HOST_ID, hostVersion: CODEX_HOST_VERSION, outcome: attempt.outcome, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, outputDigest: attempt.outputDigest, evidence: attempt.evidence, provenance: attempt.provenance, nonce: `${binding.attemptId}:${binding.generation}:${attempt.providerOperationId}` });
  }
}

export function createCodexAdapterV1(options: CodexAdapterOptionsV1): SecureWorkerAdapterV1 { return new SecureWorkerAdapterV1(options.binding, new CodexWorkerAdapterV1(options)); }
export function codexDoctorV1(input: { readonly nativePackageVersion: string | null; readonly loaderDigest: string | null; readonly contributions: readonly { readonly name: string; readonly digest: string }[] }): DoctorProbeResultV1 {
  const observed = input.contributions.map(observedCodexContribution);
  const contributionsMatch = observed.every(item => item !== null) && JSON.stringify(input.contributions) === JSON.stringify(CODEX_NATIVE_CONTRIBUTIONS.map(({ name, digest }) => ({ name, digest }))) && codexNativePackageDigestV1(observed as CodexNativeContributionDigestV1[]) === CODEX_NATIVE_PACKAGE_METADATA.packageDigest;
  return parseDoctorProbeResultV1({ schemaVersion: "1", checks: [
    { code: "CODEX_NATIVE_VERSION", status: input.nativePackageVersion === CODEX_HOST_VERSION ? "ok" : "error", evidenceDigest: input.nativePackageVersion === null ? null : `version:${input.nativePackageVersion}` },
    { code: "Codex_EXTENSION_LOADER", status: input.loaderDigest === "sha256:a96f944d1a596dbfb7fdd84f482be5c50e34b04bb371126840d873e4ebf26902" ? "ok" : "error", evidenceDigest: input.loaderDigest },
    { code: "Codex_CONTRIBUTIONS", status: contributionsMatch ? "ok" : "error", evidenceDigest: contributionsMatch ? CODEX_NATIVE_PACKAGE_METADATA.packageDigest : null },
  ], restartRequired: false });
}
