import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const HOSTS = Object.freeze(["pi", "omp", "claude", "codex"]);
export const CAPABILITIES = Object.freeze([
  "nativeArtifactLoad", "contextInjection", "deterministicProviderAttempt", "receiptBinding",
  "restartReconcile", "resume", "forkSwitch", "uninstall"
]);
export const REASON_CODES = Object.freeze([
  "OK", "LIVE_CREDENTIAL_ABSENT", "LIVE_REQUIRED_CREDENTIAL_ABSENT", "LIVE_CREDENTIAL_INVALID",
  "LIVE_PROVENANCE_MISMATCH", "LIVE_REDACTION_FAILURE", "LIVE_BUDGET_EXCEEDED", "LIVE_TIMEOUT",
  "LIVE_HOST_FAILURE", "NATIVE_BINARY_MISSING", "NATIVE_BINARY_TAMPERED", "NATIVE_VERSION_INCOMPATIBLE",
  "OFFICIAL_VALIDATOR_MISSING", "OFFICIAL_VALIDATOR_TAMPERED", "OFFICIAL_VALIDATOR_FAILED",
  "CLI_ONLY_FALLBACK", "REQUIRED_CAPABILITY_MISSING", "FIXTURE_INVALID", "EVIDENCE_MISMATCH"
]);

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new TypeError("value is not canonical JSON");
}

export function evidenceDigest(value) {
  return `sha256:${createHash("sha256").update("horseness.host-evidence.v1\0").update(canonicalJson(value)).digest("hex")}`;
}

export async function loadFixture(file) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  assertManifest(parsed);
  return parsed;
}

export function assertManifest(value) {
  requireExact(value, ["schemaVersion", "host", "native", "officialValidator", "capabilities", "resume", "provider", "livePolicy"], "manifest");
  if (value.schemaVersion !== "HostFixtureManifestV1" || !HOSTS.includes(value.host)) throw new Error("invalid manifest identity");
  requireExact(value.native, ["binary", "version", "distributionIdentity", "distributionDigest", "mode"], "native");
  requireExact(value.officialValidator, ["command", "version", "distributionIdentity", "distributionDigest"], "officialValidator");
  if (value.native.mode !== "native") throw new Error("CLI-only fixture cannot satisfy native minimum");
  for (const digest of [value.native.distributionDigest, value.officialValidator.distributionDigest]) assertDigest(digest);
  if (!Array.isArray(value.capabilities.required) || !Array.isArray(value.capabilities.supported)) throw new Error("invalid capabilities");
  for (const capability of value.capabilities.required) if (!CAPABILITIES.includes(capability)) throw new Error(`unknown capability ${capability}`);
  requireExact(value.provider, ["identity", "requestFixture", "responseFixture", "clock", "budget", "network", "credentials"], "provider");
  if (value.provider.network !== "disabled" || value.provider.credentials !== "disabled") throw new Error("hermetic provider must disable network and credentials");
  requireExact(value.livePolicy, ["credentialReference", "publicationRequired", "timeoutMs", "budget"], "livePolicy");
  return value;
}

export function stableResult(fields) {
  const result = {
    schemaVersion: "HostValidationResultV1",
    host: fields.host,
    mode: fields.mode,
    status: fields.status,
    reasonCode: fields.reasonCode,
    nativeMinimumSatisfied: fields.nativeMinimumSatisfied,
    officialValidatorSatisfied: fields.officialValidatorSatisfied,
    capabilities: fields.capabilities,
    evidenceDigest: fields.evidenceDigest
  };
  assertResult(result);
  return result;
}

export function assertResult(value) {
  requireExact(value, ["schemaVersion", "host", "mode", "status", "reasonCode", "nativeMinimumSatisfied", "officialValidatorSatisfied", "capabilities", "evidenceDigest"], "result");
  if (value.schemaVersion !== "HostValidationResultV1" || !HOSTS.includes(value.host)) throw new Error("invalid result identity");
  if (!["hermetic", "live"].includes(value.mode) || !["pass", "fail", "skip"].includes(value.status)) throw new Error("invalid result state");
  if (!REASON_CODES.includes(value.reasonCode)) throw new Error("invalid reason code");
  if (typeof value.nativeMinimumSatisfied !== "boolean" || typeof value.officialValidatorSatisfied !== "boolean") throw new Error("invalid minimum flags");
  if (!value.capabilities || typeof value.capabilities !== "object" || Array.isArray(value.capabilities)) throw new Error("invalid capabilities result");
  assertDigest(value.evidenceDigest);
  if (value.mode === "hermetic" && value.status !== "pass" && value.reasonCode === "LIVE_CREDENTIAL_ABSENT") throw new Error("hermetic validation cannot skip");
  if (value.status === "pass" && (!value.nativeMinimumSatisfied || !value.officialValidatorSatisfied)) throw new Error("pass requires native and official validator minimums");
  return value;
}

function requireExact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label} fields mismatch`);
}
function assertDigest(value) { if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error("invalid sha256 digest"); }
