import { readFile } from "node:fs/promises";
import process from "node:process";

const C01 = [
  `node -e "const fs=require('fs'),crypto=require('crypto');const a=fs.readFileSync('docs/validation/c00-contract-gate.node-e.txt'),b=fs.readFileSync('scripts/c00-contract-gate.mjs');if(!a.equals(b))process.exit(1);console.log(crypto.createHash('sha256').update(a).digest('hex'))"`,
  "node scripts/c00-contract-gate.mjs",
  "node scripts/progress-cas.mjs verify-live-bootstrap --receipt docs/checkpoints/C00/bootstrap/0.json --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --integrated-head HEAD --strict",
  "node scripts/progress-cas.mjs verify-live-claim --claim docs/claims/C01/1.json --claim-index docs/claims/index.jsonl --checkpoint-index docs/checkpoints/index.jsonl --trust docs/checkpoints/trust.json --now 2026-01-01T00:30:00Z --integrated-head HEAD --strict",
  "node scripts/progress-cas.mjs verify-fixture-bundle --bundle docs/checkpoints/fixtures/c01-bundle-v1 --strict",
  "corepack pnpm install --frozen-lockfile",
  "corepack pnpm run docs:lint",
  "corepack pnpm run typecheck",
  "corepack pnpm run lint",
  "corepack pnpm run test",
  "corepack pnpm run boundaries:check"
];
const contracts = new Map([["C01", C01]]);
const [mode, id, file] = process.argv.slice(2);
if (mode !== "verify" || !id || !file) usage();
const expected = contracts.get(id);
if (!expected) throw new Error(`no frozen acceptance contract for ${id}`);
const document = JSON.parse(await readFile(file, "utf8"));
const results = document.core?.commandResults ?? document.commandResults ?? document.commands;
if (!Array.isArray(results)) throw new Error("acceptance record has no command list");
const commands = results.map((entry) => typeof entry === "string" ? entry : entry.command);
if (commands.length !== expected.length || commands.some((command, index) => command !== expected[index])) {
  throw new Error(`${id} acceptance commands differ from frozen ordered contract`);
}
for (const [index, result] of results.entries()) {
  if (typeof result === "string") continue;
  if (result.ordinal !== index) throw new Error(`non-contiguous command ordinal ${index}`);
  if (result.exitCode !== 0) throw new Error(`command ${index} did not succeed`);
  if (!Array.isArray(result.artifacts)) throw new Error(`command ${index} has invalid artifacts`);
}
const tsPackages = new Set(document.typescriptPackages ?? []);
for (const packageName of tsPackages) {
  if (!commands.some((command) => command.includes(`--filter ${packageName}`) && command.includes("typecheck")) && !commands.includes("corepack pnpm run typecheck")) throw new Error(`missing typecheck for ${packageName}`);
}
if (document.requiresBoundaryCheck === true && !commands.includes("corepack pnpm run boundaries:check")) throw new Error("missing boundary check");
console.log(`${id} acceptance contract verified (${commands.length} commands)`);
function usage() { console.error("Usage: node scripts/acceptance.mjs verify <ID> <record.json>"); process.exit(2); }
