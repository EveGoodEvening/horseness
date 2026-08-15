import assert from "node:assert/strict";
import test from "node:test";
import { runCommand } from "./process-helper.mjs";

const daemonIdentityProbe = String.raw`
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverDaemonEndpoint } from "@horseness/daemon";

const root = mkdtempSync(join(tmpdir(), "horseness-c21-endpoint-"));
const state = join(root, "daemon-endpoint.v1.json");
mkdirSync(root, { recursive: true, mode: 0o700 });
chmodSync(root, 0o700);
writeFileSync(state, JSON.stringify({ schemaVersion: "1", workspaceId: "ws-stale", transport: "stdio", endpointPath: null, processId: process.pid, startedAt: "1970-01-01T00:00:00.000Z" }), { mode: 0o600 });

let rejected = false;
try {
  discoverDaemonEndpoint(state, "ws-stale");
} catch {
  rejected = true;
}
if (!rejected) throw new Error("STALE_ENDPOINT_PID_REUSE_NOT_REJECTED");
`;

const abandonedInstallerLockProbe = String.raw`
import { mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallerJournal, installerSha256 } from "@horseness/installer";

const root = await mkdtemp(join(tmpdir(), "horseness-c21-lock-"));
try {
  const journal = await InstallerJournal.open(root);
  const stat = await readFile("/proc/" + process.pid + "/stat", "utf8");
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 2 || stat[commandEnd + 1] !== " ") throw new Error("PROCESS_INCARNATION_UNREADABLE");
  const starttime = stat.slice(commandEnd + 2).trim().split(/\s+/u)[19];
  if (starttime === undefined || !/^[0-9]+$/u.test(starttime)) throw new Error("PROCESS_INCARNATION_UNREADABLE");
  const lockPath = join(root, ".generation-1.lock");
  await mkdir(lockPath, { mode: 0o700 });
  const ownerHandle = await open(join(lockPath, "owner.json"), "wx", 0o600);
  try {
    await ownerHandle.writeFile(JSON.stringify({ schema: "horseness.installer-journal-lock-owner.v1", nonce: randomUUID(), processId: process.pid, processIncarnation: "linux-proc-starttime:" + (BigInt(starttime) + 1n) }) + "\n", "utf8");
    await ownerHandle.sync();
  } finally {
    await ownerHandle.close();
  }
  const lockDirectory = await open(lockPath, "r");
  try { await lockDirectory.sync(); } finally { await lockDirectory.close(); }
  const rootDirectory = await open(root, "r");
  try { await rootDirectory.sync(); } finally { await rootDirectory.close(); }
  await journal.append({ operation: "migration-begun", transactionId: "abandoned-lock", releaseVersion: "1.0.0", detailDigest: installerSha256("recovery") });
  const records = await journal.read(1);
  if (records.length !== 1) throw new Error("ABANDONED_INSTALLER_LOCK_RECOVERY_LOST_APPEND");
} finally {
  await rm(root, { recursive: true, force: true });
}
`;

async function runProbe(packageName, source) {
  const args = [
    "pnpm",
    "--filter",
    packageName,
    "exec",
    "node",
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    source,
  ];
  return runCommand("corepack", args, { timeoutMs: 20_000 });
}

test("daemon discovery rejects a stale endpoint whose live PID belongs to another process incarnation", { timeout: 30_000 }, async () => {
  const result = await runProbe("@horseness/daemon", daemonIdentityProbe);
  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test("installer journal reclaims an abandoned lock and completes the durable append", { timeout: 30_000 }, async () => {
  const result = await runProbe("@horseness/installer", abandonedInstallerLockProbe);
  assert.equal(result.code, 0, result.stderr || result.stdout);
});
