import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInstallConsentV1, type InstallConsentV1 } from "../consent/index.js";
import { InstallerJournal, installerSha256 } from "../journal/index.js";

export const INSTALL_HOST_IDS_V1 = ["pi", "omp", "claude", "codex"] as const;
export type InstallHostIdV1 = typeof INSTALL_HOST_IDS_V1[number];
export type InstallScopeV1 = "user" | "workspace";
export type HostDetectionV1 = "present-supported" | "absent" | "unsupported" | "managed-blocked" | "failed";
export type InstallExitCodeV1 = 0 | 1 | 2 | 3 | 4;

export interface NeutralContributionFileV1 {
  readonly path: string;
  readonly kind: "manifest" | "plugin" | "skill" | "agent" | "hook" | "mcp-server" | "native-resource";
  readonly mode: number;
  readonly size: number;
  readonly contentDigest: string;
  readonly archiveDigest: string;
  readonly memberDigest: string;
  readonly bytesBase64: string;
}
export interface NeutralHostContributionV1 {
  readonly hostId: InstallHostIdV1;
  readonly pinnedHostVersion: string;
  readonly support: "supported" | "experimental";
  readonly platforms: readonly { readonly platform: NodeJS.Platform; readonly arch: string }[];
  readonly discoveryRootId: InstallHostIdV1;
  readonly targetRelativePath: string;
  readonly packageDigest: string;
  readonly sourceArtifactDigest: string;
  readonly files: readonly NeutralContributionFileV1[];
}
export interface NeutralInstallBundleV1 {
  readonly schema: "horseness.neutral-install-bundle.v1";
  readonly releaseVersion: string;
  readonly releaseManifestDigest: string;
  readonly authenticatedManifestKeyId: string;
  readonly authenticatedManifestSequence: number;
  readonly catalogDigest: string;
  readonly contributions: readonly NeutralHostContributionV1[];
}
export interface InstallDaemonClientV1 {
  ensureWorkspace(input: { readonly workspacePath: string; readonly create: boolean }): Promise<{ readonly workspaceId: string; readonly created: boolean }>;
  ensureRunning(input: { readonly workspaceId: string; readonly workspacePath: string }): Promise<void>;
  provisionOpaqueCredential(input: { readonly workspaceId: string; readonly hostId: InstallHostIdV1 }): Promise<{ readonly reference: string; readonly grantDigest: string }>;
  revokeOpaqueCredential(input: { readonly workspaceId: string; readonly hostId: InstallHostIdV1; readonly grantDigest: string }): Promise<void>;
  status(input: { readonly workspaceId: string }): Promise<{ readonly running: boolean; readonly bootstrapped: boolean }>;
}
export interface InstallRootsV1 { readonly stateRoot: string; readonly dataRoot: string; readonly discoveryRoots: Readonly<Record<InstallHostIdV1, string>>; }
export interface InstallRequestV1 {
  readonly bundle: NeutralInstallBundleV1;
  readonly roots: InstallRootsV1;
  readonly scope: InstallScopeV1;
  readonly workspacePath: string;
  readonly createWorkspace: boolean;
  readonly hosts: readonly InstallHostIdV1[] | "all";
  readonly acceptedReleaseDigest?: string;
  readonly interactiveAnswer?: string;
  readonly atomicHosts?: boolean;
  readonly daemon: InstallDaemonClientV1;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly accountId: string;
  readonly authorityTime: () => string;
  readonly crash?: (point: string) => void;
}
export interface HostInstallResultV1 { readonly hostId: InstallHostIdV1; readonly detection: HostDetectionV1; readonly installed: boolean; readonly code?: string; }
export interface InstallOperationResultV1 { readonly schema: "horseness.install-operation-result.v1"; readonly operation: string; readonly exitCode: InstallExitCodeV1; readonly releaseManifestDigest: string; readonly workspaceId: string | null; readonly hosts: readonly HostInstallResultV1[]; }
export class InstallerOperationError extends Error { constructor(readonly code: string, message = code) { super(message); this.name = "InstallerOperationError"; } }

