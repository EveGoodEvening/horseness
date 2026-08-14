import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InstallerJournal, InstallerJournalError, installerSha256 } from "../../src/journal/index.js";

const detailDigest = installerSha256("fixture-detail");

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
