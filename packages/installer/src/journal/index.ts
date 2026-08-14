import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { dirname, join, resolve } from "node:path";

export type JournalOperationV1 =
  | "consent-recorded"
  | "migration-begun"
  | "backup-created"
  | "staged"
  | "activated"
  | "compensating"
  | "compensated"
  | "repair-required"
  | "uninstall-pending"
  | "uninstalled";

export interface InstallerJournalPayloadV1 {
  readonly operation: JournalOperationV1;
  readonly transactionId: string;
  readonly releaseVersion: string;
  readonly detailDigest: string;
}

export interface InstallerJournalRecordV1 {
  readonly schema: "horseness.installer-journal-record.v1";
  readonly generation: number;
  readonly sequence: number;
  readonly previousHash: string;
  readonly payload: InstallerJournalPayloadV1;
  readonly recordHash: string;
}

interface InstallerJournalRecordV0 {
  readonly schema: "horseness.installer-journal-record.v0";
  readonly generation: number;
  readonly sequence: number;
  readonly previousHash: string;
  readonly operation: JournalOperationV1;
  readonly transactionId: string;
  readonly releaseVersion: string;
  readonly detailDigest: string;
  readonly recordHash: string;
}

export class InstallerJournalError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = "InstallerJournalError";
  }
}

const HEX = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const OPERATIONS: Readonly<Record<JournalOperationV1, true>> = Object.freeze({
  "consent-recorded": true, "migration-begun": true, "backup-created": true, staged: true, activated: true,
  compensating: true, compensated: true, "repair-required": true, "uninstall-pending": true, uninstalled: true,
});

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  throw new InstallerJournalError("INVALID_JSON");
}

