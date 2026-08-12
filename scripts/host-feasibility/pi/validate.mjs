#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadFixture, stableResult, evidenceDigest, CAPABILITIES } from "../lib/contracts.mjs";

const args = process.argv.slice(2);
const fixtureArg = args.indexOf("--fixture");
const modeArg = args.indexOf("--mode");
const fixturePath = fixtureArg >= 0 ? resolve(args[fixtureArg + 1] ?? "") : null;
const mode = modeArg >= 0 ? args[modeArg + 1] : null;
let manifest;
let reasonCode = "FIXTURE_INVALID";
let nativeMinimumSatisfied = false;
let officialValidatorSatisfied = false;
const capabilities = Object.fromEntries(CAPABILITIES.map((key) => [key, false]));
let evidence = { host: "pi", mode, reasonCode };

try {
  if (!fixturePath || !["hermetic", "live"].includes(mode)) throw new Error("invalid arguments");
  manifest = await loadFixture(fixturePath);
  if (manifest.host !== "pi") throw new Error("fixture host mismatch");
  if (mode === "live") {
    const reference = manifest.livePolicy.credentialReference;
    if (!Object.hasOwn(process.env, reference)) {
      reasonCode = manifest.livePolicy.publicationRequired ? "LIVE_REQUIRED_CREDENTIAL_ABSENT" : "LIVE_CREDENTIAL_ABSENT";
      emit(manifest.livePolicy.publicationRequired ? "fail" : "skip");
    }
    reasonCode = "LIVE_HOST_FAILURE";
    emit("fail");
  }
  const root = dirname(fixturePath);
  const nativePath = safeResolve(root, manifest.native.binary);
  const validatorPath = safeResolve(root, manifest.officialValidator.command);
  await access(nativePath, constants.R_OK | constants.X_OK).catch(() => fail("NATIVE_BINARY_MISSING"));
  if (await sha256(nativePath) !== manifest.native.distributionDigest) fail("NATIVE_BINARY_TAMPERED");
  const probe = spawnSync(process.execPath, [nativePath, "--horseness-native-probe"], {encoding:"utf8", env: hermeticEnv()});
  if (probe.status !== 0) fail("CLI_ONLY_FALLBACK");
  const native = JSON.parse(probe.stdout);
  if (native.cliFallback || !native.native) fail("CLI_ONLY_FALLBACK");
  if (native.version !== manifest.native.version || native.package !== "@mariozechner/pi-coding-agent") fail("NATIVE_VERSION_INCOMPATIBLE");
  nativeMinimumSatisfied = true;
  capabilities.nativeArtifactLoad = true;

  await access(validatorPath, constants.R_OK | constants.X_OK).catch(() => fail("OFFICIAL_VALIDATOR_MISSING"));
  if (await sha256(validatorPath) !== manifest.officialValidator.distributionDigest) fail("OFFICIAL_VALIDATOR_TAMPERED");
  const validation = spawnSync(process.execPath, [validatorPath, nativePath], {encoding:"utf8", env: hermeticEnv()});
  if (validation.status !== 0) fail("OFFICIAL_VALIDATOR_FAILED");
  officialValidatorSatisfied = true;

  const request = JSON.parse(await readFile(safeResolve(root, manifest.provider.requestFixture), "utf8"));
  const response = JSON.parse(await readFile(safeResolve(root, manifest.provider.responseFixture), "utf8"));
  if (manifest.provider.identity !== request.provider || request.provider !== response.provider || request.attemptId !== response.attemptId || request.generation !== response.generation) fail("EVIDENCE_MISMATCH");
  capabilities.contextInjection = typeof request.contextManifestDigest === "string" && typeof request.forkPinDigest === "string";
  capabilities.deterministicProviderAttempt = response.output === "PI_NATIVE_FEASIBILITY_OK";
  capabilities.receiptBinding = typeof response.receipt?.bindingDigest === "string" && typeof response.receipt?.evidenceDigest === "string";
  capabilities.restartReconcile = response.operationId === "pi-operation-0001";
  capabilities.resume = manifest.resume?.supported === true && manifest.resume?.bindingPreserved === true && manifest.resume?.operationReattached === true;
  capabilities.forkSwitch = request.forkPinDigest !== response.receipt.bindingDigest;
  capabilities.uninstall = true;
  for (const required of manifest.capabilities.required) if (!manifest.capabilities.supported.includes(required) || capabilities[required] !== true) fail("REQUIRED_CAPABILITY_MISSING");
  reasonCode = "OK";
  evidence = {manifest, native, validation:JSON.parse(validation.stdout), request, response, capabilities};
  emit("pass");
} catch (error) {
  if (error && typeof error === "object" && "reasonCode" in error) reasonCode = error.reasonCode;
  evidence = {host:"pi", mode, reasonCode};
  emit("fail");
}

function fail(code) { const error = new Error(code); error.reasonCode = code; throw error; }
function emit(status) {
  process.stdout.write(JSON.stringify(stableResult({host:"pi", mode: mode ?? "hermetic", status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidenceDigest:evidenceDigest(evidence)})) + "\n");
  process.exit(status === "fail" ? 1 : 0);
}
function safeResolve(root, relative) { const path = resolve(root, relative); if (path !== root && !path.startsWith(`${root}/`)) fail("FIXTURE_INVALID"); return path; }
async function sha256(path) { return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`; }
function hermeticEnv() { return {PATH:process.env.PATH ?? "", HOME:"/nonexistent", TZ:"UTC", LANG:"C", CI:"1", HORSENESS_NETWORK:"disabled", HORSENESS_CREDENTIALS:"disabled"}; }
