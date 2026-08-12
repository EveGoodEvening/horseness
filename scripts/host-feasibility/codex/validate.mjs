#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evidenceDigest, loadFixture, stableResult } from "../lib/contracts.mjs";
import { runDeterministicProvider } from "../lib/deterministic-provider.mjs";
import { parseValidatorArgs } from "../lib/runner.mjs";

const capabilityNames = ["nativeArtifactLoad", "contextInjection", "deterministicProviderAttempt", "receiptBinding", "restartReconcile", "resume", "forkSwitch", "uninstall"];
let args;
try { args = parseValidatorArgs(process.argv.slice(2)); }
catch (error) { emitFailure("hermetic", "FIXTURE_INVALID", {}, error); }

let raw;
try { raw = JSON.parse(await readFile(args.fixture, "utf8")); }
catch (error) { emitFailure(args.mode, "FIXTURE_INVALID", {}, error); }
if (raw.host !== "codex") emitFailure(args.mode, "FIXTURE_INVALID", {}, new Error("fixture host must be codex"));
if (raw.native?.mode !== "native") emitFailure(args.mode, "CLI_ONLY_FALLBACK", {}, new Error("CLI-only cannot satisfy Codex native minimum"));

let manifest;
try { manifest = await loadFixture(args.fixture); }
catch (error) { emitFailure(args.mode, "FIXTURE_INVALID", {}, error); }

if (args.mode === "live") {
  const reference = manifest.livePolicy.credentialReference;
  if (!process.env[reference]) {
    const reasonCode = manifest.livePolicy.publicationRequired ? "LIVE_REQUIRED_CREDENTIAL_ABSENT" : "LIVE_CREDENTIAL_ABSENT";
    emit(stableResult({ host: "codex", mode: "live", status: manifest.livePolicy.publicationRequired ? "fail" : "skip", reasonCode, nativeMinimumSatisfied: false, officialValidatorSatisfied: false, capabilities: capabilityMap(false), evidenceDigest: evidenceDigest({ host: "codex", mode: "live", reasonCode, credentialReference: reference }) }));
  }
  emitFailure("live", "LIVE_HOST_FAILURE", {}, new Error("credentialed live Codex validation is unavailable in the hermetic fixture harness"));
}

const root = dirname(resolve(args.fixture));
const nativePath = resolve(root, manifest.native.binary);
const validatorPath = resolve(root, manifest.officialValidator.command[0]);
await verifyArtifact(nativePath, manifest.native.distributionDigest, "NATIVE_BINARY_MISSING", "NATIVE_BINARY_TAMPERED");
await verifyArtifact(validatorPath, manifest.officialValidator.distributionDigest, "OFFICIAL_VALIDATOR_MISSING", "OFFICIAL_VALIDATOR_TAMPERED");
const nativeVersion = run(nativePath, ["--version"]);
if (!nativeVersion.ok || !nativeVersion.stdout.includes(manifest.native.version)) emitFailure("hermetic", "NATIVE_VERSION_INCOMPATIBLE", {}, nativeVersion.error);
const validatorVersion = run(validatorPath, ["--version"]);
if (!validatorVersion.ok || !validatorVersion.stdout.includes(manifest.officialValidator.version)) emitFailure("hermetic", "OFFICIAL_VALIDATOR_FAILED", {}, validatorVersion.error);

const unsupported = manifest.capabilities.required.filter((name) => !manifest.capabilities.supported.includes(name));
if (unsupported.length) emitFailure("hermetic", "REQUIRED_CAPABILITY_MISSING", Object.fromEntries(unsupported.map((name) => [name, false])), new Error(`unsupported: ${unsupported.join(",")}`));

