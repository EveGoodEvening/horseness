import { createPublicKey, verify } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { canonicalJson, sha256Hex } from "@horseness/domain";

export interface SigstoreIdentityV1 {
  readonly issuer: string;
  readonly repository: string;
  readonly workflow: string;
  readonly protectedEnvironment: string;
}

export interface ReleaseArtifactV1 {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly lifecycleScripts: readonly string[];
}

export interface ReleaseManifestV1 {
  readonly schema: "horseness.release-manifest.v1";
  readonly sequence: number;
  readonly version: string;
  readonly previousManifestDigest: string | null;
  readonly artifacts: readonly ReleaseArtifactV1[];
  readonly dependencyGraphDigest: string;
  readonly sigstoreIdentity: SigstoreIdentityV1;
}

export interface SignedReleaseManifestV1 {
  readonly schema: "horseness.signed-release-manifest.v1";
  readonly manifest: ReleaseManifestV1;
  readonly manifestDigest: string;
  readonly keyId: string;
  readonly signature: string;
}

export interface ProjectTrustRootV1 {
  readonly schema: "horseness.project-trust-root.v1";
  readonly rootKeyId: string;
  readonly rootPublicKeyPem: string;
  readonly delegations: readonly {
    readonly keyId: string;
    readonly publicKeyPem: string;
    readonly validFromSequence: number;
    readonly validThroughSequence: number;
    readonly rootSignature: string;
  }[];
  readonly revokedKeyIds: readonly string[];
  readonly requiredSigstoreIdentity: SigstoreIdentityV1;
}

export interface TrustReplayStateV1 { readonly highestSequence: number; readonly version: string; readonly manifestDigest: string; }
export class InstallerTrustError extends Error { constructor(readonly code: string) { super(code); this.name = "InstallerTrustError"; } }
type TrustDelegationV1 = ProjectTrustRootV1["delegations"][number];
const HEX = /^[0-9a-f]{64}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function requireExact(value: unknown, keys: readonly string[], code: string): void {
  if (!hasExactKeys(value, keys)) throw new InstallerTrustError(code);
}

function parseDelegation(value: unknown): TrustDelegationV1 {
  if (!hasExactKeys(value, ["keyId", "publicKeyPem", "validFromSequence", "validThroughSequence", "rootSignature"])
    || typeof value.keyId !== "string"
    || typeof value.publicKeyPem !== "string"
    || typeof value.validFromSequence !== "number"
    || typeof value.validThroughSequence !== "number"
    || typeof value.rootSignature !== "string"
    || !Number.isSafeInteger(value.validFromSequence)
    || !Number.isSafeInteger(value.validThroughSequence)
    || value.validFromSequence < 1
    || value.validThroughSequence < value.validFromSequence) {
    throw new InstallerTrustError("INVALID_DELEGATION");
  }
  return Object.freeze({
    keyId: value.keyId,
    publicKeyPem: value.publicKeyPem,
    validFromSequence: value.validFromSequence,
    validThroughSequence: value.validThroughSequence,
    rootSignature: value.rootSignature,
  });
}

function parseArtifact(value: unknown): ReleaseArtifactV1 {
  if (!hasExactKeys(value, ["path", "sha256", "bytes", "lifecycleScripts"])
    || typeof value.path !== "string"
    || typeof value.sha256 !== "string"
    || typeof value.bytes !== "number"
    || !Array.isArray(value.lifecycleScripts)) {
    throw new InstallerTrustError("INVALID_RELEASE_ARTIFACT");
  }
  const lifecycleScripts: string[] = [];
  for (const script of value.lifecycleScripts) {
    if (typeof script !== "string") throw new InstallerTrustError("INVALID_RELEASE_ARTIFACT");
    lifecycleScripts.push(script);
  }
  return Object.freeze({ path: value.path, sha256: value.sha256, bytes: value.bytes, lifecycleScripts: Object.freeze(lifecycleScripts) });
}

function manifestBytes(manifest: ReleaseManifestV1): Buffer { return Buffer.from(canonicalJson(manifest), "utf8"); }
function delegationBytes(delegation: ProjectTrustRootV1["delegations"][number]): Buffer {
  return Buffer.from(canonicalJson({ keyId: delegation.keyId, publicKeyPem: delegation.publicKeyPem, validFromSequence: delegation.validFromSequence, validThroughSequence: delegation.validThroughSequence }), "utf8");
}
function verifyEd25519(publicKeyPem: string, bytes: Uint8Array, signature: string): boolean {
  if (!BASE64.test(signature)) return false;
  try { return verify(null, bytes, createPublicKey(publicKeyPem), Buffer.from(signature, "base64")); } catch { return false; }
}

