#!/usr/bin/env node
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadFixture, stableResult, evidenceDigest, CAPABILITIES } from "../lib/contracts.mjs";
import { acquireUpstreamArtifact, verifyOfficialValidation } from "../lib/upstream-artifact.mjs";
import { runSandboxLifecycle } from "../lib/sandbox.mjs";

const args = process.argv.slice(2);
const fixtureArg = args.indexOf("--fixture");
const modeArg = args.indexOf("--mode");
const fixturePath = fixtureArg >= 0 ? resolve(args[fixtureArg + 1] ?? "") : null;
const mode = modeArg >= 0 ? args[modeArg + 1] : null;
let reasonCode = "FIXTURE_INVALID";
let nativeMinimumSatisfied = false;
let officialValidatorSatisfied = false;
const capabilities = Object.fromEntries(CAPABILITIES.map(key => [key, false]));
let evidence = { host: "pi", mode, reasonCode };

try {
  if (!fixturePath || !["hermetic", "live"].includes(mode)) throw new Error("invalid arguments");
  const manifest = await loadFixture(fixturePath);
  if (manifest.host !== "pi") throw new Error("fixture host mismatch");
  if (mode === "live") {
    const reference = manifest.livePolicy.credentialReference;
    reasonCode = Object.hasOwn(process.env, reference) ? "LIVE_HOST_FAILURE" : manifest.livePolicy.publicationRequired ? "LIVE_REQUIRED_CREDENTIAL_ABSENT" : "LIVE_CREDENTIAL_ABSENT";
    emit(manifest.livePolicy.publicationRequired || Object.hasOwn(process.env, reference) ? "fail" : "skip");
  }
  const fixtureRoot = dirname(fixturePath);
  const acquired = await acquireUpstreamArtifact(manifest.artifact);
  nativeMinimumSatisfied = true;
  const official = await verifyOfficialValidation(manifest, acquired);
  officialValidatorSatisfied = true;
  const cachePackageRoot = join(acquired.cachePath, "package");
  const packageRoot = resolve(process.env.HORSENESS_HOST_WORK_ROOT ?? ".cache/horseness/work", `pi-${process.pid}`);
  await mkdir(dirname(packageRoot), { recursive: true, mode: 0o700 });
  await rm(packageRoot, { recursive: true, force: true });
  await cp(cachePackageRoot, packageRoot, { recursive: true });
  const install = spawnSync("bun", ["install", "--offline", "--ignore-scripts", "--cache-dir", resolve(process.env.HORSENESS_BUN_CACHE ?? ".cache/horseness/bun")], { cwd: packageRoot, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: packageRoot, TZ: "UTC", LANG: "C", CI: "1", HORSENESS_NETWORK: "disabled", HORSENESS_CREDENTIALS: "disabled" } });
  if (install.error || install.status !== 0) throw new Error(`native dependency install failed: ${install.error?.message ?? install.stderr.trim()}`);
  const extensionPath = join(fixtureRoot, "extension.mjs");
  const driverPath = join(fixtureRoot, "native-driver.mjs");
  const inputPath = join(fixtureRoot, "provider-request.json");
  const providerPath = join(fixtureRoot, "provider-response.json");
  const sandboxRoot = resolve(process.env.HORSENESS_PI_SANDBOX ?? join(".cache", "horseness", "sandboxes", `${manifest.sandbox.workRoot}-${process.pid}`));
  let observed;
  const lifecycle = await runSandboxLifecycle({ manifest, root: sandboxRoot, operations: {
    acquire: async () => ({ ok: true, sourcePath: manifest.artifact.executable.path, archiveSha256: manifest.artifact.archiveSha256, cacheSource: acquired.source }),
    "verify-provenance": async () => ({ ok: true, sourcePath: manifest.officialValidation.provenance.interfacePath, validationKind: manifest.officialValidation.kind, command: manifest.officialValidation.command }),
    install: async ({root}) => { await mkdir(join(root, "fixture")); await cp(extensionPath, join(root, "fixture", "extension.mjs")); await cp(driverPath, join(root, "fixture", "native-driver.mjs")); await cp(inputPath, join(root, "fixture", "input.json")); await cp(providerPath, join(root, "fixture", "provider.json")); return { ok: true }; },
    discover: async () => ({ ok: true, interface: "loadExtensions", sourcePath: manifest.officialValidation.provenance.interfacePath }),
    load: async ({root}) => { const run = spawnSync(process.execPath, [join(root,"fixture/native-driver.mjs"), packageRoot, join(root,"fixture/extension.mjs"), join(root,"state.json"), join(root,"fixture/input.json"), join(root,"fixture/provider.json")], { encoding:"utf8", env:{...hermeticEnv(), HOME:root} }); if (run.status !== 0) throw new Error(`native extension interface failed: ${run.stderr}`); observed = JSON.parse(run.stdout); await rm(join(root,"fixture"), {recursive:true}); return { ok:true, sourcePath:manifest.officialValidation.provenance.interfacePath, observedCapabilities:["nativeArtifactLoad"] }; },
    "inject-context": async () => ({ ok: observed.events.some(e => e.event === "session_start" && e.contextManifestDigest && e.forkPinDigest), observedCapabilities:["contextInjection"] }),
    attempt: async () => ({ ok: observed.events.some(e => e.event === "attempt" && e.output === "PI_NATIVE_FEASIBILITY_OK"), observedCapabilities:["deterministicProviderAttempt"] }),
    "collect-receipt": async () => ({ ok: observed.results.some(r => r?.message?.details?.bindingDigest && r?.message?.details?.evidenceDigest), observedCapabilities:["receiptBinding"] }),
    restart: async () => ({ ok: observed.events.some(e => e.event === "session_start" && e.reason === "reload") }),
    reconcile: async () => ({ ok: observed.events.some(e => e.event === "attempt" && e.attemptId === "pi-attempt-0001"), observedCapabilities:["restartReconcile"] }),
    resume: async () => ({ ok: observed.events.some(e => e.event === "session_start" && e.reason === "resume"), observedCapabilities:["resume"] }),
    "fork-switch": async () => ({ ok: observed.events.some(e => e.event === "fork_switch" && e.nextForkPinDigest), observedCapabilities:["forkSwitch"] }),
    uninstall: async () => ({ ok: observed.installed === false && observed.events.some(e => e.event === "uninstall"), observedCapabilities:["uninstall"] })
  }});
  Object.assign(capabilities, lifecycle.capabilities);
  for (const required of manifest.requiredCapabilities) if (capabilities[required] !== true) fail("REQUIRED_CAPABILITY_MISSING");
  reasonCode = "OK";
  evidence = { artifact: manifest.artifact.identity, acquisition: acquired.source, officialValidation: { kind: manifest.officialValidation.kind, source: official.source }, lifecycle: lifecycle.evidenceDigest };
  emit("pass");
} catch (error) {
  if (process.env.HORSENESS_DEBUG === "1") process.stderr.write(`${error?.stack ?? error}\n`);
  reasonCode = classify(error);
  evidence = {host:"pi", mode, reasonCode};
  emit("fail");
}