const work = await mkdtemp(resolve(tmpdir(), "horseness-codex-feasibility-"));
try {
  const provider = await runDeterministicProvider(manifest, root);
  const request = provider.request;
  const input = {
    context: request.context,
    session: request.session,
    resumeCursor: request.resumeCursor,
    binding: request.binding,
    forkBinding: request.forkBinding,
    provider: manifest.provider.identity
  };
  const inputPath = resolve(work, "input.json");
  const outputPath = resolve(work, "native-output.json");
  await writeFile(inputPath, JSON.stringify(input));
  const native = run(nativePath, ["host-feasibility", "--input", inputPath]);
  if (!native.ok) emitFailure("hermetic", "REQUIRED_CAPABILITY_MISSING", {}, native.error);
  let record;
  try { record = JSON.parse(native.stdout); } catch (error) { emitFailure("hermetic", "EVIDENCE_MISMATCH", {}, error); }
  await writeFile(outputPath, JSON.stringify(record));
  const official = run(validatorPath, [outputPath]);
  const contribution = record.contribution ?? {};
  const capabilities = {
    nativeArtifactLoad: record.native === true && record.cliFallback === false && typeof contribution.plugin === "string" && typeof contribution.skill === "string" && typeof contribution.mcp === "string",
    contextInjection: record.contextInjected === true,
    deterministicProviderAttempt: record.attempt?.provider === manifest.provider.identity && record.attempt?.output === provider.response.output && record.attempt?.evidence === provider.response.evidence,
    receiptBinding: record.receiptBinding?.attemptId === record.attempt?.id && record.receiptBinding?.binding === request.binding,
    restartReconcile: record.restartReconcile?.state === "reconciled" && record.restartReconcile?.attemptId === record.attempt?.id && record.restartReconcile?.receiptId === record.receiptBinding?.id,
    resume: record.resume?.supported === true && record.resume?.thread === request.session && record.resume?.cursor === request.resumeCursor && record.resume?.attemptId === record.attempt?.id,
    forkSwitch: record.forkSwitch?.state === "switched" && record.forkSwitch?.from === request.binding && record.forkSwitch?.to === request.forkBinding && record.forkSwitch?.from !== record.forkSwitch?.to,
    uninstall: record.uninstall?.state === "clean" && ["plugin", "skill", "mcp"].every((item) => record.uninstall?.removed?.includes(item))
  };
  if (!official.ok) emitFailure("hermetic", "OFFICIAL_VALIDATOR_FAILED", capabilities, official.error);
  if (!capabilityNames.every((name) => capabilities[name])) emitFailure("hermetic", "REQUIRED_CAPABILITY_MISSING", capabilities, new Error("Codex native contribution capability missing"));
  const evidence = { host: "codex", nativeIdentity: manifest.native.distributionIdentity, validatorIdentity: manifest.officialValidator.distributionIdentity, provider: provider.evidence, record, capabilities };
  emit(stableResult({ host: "codex", mode: "hermetic", status: "pass", reasonCode: "OK", nativeMinimumSatisfied: true, officialValidatorSatisfied: true, capabilities, evidenceDigest: evidenceDigest(evidence) }));
} finally { await rm(work, { recursive: true, force: true }); }

async function verifyArtifact(path, expected, missingCode, tamperedCode) {
  let bytes;
  try { bytes = await readFile(path); } catch (error) { emitFailure(args.mode, missingCode, {}, error); }
  const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== expected) emitFailure(args.mode, tamperedCode, {}, new Error(`digest mismatch for ${path}`));
}
function run(executable, executableArgs) {
  const result = spawnSync(process.execPath, [executable, ...executableArgs], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH ?? "", HOME: resolve(tmpdir(), "horseness-codex-no-home"), CI: "1", TZ: "UTC", LANG: "C", HORSENESS_NETWORK: "disabled" } });
  return { ok: result.status === 0 && !result.signal, stdout: result.stdout?.trim() ?? "", error: new Error(result.stderr?.trim() || `exit ${result.status ?? "signal"}`) };
}
function capabilityMap(value) { return Object.fromEntries(capabilityNames.map((name) => [name, value])); }
function emitFailure(mode, reasonCode, partial, error) {
  const capabilities = { ...capabilityMap(false), ...partial };
  emit(stableResult({ host: "codex", mode, status: "fail", reasonCode, nativeMinimumSatisfied: false, officialValidatorSatisfied: false, capabilities, evidenceDigest: evidenceDigest({ host: "codex", mode, reasonCode, capabilities, error: error?.message ?? "unknown" }) }));
}
function emit(result) { process.stdout.write(`${JSON.stringify(result)}\n`); process.exit(result.status === "fail" ? 1 : 0); }
