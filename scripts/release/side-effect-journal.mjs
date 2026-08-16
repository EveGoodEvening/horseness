import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonical, exactKeys, run, sha256 } from "./lib.mjs";
export async function signDigest(digest) { const executable = process.env.HORSENESS_KMS_SIGNER; if (executable === undefined || !executable.startsWith("/")) throw new Error("KMS_SIGNER_REQUIRED"); const result = await run(executable, [digest], { code: "KMS_SIGN_FAILED", limit: 16 * 1024 }); const value = JSON.parse(result.stdout); exactKeys(value, ["keyId", "signature"], "KMS_SIGNATURE_RESPONSE_INVALID"); return value; }
export async function appendSignedJournal(path, event) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`; let lock;
  try { lock = await open(lockPath, "wx", 0o600); } catch (error) { if (error.code === "EEXIST") throw new Error("SIDE_EFFECT_JOURNAL_LOCKED"); throw error; }
  try {
    let previousHash = null; let sequence = 1;
    try { const lines = (await readFile(path, "utf8")).trim().split("\n").filter(Boolean); for (const line of lines) { const record = JSON.parse(line); if (record.sequence !== sequence || record.previousHash !== previousHash) throw new Error("SIDE_EFFECT_JOURNAL_CHAIN_INVALID"); const core = { schema: record.schema, sequence: record.sequence, previousHash: record.previousHash, event: record.event }; if (record.recordHash !== sha256(`horseness.side-effect.v1\0${canonical(core)}`)) throw new Error("SIDE_EFFECT_JOURNAL_HASH_INVALID"); previousHash = record.recordHash; sequence += 1; } } catch (error) { if (error.code !== "ENOENT") throw error; }
    const core = { schema: "horseness.side-effect.v1", sequence, previousHash, event }; const recordHash = sha256(`horseness.side-effect.v1\0${canonical(core)}`); const signer = await signDigest(recordHash); const record = { ...core, recordHash, signer };
    await writeFile(path, `${canonical(record)}\n`, { flag: "a", mode: 0o600 }); return record;
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}
export function c22JournalPath(root) { return resolve(root, "docs/publication-journal/C22/current.jsonl"); }
