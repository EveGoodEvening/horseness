import { createPublicKey, verify } from "node:crypto";
import { canonicalJson, domainDigest, DomainError, sha256Hex, type JsonValue } from "./canonical.js";

export interface CommandResultV1 { command: string; exitCode: number; stdoutDigest: string; stderrDigest: string }
export interface CheckpointReceiptCoreV1 { receiptVariant: "bootstrap-v1" | "ordinary-v1" | "side-effect-v1"; subject: string; attemptGeneration: number; claimId: string | null; dependencyReceiptDigests: string[]; workerBaseSha: string | null; workerCandidateSha: string; candidateIntegrationSha: string; candidateTree: string; acceptanceContractVersion: string; commandResults: CommandResultV1[]; sealedAt: string; attestedAt: string; expiresAt: string | null; supersedesReceiptDigest: string | null; evidence: JsonValue; ciIdentity: JsonValue | null; sideEffectHead: string | null }
export interface CheckpointSignatureV1 { signatureVersion: "1"; algorithm: "Ed25519"; keyId: string; principalId: string; signedDigest: string; signatureBase64: string }
export interface CheckpointReceiptEnvelopeV1 { recordType: "CheckpointReceiptEnvelopeV1"; schemaVersion: "1"; core: CheckpointReceiptCoreV1; coreDigest: string; signature: CheckpointSignatureV1; envelopeDigest: string }
export interface CheckpointTrustKeyV1 { keyId: string; principalId: string; publicKeySpkiBase64: string; spkiSha256: string; notBefore: string; notAfter: string; revokedAt: string | null; subjects: string[]; variants: CheckpointReceiptCoreV1["receiptVariant"][]; fixtureOnly: boolean }
export interface CheckpointTrustStoreV1 { schemaVersion: "1"; keys: CheckpointTrustKeyV1[] }
export function checkpointCoreDigest(core: CheckpointReceiptCoreV1): string { return domainDigest("horseness.checkpoint-receipt-core.v1", core); }
export function checkpointEnvelopeDigest(envelope: Omit<CheckpointReceiptEnvelopeV1, "envelopeDigest">): string { return domainDigest("horseness.checkpoint-receipt-envelope.v1", envelope as unknown as JsonValue); }
export function verifyCheckpointReceipt(envelope: CheckpointReceiptEnvelopeV1, trust: CheckpointTrustStoreV1, trustedNow: string, production = true): void {
  const coreDigest = checkpointCoreDigest(envelope.core);
  if (coreDigest !== envelope.coreDigest || checkpointEnvelopeDigest({ recordType: envelope.recordType, schemaVersion: envelope.schemaVersion, core: envelope.core, coreDigest: envelope.coreDigest, signature: envelope.signature }) !== envelope.envelopeDigest || envelope.signature.signedDigest !== coreDigest) throw new DomainError("RECEIPT_MISMATCH");
  const matches = trust.keys.filter((key) => key.keyId === envelope.signature.keyId);
  if (matches.length !== 1) throw new DomainError("TRUST_KEY_INVALID");
  const key = matches[0] as CheckpointTrustKeyV1;
  if (key.principalId !== envelope.signature.principalId || (production && key.fixtureOnly) || !key.subjects.includes(envelope.core.subject) || !key.variants.includes(envelope.core.receiptVariant) || envelope.core.attestedAt < key.notBefore || envelope.core.attestedAt >= key.notAfter || trustedNow < key.notBefore || (key.revokedAt !== null && key.revokedAt <= envelope.core.attestedAt)) throw new DomainError("TRUST_KEY_INVALID");
  const spki = Buffer.from(key.publicKeySpkiBase64, "base64");
  if (sha256Hex(spki) !== key.spkiSha256) throw new DomainError("TRUST_KEY_INVALID");
  const signedBytes = Buffer.from(`horseness.checkpoint-receipt-signature.v1\0${coreDigest}`, "utf8");
  const signature = Buffer.from(envelope.signature.signatureBase64, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== envelope.signature.signatureBase64 || !verify(null, signedBytes, createPublicKey({ key: spki, format: "der", type: "spki" }), signature)) throw new DomainError("SIGNATURE_INVALID");
  canonicalJson(envelope as unknown as JsonValue);
}