export async function verifyReleaseV1(input: {
  readonly signed: SignedReleaseManifestV1;
  readonly trustRoot: ProjectTrustRootV1;
  readonly artifactRoot: string;
  readonly dependencyGraphPath: string;
  readonly replayState?: TrustReplayStateV1;
}): Promise<TrustReplayStateV1> {
  const { signed, trustRoot } = input;
  requireExact(signed, ["schema", "manifest", "manifestDigest", "keyId", "signature"], "INVALID_SIGNED_MANIFEST");
  requireExact(signed.manifest, ["schema", "sequence", "version", "previousManifestDigest", "artifacts", "dependencyGraphDigest", "sigstoreIdentity"], "INVALID_RELEASE_MANIFEST");
  requireExact(signed.manifest.sigstoreIdentity, ["issuer", "repository", "workflow", "protectedEnvironment"], "INVALID_SIGSTORE_IDENTITY");
  requireExact(trustRoot, ["schema", "rootKeyId", "rootPublicKeyPem", "delegations", "revokedKeyIds", "requiredSigstoreIdentity"], "INVALID_TRUST_ROOT");
  requireExact(trustRoot.requiredSigstoreIdentity, ["issuer", "repository", "workflow", "protectedEnvironment"], "INVALID_SIGSTORE_IDENTITY");
  if (!Array.isArray(signed.manifest.artifacts) || !Array.isArray(trustRoot.delegations) || !Array.isArray(trustRoot.revokedKeyIds)) throw new InstallerTrustError("INVALID_TRUST_ROOT");
  const delegations = trustRoot.delegations.map((candidate) => parseDelegation(candidate));
  if (trustRoot.revokedKeyIds.some((keyId) => typeof keyId !== "string")) throw new InstallerTrustError("INVALID_TRUST_ROOT");
  if (signed.schema !== "horseness.signed-release-manifest.v1" || signed.manifest.schema !== "horseness.release-manifest.v1" || trustRoot.schema !== "horseness.project-trust-root.v1") throw new InstallerTrustError("UNKNOWN_TRUST_SCHEMA");
  if (!Number.isSafeInteger(signed.manifest.sequence) || signed.manifest.sequence < 1 || !HEX.test(signed.manifestDigest) || !HEX.test(signed.manifest.dependencyGraphDigest)) throw new InstallerTrustError("INVALID_RELEASE_MANIFEST");
  const calculatedManifestDigest = sha256Hex(`horseness.release-manifest.v1\0${canonicalJson(signed.manifest)}`);
  if (calculatedManifestDigest !== signed.manifestDigest) throw new InstallerTrustError("MANIFEST_DIGEST_MISMATCH");
  if (canonicalJson(signed.manifest.sigstoreIdentity) !== canonicalJson(trustRoot.requiredSigstoreIdentity)) throw new InstallerTrustError("SIGSTORE_IDENTITY_MISMATCH");
  if (trustRoot.revokedKeyIds.includes(signed.keyId)) throw new InstallerTrustError("SIGNING_KEY_REVOKED");
  const delegation = delegations.find((candidate) => candidate.keyId === signed.keyId);
  if (delegation === undefined) throw new InstallerTrustError("SIGNING_KEY_NOT_DELEGATED");
  if (!verifyEd25519(trustRoot.rootPublicKeyPem, delegationBytes(delegation), delegation.rootSignature)) throw new InstallerTrustError("DELEGATION_SIGNATURE_INVALID");
  if (signed.manifest.sequence < delegation.validFromSequence || signed.manifest.sequence > delegation.validThroughSequence) throw new InstallerTrustError("DELEGATION_SEQUENCE_INVALID");
  if (!verifyEd25519(delegation.publicKeyPem, manifestBytes(signed.manifest), signed.signature)) throw new InstallerTrustError("RELEASE_SIGNATURE_INVALID");
  if (input.replayState !== undefined && (signed.manifest.sequence < input.replayState.highestSequence
    || (signed.manifest.sequence === input.replayState.highestSequence && (signed.manifest.version !== input.replayState.version || signed.manifestDigest !== input.replayState.manifestDigest)))) {
    throw new InstallerTrustError("RELEASE_REPLAY_REFUSED");
  }
  const graphBytes = await readFile(input.dependencyGraphPath);
  if (sha256Hex(graphBytes) !== signed.manifest.dependencyGraphDigest) throw new InstallerTrustError("DEPENDENCY_GRAPH_TAMPERED");
  const seen = new Set<string>();
  for (const candidate of signed.manifest.artifacts) {
    const artifact = parseArtifact(candidate);
    if (!PATH.test(artifact.path) || artifact.path.startsWith("/") || artifact.path.split("/").includes("..") || !HEX.test(artifact.sha256)
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || artifact.lifecycleScripts.length !== 0 || seen.has(artifact.path)) throw new InstallerTrustError("INVALID_RELEASE_ARTIFACT");
    seen.add(artifact.path);
    const artifactRoot = resolve(input.artifactRoot);
    const artifactPath = resolve(artifactRoot, artifact.path);
    if (!artifactPath.startsWith(`${artifactRoot}${sep}`)) throw new InstallerTrustError("INVALID_RELEASE_ARTIFACT");
    const artifactInfo = await lstat(artifactPath);
    if (!artifactInfo.isFile() || artifactInfo.isSymbolicLink()) throw new InstallerTrustError("INVALID_RELEASE_ARTIFACT");
    const bytes = await readFile(artifactPath);
    if (bytes.length !== artifact.bytes || sha256Hex(bytes) !== artifact.sha256) throw new InstallerTrustError("RELEASE_ARTIFACT_TAMPERED");
  }
  return Object.freeze({ highestSequence: signed.manifest.sequence, version: signed.manifest.version, manifestDigest: signed.manifestDigest });
}