const HEX = /^[0-9a-f]{64}$/u;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const RELATIVE = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,511}$/u;
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") { const object = value as Record<string, unknown>; return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`; }
  throw new InstallerOperationError("INVALID_BUNDLE_JSON");
}
function catalogCore(bundle: NeutralInstallBundleV1): unknown { return { releaseVersion: bundle.releaseVersion, releaseManifestDigest: bundle.releaseManifestDigest, authenticatedManifestKeyId: bundle.authenticatedManifestKeyId, authenticatedManifestSequence: bundle.authenticatedManifestSequence, contributions: bundle.contributions }; }
export function neutralCatalogDigestV1(bundle: Omit<NeutralInstallBundleV1, "catalogDigest">): string { return installerSha256(`horseness.neutral-install-catalog.v1\0${canonical(catalogCore(bundle as NeutralInstallBundleV1))}`); }
function confined(root: string, child: string): string {
  if (!RELATIVE.test(child) || isAbsolute(child) || child.split(/[\\/]/u).includes("..")) throw new InstallerOperationError("INSTALL_PATH_ESCAPE");
  const target = resolve(root, child); if (target !== resolve(root) && !target.startsWith(`${resolve(root)}${sep}`)) throw new InstallerOperationError("INSTALL_PATH_ESCAPE"); return target;
}
async function ensurePrivateRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new InstallerOperationError("INSTALL_ROOT_NOT_ABSOLUTE");
  await mkdir(path, { recursive: true, mode: 0o700 }); const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077) !== 0)) throw new InstallerOperationError("INSTALL_ROOT_NOT_PRIVATE");
  if (process.platform !== "win32") await chmod(path, 0o700); return realpath(path);
}
async function assertTargetRoot(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new InstallerOperationError("DISCOVERY_ROOT_NOT_ABSOLUTE");
  const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new InstallerOperationError("DISCOVERY_ROOT_UNSAFE");
  if (process.platform !== "win32" && info.uid !== process.getuid?.()) throw new InstallerOperationError("DISCOVERY_ROOT_WRONG_OWNER");
  return realpath(path);
}
function validateBundle(bundle: NeutralInstallBundleV1): void {
  if (bundle.schema !== "horseness.neutral-install-bundle.v1" || !VERSION.test(bundle.releaseVersion) || !HEX.test(bundle.releaseManifestDigest) || !HEX.test(bundle.catalogDigest) || !/^[A-Za-z0-9._:-]{3,128}$/u.test(bundle.authenticatedManifestKeyId) || !Number.isSafeInteger(bundle.authenticatedManifestSequence) || bundle.authenticatedManifestSequence < 1) throw new InstallerOperationError("INVALID_NEUTRAL_BUNDLE");
  if (neutralCatalogDigestV1(bundle) !== bundle.catalogDigest) throw new InstallerOperationError("NEUTRAL_CATALOG_DIGEST_MISMATCH");
  const ids = bundle.contributions.map((entry) => entry.hostId);
  if (ids.length !== 4 || ids.some((id, index) => id !== INSTALL_HOST_IDS_V1[index])) throw new InstallerOperationError("NEUTRAL_CATALOG_NOT_CLOSED_SORTED");
  for (const entry of bundle.contributions) {
    if (entry.discoveryRootId !== entry.hostId || !VERSION.test(entry.pinnedHostVersion) || !HEX.test(entry.packageDigest) || !HEX.test(entry.sourceArtifactDigest) || entry.files.length === 0) throw new InstallerOperationError("INVALID_NEUTRAL_CONTRIBUTION");
    let previous = "";
    for (const file of entry.files) {
      if (file.path <= previous || !RELATIVE.test(file.path) || file.path.split("/").includes("..") || !HEX.test(file.contentDigest) || !HEX.test(file.archiveDigest) || !HEX.test(file.memberDigest) || !Number.isSafeInteger(file.size) || file.size < 0 || ![0o600, 0o700].includes(file.mode)) throw new InstallerOperationError("INVALID_NEUTRAL_FILE");
      const bytes = Buffer.from(file.bytesBase64, "base64"); if (bytes.length !== file.size || installerSha256(bytes) !== file.contentDigest || file.memberDigest !== file.contentDigest) throw new InstallerOperationError("NEUTRAL_FILE_DIGEST_MISMATCH"); previous = file.path;
    }
  }
}
interface OwnerMarkerV1 { readonly schema: "horseness.install-owner.v1"; readonly scope: InstallScopeV1; readonly workspaceId: string; readonly accountId: string; readonly hostId: InstallHostIdV1; readonly releaseManifestDigest: string; readonly packageDigest: string; readonly sourceArtifactDigest: string; readonly target: string; readonly operationId: string; readonly grantDigest: string; }
async function writeAtomic(path: string, bytes: Uint8Array | string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); const temp = `${path}.stage-${process.pid}-${randomUUID()}`; const handle = await open(temp, "wx", mode);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path); const parent = await open(dirname(path), "r"); try { await parent.sync(); } finally { await parent.close(); }
}
async function readMarker(path: string): Promise<OwnerMarkerV1 | undefined> { try { return JSON.parse(await readFile(path, "utf8")) as OwnerMarkerV1; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function detect(entry: NeutralHostContributionV1, platform: NodeJS.Platform, arch: string, targetRoot: string): Promise<HostDetectionV1> {
  if (!entry.platforms.some((candidate) => candidate.platform === platform && candidate.arch === arch)) return "unsupported";
  const target = confined(targetRoot, entry.targetRelativePath); const marker = await readMarker(`${target}.horseness-owner.json`);
  try { const info = await lstat(target); if (info.isSymbolicLink()) return "managed-blocked"; return marker === undefined ? "managed-blocked" : "present-supported"; } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "failed"; }
}
async function stageManagedContribution(input: { entry: NeutralHostContributionV1; bundle: NeutralInstallBundleV1; root: string; dataRoot: string; scope: InstallScopeV1; workspaceId: string; accountId: string; grantDigest: string; operationId: string; crash?: (point: string) => void }): Promise<void> {
  const target = confined(input.root, input.entry.targetRelativePath); const markerPath = `${target}.horseness-owner.json`; const existing = await readMarker(markerPath);
  if (existing !== undefined) {
    if (existing.workspaceId !== input.workspaceId || existing.hostId !== input.entry.hostId || existing.accountId !== input.accountId) throw new InstallerOperationError("MANAGED_TARGET_BINDING_MISMATCH");
    let matches = existing.releaseManifestDigest === input.bundle.releaseManifestDigest;
    for (const file of input.entry.files) { try { matches &&= installerSha256(await readFile(confined(target, file.path))) === file.contentDigest; } catch { matches = false; } }
    if (matches) return; throw new InstallerOperationError("MANAGED_TARGET_DRIFT");
  }
  try { await lstat(target); throw new InstallerOperationError("UNMARKED_TARGET_EXISTS"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const bundleRoot = confined(input.dataRoot, `bundles/${input.bundle.releaseManifestDigest}/${input.entry.hostId}`); await rm(bundleRoot, { recursive: true, force: true }); await mkdir(bundleRoot, { recursive: true, mode: 0o700 });
  for (const file of input.entry.files) await writeAtomic(confined(bundleRoot, file.path), Buffer.from(file.bytesBase64, "base64"), file.mode);
  input.crash?.(`after-stage:${input.entry.hostId}`);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await rename(bundleRoot, target);
  input.crash?.(`after-activate:${input.entry.hostId}`);
  const marker: OwnerMarkerV1 = { schema: "horseness.install-owner.v1", scope: input.scope, workspaceId: input.workspaceId, accountId: input.accountId, hostId: input.entry.hostId, releaseManifestDigest: input.bundle.releaseManifestDigest, packageDigest: input.entry.packageDigest, sourceArtifactDigest: input.entry.sourceArtifactDigest, target, operationId: input.operationId, grantDigest: input.grantDigest };
  await writeAtomic(markerPath, `${canonical(marker)}\n`); await writeAtomic(join(input.dataRoot, "versions", `${input.bundle.releaseManifestDigest}.txt`), `${input.bundle.releaseVersion}\n`); input.crash?.(`after-marker:${input.entry.hostId}`);
}
function requestedHosts(input: InstallRequestV1): readonly InstallHostIdV1[] { const hosts = input.hosts === "all" ? INSTALL_HOST_IDS_V1 : [...new Set(input.hosts)]; if (hosts.length === 0 || hosts.some((host) => !INSTALL_HOST_IDS_V1.includes(host))) throw new InstallerOperationError("INVALID_HOST_SELECTION"); return hosts; }
export async function installNeutralBundleV1(request: InstallRequestV1): Promise<InstallOperationResultV1> {
  validateBundle(request.bundle); const hosts = requestedHosts(request);
  if (!isAbsolute(request.workspacePath)) throw new InstallerOperationError("WORKSPACE_PATH_REQUIRED_ABSOLUTE");
  const stateRoot = await ensurePrivateRoot(request.roots.stateRoot); const dataRoot = await ensurePrivateRoot(request.roots.dataRoot); const operationId = randomUUID(); const journal = await InstallerJournal.open(join(stateRoot, "journal"));
  let consent: InstallConsentV1;
  try { consent = createInstallConsentV1({ releaseManifestDigest: request.bundle.releaseManifestDigest, artifactDigests: request.bundle.contributions.map((entry) => entry.packageDigest), requestedHosts: hosts, executableCapabilities: ["native-host-contribution"], installScope: request.scope, osIdentity: { platform: request.platform ?? process.platform, arch: request.arch ?? process.arch, accountId: request.accountId }, acknowledgedAt: request.authorityTime(), ...(request.interactiveAnswer !== undefined ? { interactiveAnswer: request.interactiveAnswer } : request.acceptedReleaseDigest !== undefined ? { acceptedReleaseDigest: request.acceptedReleaseDigest } : {}) }); }
  catch (error) { return { schema: "horseness.install-operation-result.v1", operation: "install", exitCode: 4, releaseManifestDigest: request.bundle.releaseManifestDigest, workspaceId: null, hosts: hosts.map((hostId) => ({ hostId, detection: "failed", installed: false, code: error instanceof Error ? error.message : "CONSENT_REFUSED" })) }; }
  await writeAtomic(join(stateRoot, "consent", `${consent.consentDigest}.json`), `${canonical(consent)}\n`); await journal.append({ operation: "consent-recorded", transactionId: operationId, releaseVersion: request.bundle.releaseVersion, detailDigest: consent.consentDigest });
  const workspace = await request.daemon.ensureWorkspace({ workspacePath: request.workspacePath, create: request.createWorkspace }); await request.daemon.ensureRunning({ workspaceId: workspace.workspaceId, workspacePath: request.workspacePath });
  const results: HostInstallResultV1[] = []; const installed: { entry: NeutralHostContributionV1; root: string; grantDigest: string }[] = [];
  for (const hostId of hosts) {
    const entry = request.bundle.contributions.find((candidate) => candidate.hostId === hostId)!;
    try {
      const root = await assertTargetRoot(request.roots.discoveryRoots[hostId]); const detection = await detect(entry, request.platform ?? process.platform, request.arch ?? process.arch, root);
      if (detection === "unsupported" || detection === "managed-blocked" || detection === "failed") { results.push({ hostId, detection, installed: false, code: detection.toUpperCase() }); if (request.atomicHosts) throw new InstallerOperationError(detection.toUpperCase()); continue; }
      const credential = await request.daemon.provisionOpaqueCredential({ workspaceId: workspace.workspaceId, hostId });
      await stageManagedContribution({ entry, bundle: request.bundle, root, dataRoot, scope: request.scope, workspaceId: workspace.workspaceId, accountId: request.accountId, grantDigest: credential.grantDigest, operationId, ...(request.crash === undefined ? {} : { crash: request.crash }) });
      installed.push({ entry, root, grantDigest: credential.grantDigest }); results.push({ hostId, detection, installed: true });
    } catch (error) { results.push({ hostId, detection: "failed", installed: false, code: error instanceof InstallerOperationError ? error.code : "INSTALL_HOST_FAILED" }); if (request.atomicHosts) { for (const item of installed.reverse()) { await disableAndRemoveContributionV1({ entry: item.entry, root: item.root, workspaceId: workspace.workspaceId, accountId: request.accountId, daemon: request.daemon, grantDigest: item.grantDigest }); } break; } }
  }
  await journal.append({ operation: "activated", transactionId: operationId, releaseVersion: request.bundle.releaseVersion, detailDigest: createHash("sha256").update(canonical(results)).digest("hex") });
  const failed = results.filter((result) => !result.installed).length; return { schema: "horseness.install-operation-result.v1", operation: "install", exitCode: failed === 0 ? 0 : failed < results.length ? 3 : 1, releaseManifestDigest: request.bundle.releaseManifestDigest, workspaceId: workspace.workspaceId, hosts: Object.freeze(results) };
}
export async function disableAndRemoveContributionV1(input: { entry: NeutralHostContributionV1; root: string; workspaceId: string; accountId: string; daemon: InstallDaemonClientV1; grantDigest?: string; crash?: (point: string) => void }): Promise<void> {
  const target = confined(input.root, input.entry.targetRelativePath); const markerPath = `${target}.horseness-owner.json`; const marker = await readMarker(markerPath); if (marker === undefined) return;
  if (marker.workspaceId !== input.workspaceId || marker.accountId !== input.accountId || marker.hostId !== input.entry.hostId) throw new InstallerOperationError("MANAGED_TARGET_BINDING_MISMATCH");
  const killSwitch = `${markerPath}.kill-switch`; await writeAtomic(killSwitch, `${canonical({ schema: "horseness.install-kill-switch.v1", operationId: marker.operationId, hostId: marker.hostId })}\n`); input.crash?.("after-kill-switch");
  const disabled = `${target}.disabled-${marker.operationId}`; try { await rename(target, disabled); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } input.crash?.("after-discovery-disable");
  await input.daemon.revokeOpaqueCredential({ workspaceId: input.workspaceId, hostId: input.entry.hostId, grantDigest: input.grantDigest ?? marker.grantDigest }); input.crash?.("after-revocation");
  await rm(disabled, { recursive: true, force: true }); await rm(markerPath, { force: true }); await rm(killSwitch, { force: true });
}
interface LifecycleStateV1 { readonly schema: "horseness.install-lifecycle.v1"; readonly hostId: InstallHostIdV1; readonly transactionId: string; readonly operation: "upgrade" | "downgrade" | "rollback" | "retry-install"; readonly phase: "staging" | "staged" | "prior-retained" | "activated" | "healthy" | "compensating"; readonly requestedDigest: string; readonly requestedVersion: string; readonly priorDigest: string; readonly priorVersion: string; readonly target: string; readonly staged: string; readonly retained: string; }
function compareVersions(left: string, right: string): number { const parse = (value: string) => value.split("-", 1)[0]!.split(".").map(Number); const a = parse(left), b = parse(right); for (let index = 0; index < 3; index += 1) { const difference = (a[index] ?? 0) - (b[index] ?? 0); if (difference !== 0) return difference; } return left.localeCompare(right); }
async function pathExists(path: string): Promise<boolean> { try { await stat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function readLifecycle(path: string): Promise<LifecycleStateV1 | undefined> { try { return JSON.parse(await readFile(path, "utf8")) as LifecycleStateV1; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function verifyContributionBytes(entry: NeutralHostContributionV1, target: string): Promise<void> { for (const file of entry.files) if (installerSha256(await readFile(confined(target, file.path))) !== file.contentDigest) throw new InstallerOperationError("ACTIVATED_HEALTH_CHECK_FAILED"); }
async function stageGeneration(entry: NeutralHostContributionV1, staged: string): Promise<void> { await rm(staged, { recursive: true, force: true }); await mkdir(staged, { recursive: true, mode: 0o700 }); for (const file of entry.files) await writeAtomic(confined(staged, file.path), Buffer.from(file.bytesBase64, "base64"), file.mode); await verifyContributionBytes(entry, staged); }
async function operateHostLifecycle(operation: "upgrade" | "downgrade" | "rollback" | "retry-install", request: InstallRequestV1, entry: NeutralHostContributionV1, root: string, dataRoot: string, workspaceId: string, journal: InstallerJournal): Promise<void> {
  const target = confined(root, entry.targetRelativePath); const markerPath = `${target}.horseness-owner.json`; const existing = await readMarker(markerPath); if (existing === undefined) throw new InstallerOperationError("LIFECYCLE_REQUIRES_INSTALLED_GENERATION");
  if (existing.workspaceId !== workspaceId || existing.accountId !== request.accountId || existing.hostId !== entry.hostId) throw new InstallerOperationError("MANAGED_TARGET_BINDING_MISMATCH");
  const statePath = join(request.roots.stateRoot, "lifecycle", `${entry.hostId}.json`); let state = await readLifecycle(statePath);
  if (operation === "retry-install") { if (state === undefined || state.phase === "healthy") throw new InstallerOperationError("NO_INCOMPLETE_INSTALL"); if (state.requestedDigest !== request.bundle.releaseManifestDigest) throw new InstallerOperationError("RETRY_RELEASE_MISMATCH"); }
  if (state === undefined || operation !== "retry-install") {
    const comparison = compareVersions(request.bundle.releaseVersion, existing.releaseManifestDigest === request.bundle.releaseManifestDigest ? request.bundle.releaseVersion : (await readFile(join(request.roots.dataRoot, "versions", `${existing.releaseManifestDigest}.txt`), "utf8").catch(() => "0.0.0")).trim());
    if (operation === "upgrade" && comparison <= 0) throw new InstallerOperationError("UPGRADE_VERSION_NOT_NEWER");
    if (operation === "downgrade" && comparison >= 0) throw new InstallerOperationError("DOWNGRADE_VERSION_NOT_OLDER");
    const transactionId = randomUUID(); const staged = confined(dataRoot, `generations/${entry.hostId}/${request.bundle.releaseManifestDigest}.staged-${transactionId}`); const retained = confined(dataRoot, `generations/${entry.hostId}/${existing.releaseManifestDigest}`);
    state = { schema: "horseness.install-lifecycle.v1", hostId: entry.hostId, transactionId, operation, phase: "staging", requestedDigest: request.bundle.releaseManifestDigest, requestedVersion: request.bundle.releaseVersion, priorDigest: existing.releaseManifestDigest, priorVersion: (await readFile(join(request.roots.dataRoot, "versions", `${existing.releaseManifestDigest}.txt`), "utf8").catch(() => "0.0.0")).trim(), target, staged, retained }; await writeAtomic(statePath, `${canonical(state)}\n`); await journal.append({ operation: "migration-begun", transactionId, releaseVersion: request.bundle.releaseVersion, detailDigest: request.bundle.releaseManifestDigest });
  }
  const persist = async (phase: LifecycleStateV1["phase"]): Promise<void> => { state = { ...state!, phase }; await writeAtomic(statePath, `${canonical(state)}\n`); };
  try {
    if (state.phase === "staging") { await stageGeneration(entry, state.staged); await persist("staged"); await journal.append({ operation: "staged", transactionId: state.transactionId, releaseVersion: state.requestedVersion, detailDigest: state.requestedDigest }); request.crash?.(`lifecycle-after-stage:${entry.hostId}`); }
    if (state.phase === "staged") { if (await pathExists(state.retained)) await rm(state.retained, { recursive: true, force: true }); await mkdir(dirname(state.retained), { recursive: true, mode: 0o700 }); await rename(state.target, state.retained); await persist("prior-retained"); await journal.append({ operation: "backup-created", transactionId: state.transactionId, releaseVersion: state.priorVersion, detailDigest: state.priorDigest }); request.crash?.(`lifecycle-after-retain:${entry.hostId}`); }
    if (state.phase === "prior-retained") { await rename(state.staged, state.target); await persist("activated"); request.crash?.(`lifecycle-after-activate:${entry.hostId}`); }
    if (state.phase === "activated") { await verifyContributionBytes(entry, state.target); const credential = await request.daemon.provisionOpaqueCredential({ workspaceId, hostId: entry.hostId }); const marker: OwnerMarkerV1 = { schema: "horseness.install-owner.v1", scope: request.scope, workspaceId, accountId: request.accountId, hostId: entry.hostId, releaseManifestDigest: request.bundle.releaseManifestDigest, packageDigest: entry.packageDigest, sourceArtifactDigest: entry.sourceArtifactDigest, target: state.target, operationId: state.transactionId, grantDigest: credential.grantDigest }; await writeAtomic(markerPath, `${canonical(marker)}\n`); await writeAtomic(join(request.roots.dataRoot, "versions", `${request.bundle.releaseManifestDigest}.txt`), `${request.bundle.releaseVersion}\n`); await persist("healthy"); await journal.append({ operation: "activated", transactionId: state.transactionId, releaseVersion: state.requestedVersion, detailDigest: state.requestedDigest }); request.crash?.(`lifecycle-after-health:${entry.hostId}`); }
  } catch (error) {
    if (error instanceof Error && (error.message === "crash" || error.message.startsWith("INJECTED_CRASH:"))) throw error;
    await persist("compensating"); await journal.append({ operation: "compensating", transactionId: state.transactionId, releaseVersion: state.requestedVersion, detailDigest: state.requestedDigest }); if (await pathExists(state.target)) await rm(state.target, { recursive: true, force: true }); if (await pathExists(state.retained)) await rename(state.retained, state.target); await writeAtomic(markerPath, `${canonical(existing)}\n`); await rm(state.staged, { recursive: true, force: true }); await rm(statePath, { force: true }); await journal.append({ operation: "compensated", transactionId: state.transactionId, releaseVersion: state.priorVersion, detailDigest: state.priorDigest }); throw error;
  }
}
export async function operateNeutralBundleV1(operation: "upgrade" | "downgrade" | "rollback" | "retry-install", request: InstallRequestV1): Promise<InstallOperationResultV1> {
  validateBundle(request.bundle); const hosts = requestedHosts(request); const stateRoot = await ensurePrivateRoot(request.roots.stateRoot); const dataRoot = await ensurePrivateRoot(request.roots.dataRoot); const journal = await InstallerJournal.open(join(stateRoot, "journal")); const workspace = await request.daemon.ensureWorkspace({ workspacePath: request.workspacePath, create: request.createWorkspace }); await request.daemon.ensureRunning({ workspaceId: workspace.workspaceId, workspacePath: request.workspacePath }); const results: HostInstallResultV1[] = [];
  for (const hostId of hosts) { const entry = request.bundle.contributions.find((candidate) => candidate.hostId === hostId)!; try { const root = await assertTargetRoot(request.roots.discoveryRoots[hostId]); const detection = await detect(entry, request.platform ?? process.platform, request.arch ?? process.arch, root); if (detection === "unsupported") { results.push({ hostId, detection, installed: false, code: "UNSUPPORTED" }); continue; } await operateHostLifecycle(operation, request, entry, root, dataRoot, workspace.workspaceId, journal); results.push({ hostId, detection: "present-supported", installed: true }); } catch (error) { results.push({ hostId, detection: "failed", installed: false, code: error instanceof InstallerOperationError ? error.code : "LIFECYCLE_HOST_FAILED" }); } }
  const failed = results.filter((result) => !result.installed).length; return { schema: "horseness.install-operation-result.v1", operation, exitCode: failed === 0 ? 0 : failed < results.length ? 3 : 1, releaseManifestDigest: request.bundle.releaseManifestDigest, workspaceId: workspace.workspaceId, hosts: Object.freeze(results) };
}
export function defaultInstallRootsV1(input: { readonly scope: InstallScopeV1; readonly workspacePath: string; readonly home: string; readonly platform?: NodeJS.Platform; readonly env?: NodeJS.ProcessEnv }): InstallRootsV1 {
  const platform = input.platform ?? process.platform; const env = input.env ?? process.env;
  if (input.scope === "workspace") { const base = resolve(input.workspacePath, ".horseness", "install"); return { stateRoot: join(base, "state"), dataRoot: join(base, "data"), discoveryRoots: hostRoots(platform, input.home, env) }; }
  if (platform === "win32") { const local = env.LOCALAPPDATA; if (local === undefined || !isAbsolute(local)) throw new InstallerOperationError("LOCALAPPDATA_REQUIRED"); const base = join(local, "Horseness", "Install"); return { stateRoot: join(base, "state"), dataRoot: join(base, "data"), discoveryRoots: hostRoots(platform, input.home, env) }; }
  const stateBase = env.XDG_STATE_HOME ?? join(input.home, ".local", "state"); const dataBase = env.XDG_DATA_HOME ?? join(input.home, ".local", "share"); return { stateRoot: join(stateBase, "horseness", "install"), dataRoot: join(dataBase, "horseness", "install"), discoveryRoots: hostRoots(platform, input.home, env) };
}
function hostRoots(_platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): Readonly<Record<InstallHostIdV1, string>> { const absolute = (value: string | undefined, fallback: string) => value ?? fallback; return Object.freeze({ pi: absolute(env.PI_CODING_AGENT_HOME, join(home, ".pi", "agent")), omp: absolute(env.OMP_HOME, join(home, ".omp")), claude: absolute(env.CLAUDE_CONFIG_DIR, join(home, ".claude")), codex: absolute(env.CODEX_HOME, join(home, ".codex")) }); }
export function relativeManagedTargetV1(root: string, target: string): string { return relative(root, target); }
