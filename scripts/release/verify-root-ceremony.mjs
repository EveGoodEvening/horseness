import { createPublicKey } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT, exactKeys, parseArgs, readJson, regularFile, sha256 } from "./lib.mjs";

const args = parseArgs();
const schemaPath = resolve(ROOT, String(args.get("schema") ?? ""));
const recordPath = resolve(ROOT, String(args.get("record") ?? ""));
const evidenceRoot = resolve(ROOT, String(args.get("evidence") ?? ""));
if (args.get("offline") !== true || args.get("threshold") !== "2-of-2") throw new Error("ROOT_CEREMONY_OFFLINE_2_OF_2_REQUIRED");
await regularFile(schemaPath, "ROOT_CEREMONY_SCHEMA_MISSING");
const schema = await readJson(schemaPath);
if (schema.title !== "Horseness RootCeremonyRecordV1" || schema.additionalProperties !== false) throw new Error("ROOT_CEREMONY_SCHEMA_INVALID");
await regularFile(recordPath, "ROOT_CEREMONY_RECORD_MISSING");
const record = await readJson(recordPath);
exactKeys(record, ["schema", "ceremonyId", "performedAt", "threshold", "rootKeys", "recovery", "witnesses", "custodyReceipts", "destructionReceipts", "delegation"], "ROOT_CEREMONY_RECORD_INVALID");
if (record.schema !== "horseness.root-ceremony.v1" || record.threshold !== "2-of-2" || !Array.isArray(record.rootKeys) || record.rootKeys.length !== 2 || !Array.isArray(record.witnesses) || record.witnesses.length < 2) throw new Error("ROOT_CEREMONY_RECORD_INVALID");
const keyIds = new Set(); const fingerprints = new Set();
for (const key of record.rootKeys) {
  exactKeys(key, ["keyId", "algorithm", "publicKeyPem", "spkiFingerprint", "hardwareSerialDigest", "generationTool", "generationToolVersion", "entropySourceDigest"], "ROOT_KEY_INVALID");
  if (key.algorithm !== "Ed25519" || keyIds.has(key.keyId) || fingerprints.has(key.spkiFingerprint)) throw new Error("ROOT_KEYS_NOT_DISTINCT");
  const der = createPublicKey(key.publicKeyPem).export({ type: "spki", format: "der" });
  if (key.spkiFingerprint !== `sha256:${sha256(der)}`) throw new Error("ROOT_KEY_FINGERPRINT_INVALID");
  keyIds.add(key.keyId); fingerprints.add(key.spkiFingerprint);
}
exactKeys(record.recovery, ["key", "authorization", "sealedMediaReceiptDigests", "custodianIdentityDigests"], "RECOVERY_RECORD_INVALID");
if (record.recovery.authorization !== "2-of-3" || record.recovery.sealedMediaReceiptDigests.length < 3 || new Set(record.recovery.custodianIdentityDigests).size !== 3) throw new Error("RECOVERY_RECORD_INVALID");
const recoveryKey = record.recovery.key; const recoveryDer = createPublicKey(recoveryKey.publicKeyPem).export({ type: "spki", format: "der" });
if (recoveryKey.spkiFingerprint !== `sha256:${sha256(recoveryDer)}` || fingerprints.has(recoveryKey.spkiFingerprint) || keyIds.has(recoveryKey.keyId)) throw new Error("RECOVERY_KEY_NOT_DISTINCT");
const evidenceEntries = await readdir(evidenceRoot, { recursive: true, withFileTypes: true }).catch((error) => { if (error.code === "ENOENT") throw new Error("ROOT_CEREMONY_EVIDENCE_MISSING"); throw error; });
if (evidenceEntries.some((entry) => entry.isSymbolicLink())) throw new Error("ROOT_CEREMONY_EVIDENCE_SYMLINK");
const referenced = [...record.custodyReceipts, ...record.destructionReceipts];
if (record.custodyReceipts.length < 2 || record.destructionReceipts.length < 2) throw new Error("ROOT_CEREMONY_EVIDENCE_INCOMPLETE");
for (const item of referenced) { exactKeys(item, ["path", "sha256"], "ROOT_CEREMONY_EVIDENCE_INVALID"); if (item.path.includes("..") || item.path.startsWith("/")) throw new Error("ROOT_CEREMONY_EVIDENCE_PATH_INVALID"); const path = resolve(evidenceRoot, item.path); if (!path.startsWith(`${evidenceRoot}/`)) throw new Error("ROOT_CEREMONY_EVIDENCE_PATH_INVALID"); await regularFile(path, "ROOT_CEREMONY_EVIDENCE_MISSING"); if (`sha256:${sha256(await readFile(path))}` !== item.sha256) throw new Error("ROOT_CEREMONY_EVIDENCE_DIGEST_MISMATCH"); }
process.stdout.write(`Verified offline root ceremony ${record.ceremonyId}\n`);
