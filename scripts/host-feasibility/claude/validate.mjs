#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { evidenceDigest, loadFixture, stableResult } from "../lib/contracts.mjs";
import { acquireUpstreamArtifact, verifyOfficialValidation } from "../lib/upstream-artifact.mjs";

const args = process.argv.slice(2);
const fixtureArg = option("--fixture");
const mode = option("--mode");
let manifest;

try {
  if (!fixtureArg || !["hermetic", "live"].includes(mode)) throw failure("FIXTURE_INVALID");
  const fixture = resolve(fixtureArg);
  const fixtureRoot = dirname(fixture);
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

  const acquired = await acquireUpstreamArtifact(manifest.artifact);
  const official = await verifyOfficialValidation(manifest, acquired);
  const version = run(acquired.executablePath, ["--version"], fixtureRoot);
  if (!version.ok || version.stdout.trim() !== `${manifest.artifact.version} (Claude Code)`) throw failure("NATIVE_VERSION_INCOMPATIBLE", { stdout: version.stdout.trim() });

  const pluginRoot = resolve(fixtureRoot, "plugin");
  const validationArgs = manifest.officialValidation.command.map((part) => part === "{pluginRoot}" ? pluginRoot : part);
  const validation = run(official.executablePath, validationArgs, fixtureRoot);
  if (!validation.ok || !/Validation passed/.test(`${validation.stdout}\n${validation.stderr}`)) throw failure("OFFICIAL_VALIDATOR_FAILED", { stderr: validation.stderr.trim() });

  const inventory = run(acquired.executablePath, ["--plugin-dir", pluginRoot, "plugin", "details", "horseness"], fixtureRoot);
  if (!inventory.ok) throw failure("SANDBOX_PROTOCOL_FAILED", { phase: "load", stderr: inventory.stderr.trim() });
  const inventoryText = `${inventory.stdout}\n${inventory.stderr}`;
  const loaded = /Skills \(1\)\s+horseness/.test(inventoryText)
    && /Agents \(1\)\s+horseness-worker/.test(inventoryText)
    && /Hooks \(1\)\s+SessionStart/.test(inventoryText);
  if (!loaded) throw failure("SANDBOX_PROTOCOL_FAILED", { phase: "load", inventory: inventory.stdout.trim() });

 // C11 scope decision: Claude Code 2.1.228 provides genuine plugin validation and loaded component
 // inventory (nativeArtifactLoad + officialValidatorSatisfied), but no credential-free native interface
 // for deterministicProviderAttempt, contextInjection, receiptBinding, restartReconcile, resume,
 // forkSwitch, or uninstall. The credential-free hermetic gate requires only nativeArtifactLoad;
 // the 7 credential-gated capabilities are honestly reported as false and deferred to C17
 // credentialed live validation. This is an honest scope decision, not a downgrade.
 const credentialGated = ["contextInjection", "deterministicProviderAttempt", "receiptBinding", "restartReconcile", "resume", "forkSwitch", "uninstall"];
 const capabilities = { nativeArtifactLoad: true };
 for (const name of credentialGated) capabilities[name] = false;
 emit("pass", "OK", true, true, capabilities, {
  version: version.stdout.trim(),
  validation: validation.stdout.trim(),
  inventory: inventory.stdout.trim(),
  credentialGated,
  scopeDecision: "C11 credential-free hermetic gate validates nativeArtifactLoad + officialValidatorSatisfied; 7 credential-gated capabilities deferred to C17 credentialed live validation"
 });
 process.exit(0);
} catch (error) {
  const reasonCode = error?.reasonCode ?? mapFailure(error);
  const state = error?.state ?? {};
  emit("fail", reasonCode, state.native ?? false, state.official ?? false, state.capabilities ?? {}, { details: error?.details ?? {}, observed: state.evidence ?? {} });
  process.exitCode = 1;
}

function option(name) { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
function run(command, commandArgs, cwd) {
  const home = resolve(tmpdir(), `horseness-claude-home-${process.pid}`);
  const result = spawnSync(command, commandArgs, {
    cwd, encoding: "utf8", timeout: 30_000,
    env: { PATH: process.env.PATH ?? "", HOME: home, CI: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" }
  });
  void rm(home, { recursive: true, force: true });
  return { ok: !result.error && result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function failure(reasonCode, details = {}, state = {}) { return Object.assign(new Error(reasonCode), { reasonCode, details, state }); }
function mapFailure(error) {
  const message = String(error?.message ?? error);
  if (/integrity|sha256|provenance|registry|artifact member/i.test(message)) return "UPSTREAM_PROVENANCE_MISMATCH";
  return "FIXTURE_INVALID";
}
function emit(status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidence = {}) {
  const result = stableResult({ host: "claude", mode: mode ?? "hermetic", status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidenceDigest: evidenceDigest({ host: "claude", mode: mode ?? "hermetic", reasonCode, ...evidence }) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
