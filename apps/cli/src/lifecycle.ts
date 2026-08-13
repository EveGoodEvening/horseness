import { spawn, spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class CliLifecycleError extends Error {
  constructor(readonly code: "LIFECYCLE_ALREADY_RUNNING" | "LIFECYCLE_NOT_RUNNING" | "LIFECYCLE_SECRET_FILE_INVALID" | "LIFECYCLE_BOOTSTRAP_FAILED" | "LIFECYCLE_REBIND_FAILED" | "LIFECYCLE_START_FAILED", message: string) { super(message); this.name = "CliLifecycleError"; }
}

export interface CliDaemonPathsV1 {
  readonly workspacePath: string;
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly endpointPath: string;
  readonly workspaceId?: string;
  readonly daemonExecutable: string;
}
interface EndpointStateV1 { readonly schemaVersion: "1"; readonly workspaceId: string; readonly endpointPath: string | null; readonly processId: number; }
interface BootstrapResultV1 { readonly workspaceId: string; readonly principalId: string; readonly grantReference: string; readonly grantDigest: string; }

export function readProtectedSecretFileV1(path: string): string {
  const absolute = resolve(path);
  let leaf;
  try { leaf = lstatSync(absolute); } catch { throw new CliLifecycleError("LIFECYCLE_SECRET_FILE_INVALID", "protected secret file is unavailable"); }
  const parent = lstatSync(dirname(absolute));
  if (!leaf.isFile() || leaf.isSymbolicLink() || (leaf.mode & 0o077) !== 0 || realpathSync(absolute) !== absolute) throw new CliLifecycleError("LIFECYCLE_SECRET_FILE_INVALID", "protected secret file must be owner-only");
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || realpathSync(dirname(absolute)) !== dirname(absolute)) throw new CliLifecycleError("LIFECYCLE_SECRET_FILE_INVALID", "protected secret directory must be owner-only");
  if (process.platform !== "win32") { const uid = process.getuid?.(); if (uid !== undefined && (leaf.uid !== uid || parent.uid !== uid)) throw new CliLifecycleError("LIFECYCLE_SECRET_FILE_INVALID", "protected secret file owner mismatch"); }
  const value = readFileSync(absolute, "utf8").trim();
  if (value.length === 0) throw new CliLifecycleError("LIFECYCLE_SECRET_FILE_INVALID", "protected secret file is empty");
  return value;
}
export function protectSecretFileV1(path: string): void { chmodSync(resolve(path), 0o600); }
function delay(milliseconds: number): Promise<void> { return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)); }
function statePath(workspacePath: string): string { return resolve(workspacePath, ".horseness", "daemon-endpoint.v1.json"); }
function discover(path: string, expectedWorkspaceId?: string): EndpointStateV1 {
  const absolute = resolve(path); const leaf = lstatSync(absolute); const parent = lstatSync(dirname(absolute));
  if (!leaf.isFile() || leaf.isSymbolicLink() || (leaf.mode & 0o777) !== 0o600 || !parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0 || realpathSync(absolute) !== absolute || realpathSync(dirname(absolute)) !== dirname(absolute)) throw new Error("endpoint state permissions invalid");
  if (process.platform !== "win32") { const uid = process.getuid?.(); if (uid !== undefined && (leaf.uid !== uid || parent.uid !== uid)) throw new Error("endpoint state owner mismatch"); }
  const value = JSON.parse(readFileSync(absolute, "utf8")) as EndpointStateV1;
  if (value.schemaVersion !== "1" || typeof value.workspaceId !== "string" || (value.endpointPath !== null && typeof value.endpointPath !== "string") || !Number.isSafeInteger(value.processId) || (expectedWorkspaceId !== undefined && value.workspaceId !== expectedWorkspaceId)) throw new Error("endpoint state invalid");
  return value;
}
function daemonConfig(paths: CliDaemonPathsV1): Omit<CliDaemonPathsV1, "daemonExecutable"> & { transport: { kind: "unix-socket"; endpointPath: string } } {
  return { workspacePath: resolve(paths.workspacePath), databasePath: resolve(paths.databasePath), artifactRoot: resolve(paths.artifactRoot), endpointPath: resolve(paths.endpointPath), transport: { kind: "unix-socket", endpointPath: resolve(paths.endpointPath) }, ...(paths.workspaceId === undefined ? {} : { workspaceId: paths.workspaceId }) };
}
function configFile(paths: CliDaemonPathsV1, operation: "start" | "bootstrap" | "restore-rebind", authorityTime: () => string, extras: Record<string, string>): string {
  const directory = resolve(paths.workspacePath, ".horseness"); mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const path = resolve(directory, `daemon-entry.${process.pid}.${operation}.json`);
  const { endpointPath: _endpointPath, ...daemon } = daemonConfig(paths);
  writeFileSync(path, JSON.stringify({ schemaVersion: "1", operation, daemon, authorityTime: authorityTime(), ...extras }), { mode: 0o600, flag: "wx" });
  return path;
}
function runDaemonOperation(paths: CliDaemonPathsV1, operation: "bootstrap" | "restore-rebind", authorityTime: () => string, extras: Record<string, string>, code: "LIFECYCLE_BOOTSTRAP_FAILED" | "LIFECYCLE_REBIND_FAILED"): unknown {
  const resultFile = resolve(paths.workspacePath, ".horseness", `daemon-result.${process.pid}.${operation}.json`); const path = configFile(paths, operation, authorityTime, { ...extras, resultFile });
  const result = spawnSync(resolve(paths.daemonExecutable), ["--config-file", path], { encoding: "utf8", env: process.env }); rmSync(path, { force: true });
  if (result.status !== 0) { rmSync(resultFile, { force: true }); throw new CliLifecycleError(code, operation === "bootstrap" ? "daemon bootstrap failed" : "workspace rebind failed"); }
  try { return JSON.parse(readProtectedSecretFileV1(resultFile)); } finally { rmSync(resultFile, { force: true }); }
}
export async function startDaemonV1(paths: CliDaemonPathsV1, grantReferenceFile: string, authorityTime: () => string): Promise<{ workspaceId: string; endpointPath: string; processId: number }> {
  readProtectedSecretFileV1(grantReferenceFile);
  try { const active = discover(statePath(paths.workspacePath), paths.workspaceId); process.kill(active.processId, 0); throw new CliLifecycleError("LIFECYCLE_ALREADY_RUNNING", "daemon is already running for this workspace"); } catch (error) { if (error instanceof CliLifecycleError) throw error; }
  const path = configFile(paths, "start", authorityTime, { grantReferenceFile: resolve(grantReferenceFile) });
  const child = spawn(resolve(paths.daemonExecutable), ["--config-file", path], { detached: true, stdio: "ignore", env: process.env }); child.unref();
  if (child.pid === undefined) { rmSync(path, { force: true }); throw new CliLifecycleError("LIFECYCLE_START_FAILED", "daemon process did not start"); }
  for (let attempt = 0; attempt < 100; attempt += 1) { try { const state = discover(statePath(paths.workspacePath), paths.workspaceId); if (state.processId !== child.pid) throw new Error("process binding mismatch"); return { workspaceId: state.workspaceId, endpointPath: state.endpointPath ?? paths.endpointPath, processId: state.processId }; } catch { try { process.kill(child.pid, 0); } catch { rmSync(path, { force: true }); throw new CliLifecycleError("LIFECYCLE_START_FAILED", "daemon process exited before readiness"); } await delay(25); } }
  process.kill(child.pid, "SIGTERM"); throw new CliLifecycleError("LIFECYCLE_START_FAILED", "daemon readiness timed out");
}
export async function stopDaemonV1(workspacePath: string, expectedWorkspaceId?: string): Promise<void> {
  let state; try { state = discover(statePath(workspacePath), expectedWorkspaceId); } catch { throw new CliLifecycleError("LIFECYCLE_NOT_RUNNING", "daemon endpoint state is unavailable or unauthenticated"); }
  try { process.kill(state.processId, "SIGTERM"); } catch { throw new CliLifecycleError("LIFECYCLE_NOT_RUNNING", "daemon process is not running"); }
  for (let attempt = 0; attempt < 100; attempt += 1) { try { process.kill(state.processId, 0); } catch { return; } await delay(25); }
  throw new CliLifecycleError("LIFECYCLE_NOT_RUNNING", "daemon did not stop cleanly");
}
export function bootstrapDaemonV1(paths: CliDaemonPathsV1, capabilityFile: string, authorityTime: () => string): BootstrapResultV1 { return runDaemonOperation(paths, "bootstrap", authorityTime, { bootstrapSecretFile: resolve(capabilityFile) }, "LIFECYCLE_BOOTSTRAP_FAILED") as BootstrapResultV1; }
export function rebindRestoredWorkspaceV1(paths: CliDaemonPathsV1, authorityTime: () => string): { workspaceId: string } { try { discover(statePath(paths.workspacePath)); throw new CliLifecycleError("LIFECYCLE_ALREADY_RUNNING", "stop daemon before restore rebind"); } catch (error) { if (error instanceof CliLifecycleError) throw error; } return runDaemonOperation(paths, "restore-rebind", authorityTime, {}, "LIFECYCLE_REBIND_FAILED") as { workspaceId: string }; }
