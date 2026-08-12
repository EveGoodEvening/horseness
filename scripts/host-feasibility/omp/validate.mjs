#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { evidenceDigest, loadFixture, stableResult } from "../lib/contracts.mjs";
import { runDeterministicProvider } from "../lib/deterministic-provider.mjs";

const argv = process.argv.slice(2);
const fixtureIndex = argv.indexOf("--fixture");
const modeIndex = argv.indexOf("--mode");
const fixturePath = fixtureIndex >= 0 ? resolve(argv[fixtureIndex + 1] ?? "") : "";
const mode = modeIndex >= 0 ? argv[modeIndex + 1] : "hermetic";
let manifest;
class ValidationFailure extends Error {}

function digest(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function run(command, args) { return spawnSync(process.execPath, [command, ...args], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", TZ: "UTC", LANG: "C" } }); }
function emit(status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidence) {
  console.log(JSON.stringify(stableResult({ host: "omp", mode: mode === "live" ? "live" : "hermetic", status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidenceDigest: evidenceDigest(evidence) })));
}
function fail(reasonCode, nativeMinimumSatisfied = false, officialValidatorSatisfied = false, capabilities = {}, evidence = {}) {
  emit("fail", reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidence);
  process.exitCode = 1;
  throw new ValidationFailure(reasonCode);
}

try {
  if (!fixturePath || !["hermetic", "live"].includes(mode)) throw new Error("usage: --fixture <manifest> --mode hermetic|live");
  manifest = await loadFixture(fixturePath);
  if (manifest.host !== "omp") throw new Error("fixture host mismatch");
  const root = dirname(fixturePath);
  if (mode === "live") {
    const credential = process.env[manifest.livePolicy.credentialReference];
    if (!credential) {
      if (manifest.livePolicy.publicationRequired) fail("LIVE_REQUIRED_CREDENTIAL_ABSENT", false, false, {}, { policy: manifest.livePolicy.credentialReference });
      else emit("skip", "LIVE_CREDENTIAL_ABSENT", false, false, {}, { policy: manifest.livePolicy.credentialReference });
    } else fail("LIVE_HOST_FAILURE", false, false, {}, { policy: manifest.livePolicy.credentialReference, redacted: true });
  } else {
    const binary = resolve(root, manifest.native.binary);
    let binaryBytes;
    try { binaryBytes = await readFile(binary); } catch { fail("NATIVE_BINARY_MISSING", false, false, {}, { binary: manifest.native.distributionIdentity }); }
    if (digest(binaryBytes) !== manifest.native.distributionDigest) fail("NATIVE_BINARY_TAMPERED", false, false, {}, { binary: manifest.native.distributionIdentity });
    if (manifest.native.mode !== "native") fail("CLI_ONLY_FALLBACK", false, false, {}, { mode: manifest.native.mode });
    const version = run(binary, ["--version"]);
    if (version.status !== 0 || version.stdout.trim() !== `omp/${manifest.native.version}`) fail("NATIVE_VERSION_INCOMPATIBLE", false, false, {}, { observed: version.stdout.trim() });
    const validator = resolve(root, manifest.officialValidator.command);
    let validatorBytes;
    try { validatorBytes = await readFile(validator); } catch { fail("OFFICIAL_VALIDATOR_MISSING", true, false, {}, { validator: manifest.officialValidator.distributionIdentity }); }
    if (digest(validatorBytes) !== manifest.officialValidator.distributionDigest) fail("OFFICIAL_VALIDATOR_TAMPERED", true, false, {}, { validator: manifest.officialValidator.distributionIdentity });
    const missing = manifest.capabilities.required.filter((capability) => !manifest.capabilities.supported.includes(capability));
    if (missing.length) fail("REQUIRED_CAPABILITY_MISSING", true, false, Object.fromEntries(manifest.capabilities.required.map((c) => [c, !missing.includes(c)])), { missing });
    const provider = await runDeterministicProvider(manifest, root);
    const temp = await mkdtemp(resolve(tmpdir(), "horseness-omp-"));
    try {
      const input = resolve(temp, "input.json");
      const output = resolve(temp, "output.json");
      await writeFile(input, JSON.stringify(provider.request));
      const nativeRun = run(binary, ["host-feasibility", "--input", input]);
      if (nativeRun.status !== 0) fail("EVIDENCE_MISMATCH", true, false, {}, { stderr: nativeRun.stderr });
      const record = JSON.parse(nativeRun.stdout);
      await writeFile(output, JSON.stringify(record));
      const checked = run(validator, [output]);
      if (checked.status !== 0 || JSON.parse(checked.stdout).status !== "pass") fail("OFFICIAL_VALIDATOR_FAILED", true, false, {}, { validatorExit: checked.status });
      const capabilities = {
        nativeArtifactLoad: record.native === true && record.contribution === "omp-plugin-skills",
        contextInjection: record.contextInjected === true,
        deterministicProviderAttempt: record.attempt?.provider === manifest.provider.identity && record.attempt?.output === provider.response.output && record.attempt?.evidence === provider.response.evidence,
        receiptBinding: record.receiptBinding === provider.request.receiptBinding,
        restartReconcile: record.restartReconcile === manifest.resume.daemonRestart + "d",
        resume: record.resume?.supported === true && record.resume.session === provider.request.session && record.resume.cursor === provider.request.resumeCursor,
        forkSwitch: record.forkSwitch === manifest.resume.forkSwitch,
        uninstall: record.uninstall === "clean"
      };
      if (Object.values(capabilities).some((value) => !value)) fail("EVIDENCE_MISMATCH", true, true, capabilities, { record, provider: provider.evidence });
      emit("pass", "OK", true, true, capabilities, { native: manifest.native, officialValidator: manifest.officialValidator, record, provider: provider.evidence, resume: manifest.resume });
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
} catch (error) {
  if (!(error instanceof ValidationFailure)) {
    emit("fail", "FIXTURE_INVALID", false, false, {}, { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}