export function installerSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactObject(value: unknown, keys: readonly string[], code: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InstallerJournalError(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new InstallerJournalError(code);
}

function validatePayload(value: unknown): asserts value is InstallerJournalPayloadV1 {
  exactObject(value, ["operation", "transactionId", "releaseVersion", "detailDigest"], "INVALID_JOURNAL_PAYLOAD");
  if (typeof value.operation !== "string" || !(value.operation in OPERATIONS) || typeof value.transactionId !== "string" || !TOKEN.test(value.transactionId)
    || typeof value.releaseVersion !== "string" || !TOKEN.test(value.releaseVersion)
    || typeof value.detailDigest !== "string" || !HEX.test(value.detailDigest)) throw new InstallerJournalError("INVALID_JOURNAL_PAYLOAD");
}

function rawCore(record: Omit<InstallerJournalRecordV1, "recordHash">): string {
  return canonical(record);
}

function parseRawLine(line: string): InstallerJournalRecordV1 | InstallerJournalRecordV0 {
  let value: unknown;
  try { value = JSON.parse(line) as unknown; } catch { throw new InstallerJournalError("INVALID_JOURNAL_JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InstallerJournalError("INVALID_JOURNAL_RECORD");
  if (!("schema" in value)) throw new InstallerJournalError("INVALID_JOURNAL_RECORD");
  const schema = value.schema;
  if (typeof schema !== "string") throw new InstallerJournalError("INVALID_JOURNAL_RECORD");
  if (schema !== "horseness.installer-journal-record.v0" && schema !== "horseness.installer-journal-record.v1") {
    if (/^horseness\.installer-journal-record\.v[2-9][0-9]*$/u.test(schema)) throw new InstallerJournalError("UNKNOWN_NEWER_JOURNAL_SCHEMA");
    throw new InstallerJournalError("UNKNOWN_JOURNAL_SCHEMA");
  }
  const keys = schema.endsWith(".v1")
    ? ["schema", "generation", "sequence", "previousHash", "payload", "recordHash"]
    : ["schema", "generation", "sequence", "previousHash", "operation", "transactionId", "releaseVersion", "detailDigest", "recordHash"];
  exactObject(value, keys, "INVALID_JOURNAL_RECORD");
  const common = value as Record<string, unknown>;
  if (!Number.isSafeInteger(common.generation) || (common.generation as number) < 1 || !Number.isSafeInteger(common.sequence) || (common.sequence as number) < 1
    || typeof common.previousHash !== "string" || !HEX.test(common.previousHash) || typeof common.recordHash !== "string" || !HEX.test(common.recordHash)) {
    throw new InstallerJournalError("INVALID_JOURNAL_RECORD");
  }
  if (schema.endsWith(".v1")) validatePayload(common.payload);
  else validatePayload({ operation: common.operation, transactionId: common.transactionId, releaseVersion: common.releaseVersion, detailDigest: common.detailDigest });
  return value as unknown as InstallerJournalRecordV1 | InstallerJournalRecordV0;
}

function authenticateRaw(record: InstallerJournalRecordV1 | InstallerJournalRecordV0): void {
  const { recordHash: _recordHash, ...core } = record;
  if (installerSha256(`horseness.installer-journal-record\0${canonical(core)}`) !== record.recordHash) throw new InstallerJournalError("JOURNAL_HASH_MISMATCH");
}

function upcast(record: InstallerJournalRecordV1 | InstallerJournalRecordV0): InstallerJournalRecordV1 {
  if (record.schema === "horseness.installer-journal-record.v1") return record;
  return Object.freeze({
    schema: "horseness.installer-journal-record.v1", generation: record.generation, sequence: record.sequence,
    previousHash: record.previousHash,
    payload: Object.freeze({ operation: record.operation, transactionId: record.transactionId, releaseVersion: record.releaseVersion, detailDigest: record.detailDigest }),
    recordHash: record.recordHash,
  });
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

export class InstallerJournal {
  readonly root: string;
  private constructor(root: string) { this.root = root; }

  static async open(rootPath: string): Promise<InstallerJournal> {
    const root = resolve(rootPath);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new InstallerJournalError("JOURNAL_ROOT_NOT_PRIVATE");
    await chmod(root, 0o700);
    return new InstallerJournal(root);
  }

  private generationPath(generation: number): string { return join(this.root, `generation-${generation}.jsonl`); }

  async read(generation = 1): Promise<readonly InstallerJournalRecordV1[]> {
    let bytes: string;
    try { bytes = await readFile(this.generationPath(generation), "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const lines = bytes === "" ? [] : bytes.split("\n").filter((line) => line !== "");
    const result: InstallerJournalRecordV1[] = [];
    let previousHash = "0".repeat(64);
    for (let index = 0; index < lines.length; index += 1) {
      const raw = parseRawLine(lines[index] as string);
      authenticateRaw(raw);
      if (raw.generation !== generation || raw.sequence !== index + 1 || raw.previousHash !== previousHash) throw new InstallerJournalError("JOURNAL_CHAIN_MISMATCH");
      previousHash = raw.recordHash;
      result.push(upcast(raw));
    }
    return Object.freeze(result);
  }

  async append(payload: InstallerJournalPayloadV1, generation = 1): Promise<InstallerJournalRecordV1> {
    validatePayload(payload);
    const lockPath = join(this.root, `.generation-${generation}.lock`);
    let acquired = false;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      try { await mkdir(lockPath, { mode: 0o700 }); acquired = true; break; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await delay(10);
      }
    }
    if (!acquired) throw new InstallerJournalError("JOURNAL_APPEND_LOCK_TIMEOUT");
    try {
      const records = await this.read(generation);
      const core = {
        schema: "horseness.installer-journal-record.v1" as const,
        generation,
        sequence: records.length + 1,
        previousHash: records.at(-1)?.recordHash ?? "0".repeat(64),
        payload: Object.freeze({ ...payload }),
      };
      const record: InstallerJournalRecordV1 = Object.freeze({ ...core, recordHash: installerSha256(`horseness.installer-journal-record\0${rawCore(core)}`) });
      const path = this.generationPath(generation);
      const temp = `${path}.append-${process.pid}-${Date.now()}`;
      let existing = "";
      try { existing = await readFile(path, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(`${existing}${canonical(record)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, path);
      await fsyncDirectory(dirname(path));
      return record;
    } finally {
      await rm(lockPath, { recursive: true, force: true });
      await fsyncDirectory(this.root);
    }
  }
}
