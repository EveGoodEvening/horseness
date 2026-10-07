import { chmodSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Daemon, type DaemonConfigV1 } from "./index.js";

type OperationV1 = "start" | "bootstrap" | "init" | "restore-rebind";
interface EntryConfigV1 {
  readonly schemaVersion: "1";
  readonly operation: OperationV1;
  readonly daemon: Omit<DaemonConfigV1, "authorityTime">;
  readonly authorityTime: string;
  readonly grantReferenceFile?: string;
  readonly bootstrapSecretFile?: string;
  readonly resultFile?: string;
}

function protectedFile(path: string): string {
  const absolute = resolve(path);
  const leaf = lstatSync(absolute);
  const parent = lstatSync(dirname(absolute));
  if (!leaf.isFile() || leaf.isSymbolicLink() || (leaf.mode & 0o077) !== 0 || !parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0) throw new Error("protected file is invalid");
  if (realpathSync(absolute) !== absolute || realpathSync(dirname(absolute)) !== dirname(absolute)) throw new Error("protected file path is not canonical");
  if (process.platform !== "win32") {
    const uid = process.getuid?.();
    if (uid !== undefined && (leaf.uid !== uid || parent.uid !== uid)) throw new Error("protected file owner mismatch");
  }
  return readFileSync(absolute, "utf8").trim();
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function writeResult(path: string | undefined, value: unknown): void {
  if (path === undefined) throw new Error("result file is required");
  writeFileSync(resolve(path), `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(resolve(path), 0o600);
}

const configPath = resolve(argument("--config-file"));
const parsed = JSON.parse(protectedFile(configPath)) as EntryConfigV1;
rmSync(configPath, { force: true });
if (parsed.schemaVersion !== "1" || !["start", "bootstrap", "init", "restore-rebind"].includes(parsed.operation)) throw new Error("daemon entry config is invalid");
const config: DaemonConfigV1 = { ...parsed.daemon, authorityTime: () => new Date().toISOString() };

if (parsed.operation === "init") {
  if (parsed.grantReferenceFile === undefined || parsed.resultFile === undefined) throw new Error("init paths are required");
  const daemon = new Daemon(config);
  try {
    if (daemon.authority.replay(daemon.config.workspaceId, "workspace", daemon.config.workspaceId).length !== 0) throw new Error("existing workspace authority must not be reinitialized");
    const capability = daemon.createBootstrapCapability();
    const result = daemon.consumeBootstrapCapability(capability.secret);
    const head = daemon.authority.replay(result.workspaceId, "workspace", result.workspaceId).at(-1);
    if (head === undefined) throw new Error("workspace genesis was not persisted");
    writeFileSync(resolve(parsed.grantReferenceFile), `${result.grantReference}\n`, { mode: 0o600, flag: "wx" });
    writeResult(parsed.resultFile, { workspaceId: result.workspaceId, principalId: result.principalId, workspaceCursor: { schemaVersion: "1", kind: "workspace-only", workspaceId: result.workspaceId, workspaceSequence: head.envelope.sequence, workspaceEnvelopeHash: head.envelopeHash, workspaceContextEpoch: Math.max(0, head.envelope.sequence - 1) } });
  } finally { daemon.close(); }
} else if (parsed.operation === "bootstrap") {
  if (parsed.bootstrapSecretFile === undefined) throw new Error("bootstrap secret file is required");
  const daemon = new Daemon(config);
  try { writeResult(parsed.resultFile, daemon.consumeBootstrapCapability(protectedFile(parsed.bootstrapSecretFile))); }
  finally { daemon.close(); }
} else if (parsed.operation === "restore-rebind") {
  const daemon = Daemon.rebindRestored(config);
  try { writeResult(parsed.resultFile, { workspaceId: daemon.config.workspaceId }); }
  finally { daemon.close(); }
} else {
  if (parsed.grantReferenceFile === undefined) throw new Error("grant reference file is required");
  const daemon = new Daemon(config);
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    try { await daemon.stop(); daemon.close(); process.exitCode = 0; }
    catch (error) { process.stderr.write(`${error instanceof Error ? error.message : "daemon stop failed"}\n`); process.exitCode = 1; }
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  await daemon.start(protectedFile(parsed.grantReferenceFile));
  await new Promise<void>((resolveBeforeExit) => process.once("beforeExit", resolveBeforeExit));
}
