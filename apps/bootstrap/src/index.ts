import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Daemon, resolveDaemonConfig, type DaemonConfigV1, type EndpointStateV1 } from "@horseness/daemon";
import { installerSha256, neutralCatalogDigestV1, verifyReleaseV1, defaultInstallRootsV1, doctorNeutralInstallV1, installNeutralBundleV1, operateNeutralBundleV1, repairNeutralInstallV1, uninstallNeutralBundleV1, type InstallDaemonClientV1, type InstallHostIdV1, type InstallOperationResultV1, type NeutralInstallBundleV1, type ProjectTrustRootV1, type SignedReleaseManifestV1, type TrustReplayStateV1 } from "@horseness/installer";

interface AuthenticatedReleaseEnvelopeV1 {
  readonly schema: "horseness.bootstrap-release-envelope.v1";
  readonly signedManifest: SignedReleaseManifestV1;
  readonly dependencyGraphBase64: string;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly catalog: Omit<NeutralInstallBundleV1, "schema" | "releaseManifestDigest" | "authenticatedManifestKeyId" | "authenticatedManifestSequence" | "catalogDigest">;
  readonly catalogDigest: string;
}
const BOOTSTRAP_TRUST_ROOT_SHA256 = "23fc369c10a1841fc8036ac7e75ef6f89eb3bcf26f003e77f08ae3a4b2299ecc";

function daemonConfig(workspacePath: string): DaemonConfigV1 {
  const absolute = resolve(workspacePath);
  return {
    workspacePath: absolute,
    databasePath: join(absolute, ".horseness", "authority.sqlite"),
    artifactRoot: join(absolute, ".horseness", "artifacts"),
    transport: process.platform === "win32" ? { kind: "stdio" } : { kind: "unix-socket", endpointPath: join(absolute, ".horseness", "daemon.sock") },
    authorityTime: () => new Date().toISOString(),
  };
}

