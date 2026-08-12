#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadFixture, stableResult, evidenceDigest } from "../lib/contracts.mjs";
import { runDeterministicProvider } from "../lib/deterministic-provider.mjs";

const ownDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fixtureArg = option("--fixture");
const mode = option("--mode");
let manifest;
let fixtureRoot;

try {
  if (!fixtureArg || !["hermetic", "live"].includes(mode)) throw failure("FIXTURE_INVALID");
  const fixture = resolve(fixtureArg);
  fixtureRoot = dirname(fixture);
  manifest = await loadFixture(fixture);
  if (manifest.host !== "claude") throw failure("FIXTURE_INVALID");

  if (mode === "live") {
    const reference = process.env[manifest.livePolicy.credentialReference];
    if (!reference) {
      if (manifest.livePolicy.publicationRequired) throw failure("LIVE_REQUIRED_CREDENTIAL_ABSENT");
      emit("skip", "LIVE_CREDENTIAL_ABSENT", false, false, {});
      process.exit(0);
    }
    throw failure("LIVE_HOST_FAILURE");
  }

  const nativePath = confined(manifest.native.binary);
  await requireFile(nativePath, "NATIVE_BINARY_MISSING");
  await requireDigest(nativePath, manifest.native.distributionDigest, "NATIVE_BINARY_TAMPERED");
  const version = spawn(nativePath, ["--version"]);
  if (!version.ok || !version.stdout.includes(manifest.native.version)) throw failure("NATIVE_VERSION_INCOMPATIBLE");
  if (manifest.native.mode !== "native") throw failure("CLI_ONLY_FALLBACK");

  const validatorCommand = manifest.officialValidator.command;
  if (!Array.isArray(validatorCommand) || validatorCommand.length < 2) throw failure("OFFICIAL_VALIDATOR_MISSING");
  const validatorPath = confined(validatorCommand[0]);
  await requireFile(validatorPath, "OFFICIAL_VALIDATOR_MISSING");
  await requireDigest(validatorPath, manifest.officialValidator.distributionDigest, "OFFICIAL_VALIDATOR_TAMPERED");
  const validator = spawn(validatorPath, validatorCommand.slice(1));
  if (!validator.ok) throw failure("OFFICIAL_VALIDATOR_FAILED");

  const missing = manifest.capabilities.required.filter((capability) => !manifest.capabilities.supported.includes(capability));
  if (missing.length) throw failure("REQUIRED_CAPABILITY_MISSING", { missing });
  if (manifest.native.mode === "cli") throw failure("CLI_ONLY_FALLBACK");
  assertResume(manifest.resume);

  const provider = await runDeterministicProvider(manifest, fixtureRoot);
  if (provider.request.bindingDigest !== provider.response.receiptBindingDigest) throw failure("EVIDENCE_MISMATCH");
  const capabilities = Object.fromEntries(manifest.capabilities.required.map((name) => [name, true]));
  emit("pass", "OK", true, true, capabilities, {
    binaryVersion: manifest.native.version,
    binaryDigest: manifest.native.distributionDigest,
    officialValidator: manifest.officialValidator.distributionIdentity,
    providerDigest: provider.digest,
    resume: manifest.resume
  });
} catch (error) {
  const reasonCode = error?.reasonCode ?? "FIXTURE_INVALID";
  emit("fail", reasonCode, false, false, error?.details ?? {});
  process.exitCode = 1;
}

function option(name) { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
function confined(relative) {
  const path = resolve(fixtureRoot, relative);
  if (path !== fixtureRoot && !path.startsWith(`${fixtureRoot}/`)) throw failure("FIXTURE_INVALID");
  return path;
}
async function requireFile(path, reasonCode) { try { if (!(await stat(path)).isFile()) throw new Error(); } catch { throw failure(reasonCode); } }
async function requireDigest(path, expected, reasonCode) {
  const actual = `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
  if (actual !== expected) throw failure(reasonCode, { expected, actual });
}
function spawn(command, commandArgs) {
  const result = spawnSync(command, commandArgs.map((arg) => arg.startsWith("./") ? resolve(fixtureRoot, arg) : arg), { cwd: fixtureRoot, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: resolve(fixtureRoot, ".home"), CI: "1", NO_PROXY: "*", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" }, timeout: 10000 });
  return { ok: !result.error && result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function assertResume(resume) {
  const exact = ["daemonRestart", "hostRestart", "sessionResume", "forkSwitch"];
  if (!resume || Object.keys(resume).sort().join() !== exact.sort().join() || Object.values(resume).some((value) => typeof value !== "string" || !value)) throw failure("REQUIRED_CAPABILITY_MISSING");
}
function failure(reasonCode, details = {}) { return Object.assign(new Error(reasonCode), { reasonCode, details }); }
function emit(status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidence = {}) {
  const result = stableResult({ host: "claude", mode: mode ?? "hermetic", status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidenceDigest: evidenceDigest({ host: "claude", mode: mode ?? "hermetic", reasonCode, ...evidence }) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
