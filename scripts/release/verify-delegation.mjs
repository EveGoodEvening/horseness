import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { PUBLISHABLE_MANIFESTS, ROOT, RELEASE_IDENTITY, canonical, exactKeys, parseArgs, readJson, verifyEd25519 } from "./lib.mjs";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
function parseSemver(value) {
  const match = SEMVER.exec(value);
  if (match === null) throw new Error(`DELEGATION_VERSION_RANGE_INVALID`);
  const [, major, minor, patch, prerelease] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease: prerelease ?? null };
}
function comparePrerelease(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^[0-9]+$/u.test(leftPart);
    const rightNumeric = /^[0-9]+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) { const delta = Number(leftPart) - Number(rightPart); if (delta !== 0) return delta < 0 ? -1 : 1; }
    else if (leftNumeric) return -1;
    else if (rightNumeric) return 1;
    else { const delta = leftPart.localeCompare(rightPart); if (delta !== 0) return delta < 0 ? -1 : 1; }
  }
  return 0;
}
function compareSemver(left, right) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (parsedLeft.major !== parsedRight.major) return parsedLeft.major < parsedRight.major ? -1 : 1;
  if (parsedLeft.minor !== parsedRight.minor) return parsedLeft.minor < parsedRight.minor ? -1 : 1;
  if (parsedLeft.patch !== parsedRight.patch) return parsedLeft.patch < parsedRight.patch ? -1 : 1;
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}
function assertVersionInRange(version, minimum, maximum) {
  if (compareSemver(version, minimum) < 0) throw new Error("DELEGATION_VERSION_BELOW_RANGE");
  if (compareSemver(version, maximum) > 0) throw new Error("DELEGATION_VERSION_ABOVE_RANGE");
}
async function coherentReleaseVersion() {
  const manifests = await Promise.all(PUBLISHABLE_MANIFESTS.map(async (path) => JSON.parse(await readFile(resolve(ROOT, path), "utf8"))));
  const versions = new Set(manifests.map((manifest) => manifest.version));
  if (versions.size !== 1) throw new Error("RELEASE_VERSION_INCOHERENT");
  const version = manifests[0].version;
  if (!SEMVER.test(version) || version === "0.0.0") throw new Error("APPROVED_RELEASE_VERSION_REQUIRED");
  return version;
}
const args = parseArgs();
if (args.get("require-version-range") !== true || args.get("require-kms-policy") !== true || args.get("require-two-approvals") !== true) throw new Error("DELEGATION_REQUIRED_CONTROLS_MISSING");
const releaseVersion = typeof args.get("release-version") === "string" ? args.get("release-version") : await coherentReleaseVersion();
if (!SEMVER.test(releaseVersion)) throw new Error("DELEGATION_RELEASE_VERSION_INVALID");
const record = await readJson(resolve(ROOT, String(args.get("root-record") ?? "")));
const delegation = record.delegation;
exactKeys(delegation, ["keyId", "publicKeyPem", "validFromSequence", "validThroughSequence", "versionRange", "kmsPolicy", "approvals", "rootSignatures", "installerRootKeyId", "installerRootSignature"], "DELEGATION_INVALID");
if (!Number.isSafeInteger(delegation.validFromSequence) || !Number.isSafeInteger(delegation.validThroughSequence) || delegation.validFromSequence < 1 || delegation.validThroughSequence < delegation.validFromSequence) throw new Error("DELEGATION_SEQUENCE_RANGE_INVALID");
if (!SEMVER.test(delegation.versionRange.minimum) || !SEMVER.test(delegation.versionRange.maximum)) throw new Error("DELEGATION_VERSION_RANGE_INVALID");
if (compareSemver(delegation.versionRange.minimum, delegation.versionRange.maximum) > 0) throw new Error("DELEGATION_VERSION_RANGE_INVALID");
assertVersionInRange(releaseVersion, delegation.versionRange.minimum, delegation.versionRange.maximum);
exactKeys(delegation.kmsPolicy, ["issuer", "repository", "workflow", "protectedEnvironment", "branch", "approvalCount", "keyResourceDigest"], "KMS_POLICY_INVALID");
for (const key of Object.keys(RELEASE_IDENTITY)) if (delegation.kmsPolicy[key] !== RELEASE_IDENTITY[key]) throw new Error("KMS_OIDC_IDENTITY_MISMATCH");
if (delegation.kmsPolicy.branch !== "refs/heads/main" || delegation.kmsPolicy.approvalCount !== 2 || !/^sha256:[0-9a-f]{64}$/u.test(delegation.kmsPolicy.keyResourceDigest)) throw new Error("KMS_POLICY_INVALID");
if (!Array.isArray(delegation.approvals) || delegation.approvals.length < 2 || new Set(delegation.approvals.map((item) => item.reviewerIdentityDigest)).size < 2) throw new Error("TWO_DISTINCT_APPROVALS_REQUIRED");
if (!Array.isArray(delegation.rootSignatures) || delegation.rootSignatures.length !== 2 || new Set(delegation.rootSignatures.map((item) => item.keyId)).size !== 2) throw new Error("ROOT_THRESHOLD_SIGNATURES_REQUIRED");
const core = { keyId: delegation.keyId, publicKeyPem: delegation.publicKeyPem, validFromSequence: delegation.validFromSequence, validThroughSequence: delegation.validThroughSequence, versionRange: delegation.versionRange, kmsPolicy: delegation.kmsPolicy, approvals: delegation.approvals };
const bytes = Buffer.from(canonical(core));
for (const signature of delegation.rootSignatures) { const root = record.rootKeys.find((item) => item.keyId === signature.keyId); if (root === undefined || !verifyEd25519(root.publicKeyPem, bytes, signature.signature)) throw new Error("ROOT_DELEGATION_SIGNATURE_INVALID"); }
const installerRoot = record.rootKeys.find((item) => item.keyId === delegation.installerRootKeyId); const installerCore = { keyId: delegation.keyId, publicKeyPem: delegation.publicKeyPem, validFromSequence: delegation.validFromSequence, validThroughSequence: delegation.validThroughSequence };
if (installerRoot === undefined || !verifyEd25519(installerRoot.publicKeyPem, Buffer.from(canonical(installerCore)), delegation.installerRootSignature)) throw new Error("INSTALLER_DELEGATION_SIGNATURE_INVALID");
process.stdout.write(`Verified release delegation ${delegation.keyId} for sequences ${delegation.validFromSequence}-${delegation.validThroughSequence} and release version ${releaseVersion} within [${delegation.versionRange.minimum}, ${delegation.versionRange.maximum}]\n`);
