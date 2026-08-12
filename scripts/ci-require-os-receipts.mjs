import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const RECEIPT_VERSION = "horseness.os-receipt.v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const OS_NAMES = new Set(["linux", "macos", "windows"]);
const REQUIRED_GATES = Object.freeze([
  "c13:typecheck",
  "c13:multiprocess",
]);

function fail(message) {
  throw new Error(`C13 OS receipt verification failed: ${message}`);
}

function expectedCandidateSha() {
  const value = process.env.HORSENESS_CANDIDATE_SHA
    ?? process.env.GITHUB_HEAD_SHA
    ?? process.env.GITHUB_SHA;
  if (value === undefined || !SHA_PATTERN.test(value)) {
    fail("set HORSENESS_CANDIDATE_SHA (or a GitHub candidate SHA) to a 40-character lowercase commit SHA");
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has unexpected fields`);
  }
}

function validateReceipt(value, chunk, os, candidateSha) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${os} receipt is not an object`);
  }
  exactKeys(value, ["version", "chunk", "os", "candidateSha", "gates"], `${os} receipt`);
  if (value.version !== RECEIPT_VERSION) fail(`${os} receipt version mismatch`);
  if (value.chunk !== chunk) fail(`${os} receipt chunk mismatch`);
  if (value.os !== os) fail(`${os} receipt OS mismatch`);
  if (value.candidateSha !== candidateSha) fail(`${os} receipt candidate SHA mismatch`);
  if (!Array.isArray(value.gates) || value.gates.length !== REQUIRED_GATES.length) {
    fail(`${os} receipt gate count mismatch`);
  }
  for (let index = 0; index < REQUIRED_GATES.length; index += 1) {
    const gate = value.gates[index];
    if (gate === null || typeof gate !== "object" || Array.isArray(gate)) {
      fail(`${os} receipt gate ${index + 1} is not an object`);
    }
    exactKeys(gate, ["name", "status"], `${os} receipt gate ${index + 1}`);
    if (gate.name !== REQUIRED_GATES[index]) fail(`${os} receipt gate ${index + 1} name/order mismatch`);
    if (gate.status !== "passed") fail(`${os} receipt gate ${gate.name} did not pass`);
  }
}

async function findReceipt(directory, chunk, os) {
  const direct = resolve(directory, `${chunk}-${os}.json`);
  try {
    return { path: direct, text: await readFile(direct, "utf8") };
  } catch (error) {
    if (error === null || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }

  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch((error) => {
    if (error === null || typeof error !== "object" || error.code !== "ENOENT") throw error;
    fail(`receipt directory does not exist: ${directory}`);
  });
  const matches = entries.filter((entry) => entry.isFile() && entry.name === `${chunk}-${os}.json`);
  if (matches.length !== 1) fail(`expected exactly one ${chunk}-${os}.json receipt, found ${matches.length}`);
  const match = matches[0];
  const path = resolve(match.parentPath, match.name);
  return { path, text: await readFile(path, "utf8") };
}

async function main() {
  const argumentsAfterNode = process.argv.slice(2);
  const commandArguments = argumentsAfterNode[0] === "--"
    ? argumentsAfterNode.slice(1)
    : argumentsAfterNode;
  const [chunk, ...oses] = commandArguments;
  if (chunk === undefined || oses.length === 0) {
    fail("usage: ci-require-os-receipts.mjs <chunk> <linux|macos|windows>...");
  }
  if (new Set(oses).size !== oses.length) fail("duplicate requested OS");
  for (const os of oses) if (!OS_NAMES.has(os)) fail(`unsupported OS: ${os}`);

  const candidateSha = expectedCandidateSha();
  const directory = resolve(process.env.HORSENESS_OS_RECEIPTS_DIR ?? ".ci/os-receipts");
  for (const os of oses) {
    const receipt = await findReceipt(directory, chunk, os);
    let value;
    try {
      value = JSON.parse(receipt.text);
    } catch {
      fail(`${receipt.path} is not valid JSON`);
    }
    validateReceipt(value, chunk, os, candidateSha);
  }
  process.stdout.write(`Verified ${oses.length} ${chunk} OS receipts for ${candidateSha}\n`);
}

await main();
