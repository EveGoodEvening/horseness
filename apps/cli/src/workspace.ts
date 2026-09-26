import { randomUUID } from "node:crypto";
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CoordinatorClientV1, type CoordinatorCallV1, type CoordinatorCursorV1 } from "@horseness/sdk";
import type { JsonValue } from "./result.js";
import type { CliInvocationV1 } from "./registry.js";
import { AuthorizedLocalTransportV1 } from "./transport.js";
import { CliLifecycleError, initializeDaemonAuthorityV1, readProtectedSecretFileV1, resolveDaemonExecutableV1, startDaemonV1, type CliDaemonPathsV1 } from "./lifecycle.js";

export interface CliWorkspaceV1 {
  readonly schemaVersion: "1";
  readonly workspacePath: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly endpointPath: string;
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly daemonExecutable: string;
  readonly grantReferenceFile: string;
  readonly workspaceCursor: Extract<CoordinatorCursorV1<"workspace.get.v1">, { kind: "workspace-only" }>;
  readonly currentRunId: string | null;
  readonly runs: Readonly<Record<string, Extract<CoordinatorCursorV1<"run.get.v1">, { kind: "composite" }>>>;
  readonly pending: null | { readonly command: "run create" | "task add"; readonly title: string; readonly runId: string; readonly taskId?: string; readonly call: CoordinatorCallV1 };
}
export interface CliWorkspaceSessionV1 {
  readonly state: CliWorkspaceV1;
  readonly client: CoordinatorClientV1;
  save(next: CliWorkspaceV1): void;
}
export class CliWorkspaceErrorV1 extends Error {
  constructor(readonly code: "WORKSPACE_NOT_INITIALIZED" | "WORKSPACE_STATE_INVALID" | "WORKSPACE_BUSY" | "WORKSPACE_INIT_FAILED" | "WORKSPACE_OPTION_INVALID", message: string) { super(message); this.name = "CliWorkspaceErrorV1"; }
}
const DIRECTORY = ".horseness";
const STATE = "cli-workspace.v1.json";
const GRANT = "cli-grant-reference.v1";
const LOCK = "cli-workspace.v1.lock";
function fail(code: CliWorkspaceErrorV1["code"], message: string): never { throw new CliWorkspaceErrorV1(code, message); }
function option(invocation: CliInvocationV1, name: string): string | undefined {
  const value = invocation.options[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return fail("WORKSPACE_OPTION_INVALID", `--${name} requires a nonempty path`);
  return value;
}
function canonicalWorkspace(path: string): string {
  try { const canonical = realpathSync(resolve(path)); if (!lstatSync(canonical).isDirectory()) return fail("WORKSPACE_OPTION_INVALID", "workspace path must be an existing directory"); return canonical; }
  catch (error) { if (error instanceof CliWorkspaceErrorV1) throw error; return fail("WORKSPACE_OPTION_INVALID", "workspace path must be an existing directory"); }
}
function stateDirectory(root: string): string { return join(root, DIRECTORY); }
function entryExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
function assertDirectory(root: string): void {
  const directory = stateDirectory(root);
  let stats;
  try { stats = lstatSync(directory); } catch { return fail("WORKSPACE_NOT_INITIALIZED", `no initialized workspace at ${root}; run horseness init`); }
  if (!stats.isDirectory() || stats.isSymbolicLink() || realpathSync(directory) !== directory || (stats.mode & 0o777) !== 0o700 || (process.getuid?.() !== undefined && stats.uid !== process.getuid())) return fail("WORKSPACE_STATE_INVALID", ".horseness must be a private owner-only directory, not a symlink");
}
function assertFile(path: string): void {
  assertDirectory(dirname(dirname(path)));
  let stats;
  try { stats = lstatSync(path); } catch { return fail("WORKSPACE_STATE_INVALID", `workspace state file is missing: ${path}; do not reinitialize an incomplete workspace`); }
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600 || realpathSync(path) !== path || (process.getuid?.() !== undefined && stats.uid !== process.getuid())) return fail("WORKSPACE_STATE_INVALID", `workspace state file must be owner-only and not a symlink: ${path}`);
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !value.includes("\0"); }
function cursor(value: unknown, rootId: string, runId?: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.schemaVersion !== "1" || c.workspaceId !== rootId || c.kind !== (runId === undefined ? "workspace-only" : "composite") || !Number.isSafeInteger(c.workspaceSequence) || (c.workspaceSequence as number) < 1 || !nonempty(c.workspaceEnvelopeHash) || !Number.isSafeInteger(c.workspaceContextEpoch) || (c.workspaceContextEpoch as number) < 0) return false;
  return runId === undefined || (c.runId === runId && Number.isSafeInteger(c.runSequence) && (c.runSequence as number) >= 1 && nonempty(c.runEnvelopeHash) && Number.isSafeInteger(c.runContextEpoch) && (c.runContextEpoch as number) >= 0);
}
function validate(state: CliWorkspaceV1, root: string): void {
  if (typeof state !== "object" || state === null || state.schemaVersion !== "1" || state.workspacePath !== root || !nonempty(state.workspaceId) || !nonempty(state.principalId) || !nonempty(state.daemonExecutable) || state.endpointPath !== join(root, DIRECTORY, "daemon.sock") || state.databasePath !== join(root, DIRECTORY, "authority.sqlite") || state.artifactRoot !== join(root, DIRECTORY, "artifacts") || state.grantReferenceFile !== join(root, DIRECTORY, GRANT) || !cursor(state.workspaceCursor, state.workspaceId)) return fail("WORKSPACE_STATE_INVALID", "workspace metadata binding is invalid; do not reinitialize this workspace");
  if (typeof state.runs !== "object" || state.runs === null || Array.isArray(state.runs) || !Object.entries(state.runs).every(([id, value]) => nonempty(id) && cursor(value, state.workspaceId, id)) || (state.currentRunId !== null && (!nonempty(state.currentRunId) || !Object.hasOwn(state.runs, state.currentRunId)))) return fail("WORKSPACE_STATE_INVALID", "saved run context is invalid");
  const pending = state.pending;
  if (pending !== null && (typeof pending !== "object" || !["run create", "task add"].includes(pending.command) || !nonempty(pending.title) || !nonempty(pending.runId) || (pending.command === "task add" && !nonempty(pending.taskId)) || !pending.call || pending.call.workspaceId !== state.workspaceId || pending.call.runId !== pending.runId || pending.call.method !== (pending.command === "run create" ? "run.create.v1" : "task.create.v1") || !nonempty(pending.call.idempotencyKey) || (pending.command === "run create" ? !(pending.call.observationCursor.kind === "absent-run-genesis" && pending.call.observationCursor.runId === pending.runId && pending.call.observationCursor.expectedRunHead === "absent" && cursor({ ...pending.call.observationCursor, kind: "workspace-only" }, state.workspaceId)) : !cursor(pending.call.observationCursor, state.workspaceId, pending.runId)))) return fail("WORKSPACE_STATE_INVALID", "pending request binding is invalid");
}
function readState(root: string): CliWorkspaceV1 {
  const path = join(stateDirectory(root), STATE);
  assertFile(path);
  let state: CliWorkspaceV1;
  try { state = JSON.parse(readFileSync(path, "utf8")) as CliWorkspaceV1; } catch { return fail("WORKSPACE_STATE_INVALID", "workspace metadata is not valid JSON"); }
  validate(state, root);
  assertFile(state.grantReferenceFile);
  return state;
}
function discover(invocation: CliInvocationV1, init: boolean): string {
  const explicit = option(invocation, "workspace");
  const start = canonicalWorkspace(explicit ?? process.cwd());
  if (init || explicit !== undefined) return start;
  for (let root = start; ; root = dirname(root)) {
    if (entryExists(stateDirectory(root))) { assertDirectory(root); return root; }
    if (dirname(root) === root) break;
  }
  return fail("WORKSPACE_NOT_INITIALIZED", "no initialized workspace found in this directory or its ancestors; run horseness init or pass --workspace PATH");
}
async function lockWorkspace<T>(root: string, callback: () => Promise<T>): Promise<T> {
  assertDirectory(root);
  const path = join(stateDirectory(root), LOCK);
  if (entryExists(path)) {
    assertFile(path);
    const owner = Number(readFileSync(path, "utf8"));
    if (!Number.isSafeInteger(owner) || owner < 1) return fail("WORKSPACE_BUSY", "workspace lock is incomplete; inspect .horseness/cli-workspace.v1.lock before proceeding");
    try { process.kill(owner, 0); return fail("WORKSPACE_BUSY", "another workspace command is active; retry when it completes"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    return fail("WORKSPACE_BUSY", "the previous command exited; remove only .horseness/cli-workspace.v1.lock after confirming no workspace command is active, then repeat the saved command");
  }
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return fail("WORKSPACE_BUSY", "another workspace command is active; retry when it completes"); throw error; }
  try { writeFileSync(descriptor, String(process.pid)); return await callback(); }
  finally { closeSync(descriptor); rmSync(path); }
}
function saveState(next: CliWorkspaceV1, root: string): void {
  validate(next, root);
  const path = join(stateDirectory(root), STATE);
  if (entryExists(path)) assertFile(path);
  const temporary = join(stateDirectory(root), `.cli-workspace.${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(descriptor, `${JSON.stringify(next)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  try { renameSync(temporary, path); const directory = openSync(stateDirectory(root), constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(directory); } finally { closeSync(directory); } }
  finally { if (entryExists(temporary)) rmSync(temporary); }
}
function paths(state: CliWorkspaceV1): CliDaemonPathsV1 { return { workspacePath: state.workspacePath, databasePath: state.databasePath, artifactRoot: state.artifactRoot, endpointPath: state.endpointPath, workspaceId: state.workspaceId, daemonExecutable: state.daemonExecutable }; }
function client(state: CliWorkspaceV1): CoordinatorClientV1 {
  const reference = readProtectedSecretFileV1(state.grantReferenceFile);
  if (!/^grant:[A-Za-z0-9-]+$/u.test(reference)) return fail("WORKSPACE_STATE_INVALID", "workspace grant reference is invalid");
  return new CoordinatorClientV1(new AuthorizedLocalTransportV1(state.endpointPath), { schemaVersion: "1", kind: "host-reference", reference, scope: { workspaceId: state.workspaceId, adapterId: "cli", purpose: "workspace" } });
}
export async function withCliWorkspaceV1<T>(invocation: CliInvocationV1, callback: (session: CliWorkspaceSessionV1) => Promise<T>): Promise<T> {
  const root = discover(invocation, false);
  return lockWorkspace(root, async () => {
    let state = readState(root);
    const session: CliWorkspaceSessionV1 = { get state() { return state; }, client: client(state), save(next) { saveState(next, root); state = next; } };
    return callback(session);
  });
}
export async function initializeCliWorkspaceV1(invocation: CliInvocationV1, authorityTime: () => string): Promise<JsonValue> {
  const root = discover(invocation, true);
  if (option(invocation, "workspace") === undefined) {
    for (let parent = dirname(root); parent !== root; parent = dirname(parent)) {
      if (entryExists(stateDirectory(parent))) return fail("WORKSPACE_INIT_FAILED", `already inside workspace ${parent}; initialize from its root or pass --workspace PATH explicitly`);
      if (dirname(parent) === parent) break;
    }
  }
  const directory = stateDirectory(root);
  if (!entryExists(directory)) mkdirSync(directory, { mode: 0o700 });
  assertDirectory(root);
  return lockWorkspace(root, async () => {
    const statePath = join(directory, STATE);
    if (entryExists(statePath)) {
      const state = readState(root);
      const executable = option(invocation, "daemon-executable");
      if (executable !== undefined && resolveDaemonExecutableV1(executable) !== state.daemonExecutable) return fail("WORKSPACE_STATE_INVALID", "daemon executable differs from initialized workspace; inspect the workspace before proceeding");
      try { await startDaemonV1(paths(state), state.grantReferenceFile, authorityTime); }
      catch (error) { if (!(error instanceof CliLifecycleError && error.code === "LIFECYCLE_ALREADY_RUNNING")) throw error; }
      await client(state).call({ method: "workspace.get.v1", workspaceId: state.workspaceId, observationCursor: state.workspaceCursor, input: { schemaVersion: "1", queryType: "GetWorkspaceV1", observationCursor: state.workspaceCursor } });
      return { workspaceId: state.workspaceId, workspacePath: root, created: false };
    }
    if (readdirSync(directory).some((name) => name !== LOCK)) return fail("WORKSPACE_STATE_INVALID", "existing .horseness state is incomplete or foreign; inspect it instead of initializing a new authority");
    const daemonExecutable = resolveDaemonExecutableV1(option(invocation, "daemon-executable") ?? process.env.HORSENESS_DAEMON_EXECUTABLE ?? "horseness-daemon");
    const base = { workspacePath: root, databasePath: join(directory, "authority.sqlite"), artifactRoot: join(directory, "artifacts"), endpointPath: join(directory, "daemon.sock"), daemonExecutable };
    const grantReferenceFile = join(directory, GRANT);
    const created = initializeDaemonAuthorityV1(base, grantReferenceFile, authorityTime);
    const state: CliWorkspaceV1 = { schemaVersion: "1", ...base, workspaceId: created.workspaceId, principalId: created.principalId, grantReferenceFile, workspaceCursor: created.workspaceCursor, currentRunId: null, runs: {}, pending: null };
    saveState(state, root);
    await startDaemonV1(paths(state), grantReferenceFile, authorityTime);
    return { workspaceId: state.workspaceId, workspacePath: root, created: true };
  });
}