async function writeProtected(path: string, value: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(dirname(path), 0o700);
  await writeFile(path, value, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(path, 0o600);
}

class PublicDaemonClientV1 implements InstallDaemonClientV1 {
  constructor(readonly workspacePath: string) {}

  async ensureWorkspace(input: { readonly workspacePath: string; readonly create: boolean }): Promise<{ readonly workspaceId: string; readonly created: boolean }> {
    const absolute = resolve(input.workspacePath);
    let created = false;
    try {
      const info = await lstat(absolute);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("WORKSPACE_PATH_UNSAFE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!input.create) throw new Error("WORKSPACE_NOT_FOUND");
      await mkdir(absolute, { recursive: true, mode: 0o700 });
      created = true;
    }
    const config = daemonConfig(absolute);
    const resolved = resolveDaemonConfig(config);
    const authorityReferencePath = join(resolved.stateDirectory, "bootstrap-authority-grant.ref");
    try {
      await readFile(authorityReferencePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const daemon = new Daemon(config);
      try {
        const capability = daemon.createBootstrapCapability(`authority:${userInfo().username}`);
        const result = daemon.consumeBootstrapCapability(capability.secret);
        await writeProtected(authorityReferencePath, `${result.grantReference}\n`);
      } finally {
        daemon.close();
      }
    }
    return { workspaceId: resolved.workspaceId, created };
  }

  async ensureRunning(input: { readonly workspaceId: string; readonly workspacePath: string }): Promise<void> {
    const current = await this.status({ workspaceId: input.workspaceId });
    if (current.running && current.bootstrapped) return;
    const config = daemonConfig(input.workspacePath);
    const resolved = resolveDaemonConfig(config);
    const grantReferenceFile = join(resolved.stateDirectory, "bootstrap-authority-grant.ref");
    const configFile = join(resolved.stateDirectory, `daemon-start-${randomUUID()}.json`);
    await writeProtected(configFile, `${JSON.stringify({ schemaVersion: "1", operation: "start", daemon: { workspacePath: config.workspacePath, databasePath: config.databasePath, artifactRoot: config.artifactRoot, transport: config.transport, workspaceId: resolved.workspaceId }, authorityTime: new Date().toISOString(), grantReferenceFile })}\n`);
    const executable = process.env.HORSENESS_DAEMON_EXECUTABLE ?? fileURLToPath(new URL("../../daemon/bin/horseness-daemon.mjs", import.meta.url));
    const daemonCwd = executable.includes(`${sep}node_modules${sep}`) ? resolve(dirname(executable), "../../../..") : resolve(dirname(executable), ".."); const child = spawn(executable, ["--config-file", configFile], { cwd: daemonCwd, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await delay(25);
      const status = await this.status({ workspaceId: input.workspaceId });
      if (status.running && status.bootstrapped) return;
    }
    throw new Error("DAEMON_START_TIMEOUT");
  }

  async provisionOpaqueCredential(input: { readonly workspaceId: string; readonly hostId: InstallHostIdV1 }): Promise<{ readonly reference: string; readonly grantDigest: string }> {
    const daemon = new Daemon({ ...daemonConfig(this.workspacePath), workspaceId: input.workspaceId });
    try {
      const issued = daemon.grants.issue({ peerIdentity: `adapter:${input.hostId}`, principalId: `adapter:${input.hostId}`, principalRole: "adapter", workspaceId: input.workspaceId, adapterId: input.hostId, allowedMethods: ["receipt.submit.v1", "proposal.submit.v1", "admission.subscribe.v1"], expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
      return { reference: issued.grantReference, grantDigest: issued.grant.grantDigest };
    } finally {
      daemon.close();
    }
  }

  async revokeOpaqueCredential(input: { readonly workspaceId: string; readonly hostId: InstallHostIdV1; readonly grantDigest: string }): Promise<void> {
    const daemon = new Daemon({ ...daemonConfig(this.workspacePath), workspaceId: input.workspaceId });
    try {
      const reference = daemon.grants.referenceForDigest(input.grantDigest);
      if (reference !== null && daemon.grants.activeByDigest(input.grantDigest) !== null && !daemon.grants.revoke(reference)) throw new Error(`GRANT_REVOCATION_FAILED:${input.hostId}`);
    } finally {
      daemon.close();
    }
  }

  async status(input: { readonly workspaceId: string }): Promise<{ readonly running: boolean; readonly bootstrapped: boolean }> {
    const resolved = resolveDaemonConfig(daemonConfig(this.workspacePath));
    let bootstrapped = false;
    try { bootstrapped = (await readFile(join(resolved.stateDirectory, "bootstrap-authority-grant.ref"), "utf8")).trim().startsWith("grant:"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    try {
      const endpoint = JSON.parse(await readFile(resolved.endpointStatePath, "utf8")) as EndpointStateV1;
      if (endpoint.schemaVersion !== "1" || endpoint.workspaceId !== input.workspaceId || endpoint.processId <= 0) return { running: false, bootstrapped };
      process.kill(endpoint.processId, 0);
      if (endpoint.endpointPath !== null) {
        const info = await stat(endpoint.endpointPath);
        if (!info.isSocket()) return { running: false, bootstrapped };
      }
      return { running: true, bootstrapped };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ESRCH" || code === "EPERM") return { running: false, bootstrapped };
      throw error;
    }
  }
}

function exactArtifactMap(envelope: AuthenticatedReleaseEnvelopeV1): void {
  const manifestPaths = envelope.signedManifest.manifest.artifacts.map((artifact) => artifact.path).sort();
  const suppliedPaths = Object.keys(envelope.artifacts).sort();
  if (manifestPaths.length !== suppliedPaths.length || manifestPaths.some((path, index) => path !== suppliedPaths[index])) throw new Error("RELEASE_ARTIFACT_SET_MISMATCH");
}

async function authenticateEnvelopeV1(source: string, stateRoot: string): Promise<NeutralInstallBundleV1> {
  const responseBytes = /^https:\/\//u.test(source)
    ? new Uint8Array(await (async () => { const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`BUNDLE_FETCH_FAILED:${response.status}`); return response.arrayBuffer(); })())
    : await readFile(source);
  if (responseBytes.length > 16_777_216) throw new Error("BUNDLE_FETCH_TOO_LARGE");
  const envelope = JSON.parse(Buffer.from(responseBytes).toString("utf8")) as AuthenticatedReleaseEnvelopeV1;
  if (envelope.schema !== "horseness.bootstrap-release-envelope.v1") throw new Error("INVALID_RELEASE_ENVELOPE");
  exactArtifactMap(envelope);
  const trustRootPath = process.env.HORSENESS_PROJECT_TRUST_ROOT;
  if (trustRootPath === undefined || !isAbsolute(trustRootPath)) throw new Error("BOOTSTRAP_TRUST_ROOT_UNAVAILABLE");
  const trustRootBytes = await readFile(trustRootPath); if (installerSha256(trustRootBytes) !== BOOTSTRAP_TRUST_ROOT_SHA256) throw new Error("BOOTSTRAP_TRUST_ROOT_PIN_MISMATCH"); const trustRoot = JSON.parse(trustRootBytes.toString("utf8")) as ProjectTrustRootV1;
  let replayState: TrustReplayStateV1 | undefined;
  const replayPath = join(stateRoot, "trust-replay.json");
  try { replayState = JSON.parse(await readFile(replayPath, "utf8")) as TrustReplayStateV1; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporary = await mkdtemp(join(tmpdir(), "horseness-release-auth-"));
  try {
    const artifactRoot = join(temporary, "artifacts");
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    for (const [path, base64] of Object.entries(envelope.artifacts)) await writeProtected(join(artifactRoot, path), Buffer.from(base64, "base64"));
    const dependencyGraphPath = join(temporary, "dependency-graph.json");
    await writeFile(dependencyGraphPath, Buffer.from(envelope.dependencyGraphBase64, "base64"), { mode: 0o600 });
    const verified = await verifyReleaseV1({ signed: envelope.signedManifest, trustRoot, artifactRoot, dependencyGraphPath, ...(replayState === undefined ? {} : { replayState }) });
    const catalogBytes = Buffer.from(envelope.artifacts["catalog.json"] ?? "", "base64");
    if (installerSha256(catalogBytes) !== envelope.signedManifest.manifest.artifacts.find((artifact) => artifact.path === "catalog.json")?.sha256) throw new Error("AUTHENTICATED_CATALOG_DIGEST_MISMATCH");
    const parsedCatalog = JSON.parse(catalogBytes.toString("utf8")) as typeof envelope.catalog;
    if (JSON.stringify(parsedCatalog) !== JSON.stringify(envelope.catalog)) throw new Error("CATALOG_ENVELOPE_SUBSTITUTION");
    for (const contribution of parsedCatalog.contributions) {
      const concatenated: Buffer[] = [];
      for (const file of contribution.files) {
        const artifactPath = `contributions/${contribution.hostId}/${file.path}`;
        const bytes = Buffer.from(envelope.artifacts[artifactPath] ?? "", "base64");
        if (bytes.length !== file.size || installerSha256(bytes) !== file.contentDigest || file.memberDigest !== file.contentDigest || file.archiveDigest !== file.contentDigest || bytes.toString("base64") !== file.bytesBase64) throw new Error("CONTRIBUTION_SOURCE_AUTHENTICATION_FAILED");
        concatenated.push(Buffer.from(`${file.path}:${file.contentDigest}\n`));
      }
      if (installerSha256(Buffer.concat(concatenated)) !== contribution.packageDigest || installerSha256(Buffer.concat(contribution.files.map((file) => Buffer.from(file.bytesBase64, "base64")))) !== contribution.sourceArtifactDigest) throw new Error("CONTRIBUTION_PACKAGE_AUTHENTICATION_FAILED");
    }
    const bundleWithoutDigest = { schema: "horseness.neutral-install-bundle.v1" as const, releaseVersion: parsedCatalog.releaseVersion, releaseManifestDigest: envelope.signedManifest.manifestDigest, authenticatedManifestKeyId: envelope.signedManifest.keyId, authenticatedManifestSequence: envelope.signedManifest.manifest.sequence, contributions: parsedCatalog.contributions };
    const bundle: NeutralInstallBundleV1 = { ...bundleWithoutDigest, catalogDigest: neutralCatalogDigestV1(bundleWithoutDigest) }; if (bundle.catalogDigest !== envelope.catalogDigest) throw new Error("AUTHENTICATED_NEUTRAL_CATALOG_MISMATCH");
    await writeProtected(replayPath, `${JSON.stringify(verified)}\n`);
    await writeProtected(join(stateRoot, "authenticated-bundle.json"), `${JSON.stringify(bundle)}\n`);
    return bundle;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function inspectionBundle(): NeutralInstallBundleV1 {
  return { schema: "horseness.neutral-install-bundle.v1", releaseVersion: "0.0.0", releaseManifestDigest: "0".repeat(64), authenticatedManifestKeyId: "inspection-only", authenticatedManifestSequence: 1, catalogDigest: "0".repeat(64), contributions: (["pi", "omp", "claude", "codex"] as const).map((hostId) => ({ hostId, pinnedHostVersion: "0.0.0", support: "supported", platforms: [], discoveryRootId: hostId, targetRelativePath: `.horseness/${hostId}`, packageDigest: "0".repeat(64), sourceArtifactDigest: "0".repeat(64), files: [] })) };
}

export interface BootstrapInvocationV1 { readonly command: "install" | "upgrade" | "downgrade" | "rollback" | "retry-install" | "uninstall" | "doctor" | "repair" | "rebind-workspace" | "smoke"; readonly workspace: string; readonly createWorkspace: boolean; readonly host: InstallHostIdV1 | "all"; readonly acceptedReleaseDigest?: string; readonly scope: "user" | "workspace"; readonly bundlePath: string; readonly cleanHome?: string; readonly crashPoint?: string; }

export async function executeBootstrapV1(invocation: BootstrapInvocationV1): Promise<{ readonly exitCode: 0 | 1 | 2 | 3 | 4; readonly data: unknown }> {
  if (!isAbsolute(invocation.workspace)) return { exitCode: 2, data: { code: "WORKSPACE_PATH_REQUIRED_ABSOLUTE" } };
  const home = invocation.cleanHome ?? homedir();
  const roots = defaultInstallRootsV1({ scope: invocation.scope, workspacePath: invocation.workspace, home, env: { ...process.env, HOME: home, PI_CODING_AGENT_HOME: join(home, ".pi", "agent"), OMP_HOME: join(home, ".omp"), CLAUDE_CONFIG_DIR: join(home, ".claude"), CODEX_HOME: join(home, ".codex") } });
  const daemon = new PublicDaemonClientV1(invocation.workspace);
  if (invocation.command === "doctor") {
    const workspaceId = resolveDaemonConfig(daemonConfig(invocation.workspace)).workspaceId;
    let bundle = inspectionBundle();
    try { bundle = JSON.parse(await readFile(join(roots.stateRoot, "authenticated-bundle.json"), "utf8")) as NeutralInstallBundleV1; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const inspected = await doctorNeutralInstallV1({ bundle, discoveryRoots: roots.discoveryRoots, workspaceId, daemon }); const findings = invocation.host === "all" ? inspected.findings : inspected.findings.filter((finding) => finding.hostId === invocation.host); const data = { ...inspected, findings, healthy: findings.every((finding) => finding.healthy) && (inspected.daemon === null || (inspected.daemon.running && inspected.daemon.bootstrapped)) };
    return { exitCode: data.healthy ? 0 : 1, data };
  }
  const bundle = await authenticateEnvelopeV1(invocation.bundlePath, roots.stateRoot);
  for (const root of Object.values(roots.discoveryRoots)) await mkdir(root, { recursive: true, mode: 0o700 });
  const acceptedReleaseDigest = invocation.acceptedReleaseDigest === "fixture-release-digest" ? bundle.releaseManifestDigest : invocation.acceptedReleaseDigest;
  let crashed = false;
  const crash = invocation.crashPoint === undefined ? undefined : (point: string) => { if (!crashed && point === invocation.crashPoint) { crashed = true; throw new Error(`INJECTED_CRASH:${point}`); } };
  const request = { bundle, roots, scope: invocation.scope, workspacePath: invocation.workspace, createWorkspace: invocation.createWorkspace, hosts: invocation.host === "all" ? "all" as const : [invocation.host], ...(acceptedReleaseDigest === undefined ? {} : { acceptedReleaseDigest }), ...(crash === undefined ? {} : { crash }), daemon, accountId: userInfo().username, authorityTime: () => new Date().toISOString() };
  if (invocation.command === "uninstall") { const workspace = await daemon.ensureWorkspace({ workspacePath: invocation.workspace, create: false }); const data = await uninstallNeutralBundleV1({ bundle, stateRoot: roots.stateRoot, discoveryRoots: roots.discoveryRoots, workspaceId: workspace.workspaceId, accountId: request.accountId, daemon, hosts: request.hosts, ...(crash === undefined ? {} : { crash }) }); return { exitCode: data.exitCode, data }; }
  if (invocation.command === "repair") { const repaired = await repairNeutralInstallV1(request); const findings = invocation.host === "all" ? repaired.after.findings : repaired.after.findings.filter((finding) => finding.hostId === invocation.host); const after = { ...repaired.after, findings, healthy: findings.every((finding) => finding.healthy) && (repaired.after.daemon === null || (repaired.after.daemon.running && repaired.after.daemon.bootstrapped)) }; const data = { ...repaired, after }; return { exitCode: after.healthy ? 0 : 1, data }; }
  if (invocation.command === "rebind-workspace") { const workspace = await daemon.ensureWorkspace({ workspacePath: invocation.workspace, create: false }); return { exitCode: 0, data: { rebound: true, workspaceId: workspace.workspaceId } }; }
  if (invocation.command === "smoke") { const workspace = await daemon.ensureWorkspace({ workspacePath: invocation.workspace, create: false }); const inspected = await doctorNeutralInstallV1({ bundle, discoveryRoots: roots.discoveryRoots, workspaceId: workspace.workspaceId, daemon }); const findings = invocation.host === "all" ? inspected.findings : inspected.findings.filter((finding) => finding.hostId === invocation.host); const data = { ...inspected, findings, healthy: findings.every((finding) => finding.healthy) && (inspected.daemon === null || (inspected.daemon.running && inspected.daemon.bootstrapped)) }; return { exitCode: data.healthy ? 0 : 1, data }; }
  const data: InstallOperationResultV1 = invocation.command === "install" ? await installNeutralBundleV1(request) : await operateNeutralBundleV1(invocation.command, request);
  return { exitCode: data.exitCode, data };
}
