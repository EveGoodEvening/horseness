import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InstallerJournal, InstallerJournalError, installerSha256 } from "../../src/journal/index.js";

const detailDigest = installerSha256("fixture-detail");
async function linuxIncarnation(processId: number): Promise<string> {
  const bytes = await readFile(`/proc/${processId}/stat`, "utf8");
  const commandEnd = bytes.lastIndexOf(")");
  assert.ok(commandEnd >= 2 && bytes[commandEnd + 1] === " ");
  const starttime = bytes.slice(commandEnd + 2).trim().split(/\s+/u)[19];
  assert.match(starttime ?? "", /^[0-9]+$/u);
  return `linux-proc-starttime:${starttime}`;
}

async function writeLockOwner(lockPath: string, processIncarnation: string): Promise<string> {
  const nonce = randomUUID();
  await mkdir(lockPath, { mode: 0o700 });
  await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({ schema: "horseness.installer-journal-lock-owner.v1", nonce, processId: process.pid, processIncarnation })}\n`, { mode: 0o600 });
  return nonce;
}


test("owner-private journal appends and authenticates a generation hash chain", async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-journal-"));
  try {
    const journal = await InstallerJournal.open(root);
    await journal.append({ operation: "migration-begun", transactionId: "tx-1", releaseVersion: "0.0.0-compat.1", detailDigest });
    await journal.append({ operation: "staged", transactionId: "tx-1", releaseVersion: "0.0.0", detailDigest });
    const records = await journal.read();
    assert.equal(records.length, 2);
    assert.equal(records[1]?.previousHash, records[0]?.recordHash);
    const path = join(root, "generation-1.jsonl");
    const bytes = await readFile(path, "utf8");
    await writeFile(path, bytes.replace("migration-begun", "migration-begun-tampered"), { mode: 0o600 });
    await assert.rejects(journal.read(), (error: unknown) => error instanceof InstallerJournalError && ["INVALID_JOURNAL_PAYLOAD", "JOURNAL_HASH_MISMATCH"].includes(error.code));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown newer journal schema refuses before any append", async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-journal-newer-"));
  try {
    const journal = await InstallerJournal.open(root);
    await writeFile(join(root, "generation-1.jsonl"), `${JSON.stringify({ schema: "horseness.installer-journal-record.v2" })}\n`, { mode: 0o600 });
    await assert.rejects(journal.append({ operation: "migration-begun", transactionId: "tx-2", releaseVersion: "1.0.0", detailDigest }), (error: unknown) => error instanceof InstallerJournalError && error.code === "UNKNOWN_NEWER_JOURNAL_SCHEMA");
    assert.match(await readFile(join(root, "generation-1.jsonl"), "utf8"), /record\.v2/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("N-1 record authenticates before upcast", async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-journal-v0-"));
  try {
    const core = { schema: "horseness.installer-journal-record.v0", generation: 1, sequence: 1, previousHash: "0".repeat(64), operation: "migration-begun", transactionId: "tx-v0", releaseVersion: "0.0.0-compat.1", detailDigest };
    const canonical = `{"detailDigest":"${detailDigest}","generation":1,"operation":"migration-begun","previousHash":"${"0".repeat(64)}","releaseVersion":"0.0.0-compat.1","schema":"horseness.installer-journal-record.v0","sequence":1,"transactionId":"tx-v0"}`;
    const record = { ...core, recordHash: installerSha256(`horseness.installer-journal-record\0${canonical}`) };
    await writeFile(join(root, "generation-1.jsonl"), `${JSON.stringify(record)}\n`, { mode: 0o600 });
    const [upcast] = await (await InstallerJournal.open(root)).read();
    assert.equal(upcast?.schema, "horseness.installer-journal-record.v1");
    assert.equal(upcast?.payload.operation, "migration-begun");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("journal append recovers an abandoned PID-reuse lock", async () => {
  if (process.platform !== "linux") return;
  const root = await mkdtemp(join(tmpdir(), "horseness-journal-stale-lock-"));
  try {
    const incarnation = await linuxIncarnation(process.pid);
    const starttime = BigInt(incarnation.slice("linux-proc-starttime:".length));
    await writeLockOwner(join(root, ".generation-1.lock"), `linux-proc-starttime:${starttime + 1n}`);
    const record = await (await InstallerJournal.open(root)).append({ operation: "staged", transactionId: "tx-stale", releaseVersion: "1.0.0", detailDigest });
    assert.equal(record.sequence, 1);
    await assert.rejects(stat(join(root, ".generation-1.lock")), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("journal append never steals a genuine live owner lock", async () => {
  if (process.platform !== "linux") return;
  const root = await mkdtemp(join(tmpdir(), "horseness-journal-live-lock-"));
  try {
    const lockPath = join(root, ".generation-1.lock");
    const nonce = await writeLockOwner(lockPath, await linuxIncarnation(process.pid));
    const journal = await InstallerJournal.open(root);
    await assert.rejects(journal.append({ operation: "staged", transactionId: "tx-live", releaseVersion: "1.0.0", detailDigest }), (error: unknown) => error instanceof InstallerJournalError && error.code === "JOURNAL_APPEND_LOCK_TIMEOUT");
    const owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as { nonce: string };
    assert.equal(owner.nonce, nonce);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("journal append fails closed on symlinked or non-private lock metadata", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "horseness-journal-unsafe-lock-"));
  try {
    const journal = await InstallerJournal.open(root);
    const target = join(root, "attacker-lock");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, join(root, ".generation-1.lock"));
    await assert.rejects(journal.append({ operation: "staged", transactionId: "tx-symlink", releaseVersion: "1.0.0", detailDigest }), (error: unknown) => error instanceof InstallerJournalError && error.code === "JOURNAL_LOCK_UNSAFE");
    await rm(join(root, ".generation-1.lock"));
    const lockPath = join(root, ".generation-1.lock");
    await writeLockOwner(lockPath, await linuxIncarnation(process.pid));
    await chmod(join(lockPath, "owner.json"), 0o644);
    await assert.rejects(journal.append({ operation: "staged", transactionId: "tx-mode", releaseVersion: "1.0.0", detailDigest }), (error: unknown) => error instanceof InstallerJournalError && error.code === "JOURNAL_LOCK_UNSAFE");
  } finally { await rm(root, { recursive: true, force: true }); }
});