function fail(code) { const error = new Error(code); error.reasonCode = code; throw error; }
function classify(error) { if (error && typeof error === "object" && "reasonCode" in error) return error.reasonCode; const message = String(error?.message ?? error); if (/integrity|archive sha256|provenance|member sha256|cache path|symlink/i.test(message)) return "NATIVE_BINARY_TAMPERED"; if (/ENOENT|missing/i.test(message)) return "NATIVE_BINARY_MISSING"; if (/CLI_ONLY/i.test(message)) return "CLI_ONLY_FALLBACK"; if (/official|interface/i.test(message)) return "OFFICIAL_VALIDATOR_FAILED"; if (/capability/i.test(message)) return "REQUIRED_CAPABILITY_MISSING"; return "FIXTURE_INVALID"; }
function emit(status) { process.stdout.write(JSON.stringify(stableResult({host:"pi", mode:mode ?? "hermetic", status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidenceDigest:evidenceDigest(evidence)}))+"\n"); process.exit(status === "fail" ? 1 : 0); }
function hermeticEnv() { return { PATH:process.env.PATH ?? "", HOME:"/nonexistent", TZ:"UTC", LANG:"C", CI:"1", HORSENESS_NETWORK:"disabled", HORSENESS_CREDENTIALS:"disabled", HTTPS_PROXY:"http://127.0.0.1:9", HTTP_PROXY:"http://127.0.0.1:9" }; }
