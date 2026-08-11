import { readFile } from "node:fs/promises";
import process from "node:process";

const C01_VERSION = "v4:C01";
const C01_MANIFEST_COMMAND = `node scripts/acceptance.mjs verify-manifest --subject C01 --version ${C01_VERSION}`;
const C01 = [
  C01_MANIFEST_COMMAND,
  `node -e "$(cat docs/validation/c00-contract-gate.node-e.txt)"`,
  "node scripts/c00-contract-gate.mjs",
  "node scripts/progress-cas.mjs verify-live-bootstrap --receipt docs/checkpoints/C00/bootstrap/0.json --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --integrated-head HEAD --strict",
  "node scripts/progress-cas.mjs verify-live-claim --claim docs/claims/C01/1.json --claim-index docs/claims/index.jsonl --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --now 2026-08-11T16:11:30Z --integrated-head HEAD --strict",
  "node scripts/progress-cas.mjs verify-fixture-bundle --bundle docs/checkpoints/fixtures/c01-bundle-v1 --strict",
  "corepack pnpm install --frozen-lockfile",
  "corepack pnpm run docs:lint",
  "corepack pnpm run typecheck",
  "corepack pnpm run lint",
  "corepack pnpm run test",
  "corepack pnpm run boundaries:check"
];
const contracts = new Map([["C01", { commands: C01, version: C01_VERSION }]]);
const [mode, ...args] = process.argv.slice(2);
if (mode === "verify-manifest") verifyManifest(args);
const [id, file] = args;
if (mode !== "verify" || !id || !file) usage();
const contract = contracts.get(id);
if (!contract) throw new Error(`no frozen acceptance contract for ${id}`);
const expected = contract.commands;
const document = JSON.parse(await readFile(file, "utf8"));
const results = document.core?.commandResults ?? document.commandResults;
if (!Array.isArray(results)) throw new Error("acceptance record has no commandResults array");
if (results.length !== expected.length) throw new Error(`${id} acceptance command count differs from frozen ordered contract`);
const resultKeys = ["artifacts","command","environmentDigest","exitCode","finishedAt","ordinal","resultDigest","startedAt","stderrDigest","stdoutDigest"];
const digest = /^[0-9a-f]{64}$/;
for (const [index, result] of results.entries()) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(`command ${index} must be CommandResultV1, not a string or substitute`);
  if (Object.keys(result).sort().join("\0") !== resultKeys.join("\0")) throw new Error(`command ${index} has omitted or additional fields`);
  if (result.ordinal !== index) throw new Error(`non-contiguous command ordinal ${index}`);
  if (result.command !== expected[index]) throw new Error(`${id} command ${index} differs from frozen ordered contract`);
  if (result.exitCode !== 0) throw new Error(`command ${index} did not succeed`);
  for (const field of ["environmentDigest","stdoutDigest","stderrDigest","resultDigest"]) if (!digest.test(result[field])) throw new Error(`command ${index} has invalid ${field}`);
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(result.startedAt) || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(result.finishedAt) || Date.parse(result.finishedAt) < Date.parse(result.startedAt)) throw new Error(`command ${index} has invalid chronology`);
  if (!Array.isArray(result.artifacts) || result.artifacts.length !== 0) throw new Error(`command ${index} violates frozen C01 artifact contract`);
}
if (id === "C01" && document.core) {
  const core = document.core;
  if (core.subjectId !== "C01" || core.attemptGeneration !== 1 || core.acceptanceContractVersion !== contract.version || core.receiptVariant !== "ordinary-v1") throw new Error("C01 frozen subject contract mismatch");
  if (core.sideEffectHead !== null || core.ciIdentity !== null || core.supersedesReceiptDigest !== null) throw new Error("C01 frozen side-effect contract mismatch");
}
const commands = results.map((result) => result.command);
const tsPackages = new Set(document.typescriptPackages ?? []);
for (const packageName of tsPackages) {
  if (!commands.some((command) => command.includes(`--filter ${packageName}`) && command.includes("typecheck")) && !commands.includes("corepack pnpm run typecheck")) throw new Error(`missing typecheck for ${packageName}`);
}
if (document.requiresBoundaryCheck === true && !commands.includes("corepack pnpm run boundaries:check")) throw new Error("missing boundary check");
console.log(`${id} acceptance contract verified (${commands.length} commands)`);
function verifyManifest(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) usage();
    options.set(key.slice(2), value);
  }
  if (options.size !== 2 || !options.has("subject") || !options.has("version")) usage();
  const subject = options.get("subject");
  const contract = contracts.get(subject);
  if (!contract) throw new Error(`no frozen acceptance contract for ${subject}`);
  if (options.get("version") !== contract.version) throw new Error(`${subject} acceptance contract version mismatch`);
  const expectedFirst = `node scripts/acceptance.mjs verify-manifest --subject ${subject} --version ${contract.version}`;
  if (contract.commands[0] !== expectedFirst || new Set(contract.commands).size !== contract.commands.length) throw new Error(`${subject} frozen ordered manifest is invalid`);
  console.log(`${subject} acceptance manifest ${contract.version} verified (${contract.commands.length} commands)`);
  process.exit(0);
}
function usage() { console.error("Usage: node scripts/acceptance.mjs verify <ID> <record.json> | verify-manifest --subject <ID> --version <version>"); process.exit(2); }
