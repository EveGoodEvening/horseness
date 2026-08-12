import { readFile } from "node:fs/promises";
import { HOSTS, CAPABILITIES, assertManifest, evidenceDigest } from "./lib/contracts.mjs";

const matrixPath = "config/hosts/capability-matrix.v1.json";
const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
const exact = ["schemaVersion", "hosts", "credentialedLivePolicy", "deterministicProvider"];
if (JSON.stringify(Object.keys(matrix).sort()) !== JSON.stringify(exact.sort())) throw new Error("matrix fields mismatch");
if (matrix.schemaVersion !== "HostCapabilityMatrixV1") throw new Error("matrix schema mismatch");
if (Object.keys(matrix.hosts).sort().join(",") !== [...HOSTS].sort().join(",")) throw new Error("matrix host set mismatch");
for (const host of HOSTS) {
  const manifest = JSON.parse(await readFile(`tests/fixtures/hosts/${host}/manifest.v1.json`, "utf8"));
  assertManifest(manifest);
  const row = matrix.hosts[host];
  if (!row || row.fixture !== `tests/fixtures/hosts/${host}/manifest.v1.json` || row.validator !== `scripts/host-feasibility/${host}/validate.mjs`) throw new Error(`${host}: matrix path mismatch`);
  if (row.native.version !== manifest.native.version || row.native.distributionDigest !== manifest.native.distributionDigest) throw new Error(`${host}: native pin mismatch`);
  if (row.officialValidator.version !== manifest.officialValidator.version || row.officialValidator.distributionDigest !== manifest.officialValidator.distributionDigest) throw new Error(`${host}: validator pin mismatch`);
  for (const capability of CAPABILITIES) if (typeof row.capabilities[capability] !== "boolean") throw new Error(`${host}: missing capability ${capability}`);
  for (const capability of manifest.capabilities.required) if (!row.capabilities[capability]) throw new Error(`${host}: required capability unsupported`);
}
if (matrix.deterministicProvider.network !== "disabled" || matrix.deterministicProvider.credentials !== "disabled") throw new Error("matrix provider is not hermetic");
if (matrix.credentialedLivePolicy.absentCredential !== "skip-local-fail-publication" || matrix.credentialedLivePolicy.configuredCredentialFailure !== "fail") throw new Error("live policy mismatch");
console.log(JSON.stringify({ schemaVersion: "HostMatrixVerificationV1", status: "pass", hosts: HOSTS, matrixDigest: evidenceDigest(matrix) }));
