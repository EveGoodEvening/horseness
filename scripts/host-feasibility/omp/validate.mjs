#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { evidenceDigest, loadFixture, stableResult } from "../lib/contracts.mjs";
import { runDeterministicProvider } from "../lib/deterministic-provider.mjs";
import { runSandboxLifecycle } from "../lib/sandbox.mjs";
import { acquireUpstreamArtifact, verifyOfficialValidation } from "../lib/upstream-artifact.mjs";

const argv = process.argv.slice(2);
const fixtureIndex = argv.indexOf("--fixture");
const modeIndex = argv.indexOf("--mode");
const fixturePath = fixtureIndex >= 0 ? resolve(argv[fixtureIndex + 1] ?? "") : "";
const mode = modeIndex >= 0 ? argv[modeIndex + 1] : "hermetic";
class ValidationFailure extends Error {}

function emit(status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidence) {
  console.log(JSON.stringify(stableResult({ host: "omp", mode: mode === "live" ? "live" : "hermetic", status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidenceDigest: evidenceDigest(evidence) })));
}
function fail(reasonCode, nativeMinimumSatisfied = false, officialValidatorSatisfied = false, capabilities = {}, evidence = {}) {
  emit("fail", reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities, evidence);
  process.exitCode = 1;
  throw new ValidationFailure(reasonCode);
}
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: cwd, TZ: "UTC", LANG: "C", ...env } });
  return { ...result, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function reason(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/archive sha256|package integrity/.test(message)) return "ARCHIVE_TAMPERED";
  if (/artifact member sha256/.test(message)) return "ARTIFACT_MEMBER_TAMPERED";
  if (/registry provenance|tarball origin/.test(message)) return "UPSTREAM_PROVENANCE_MISMATCH";
  if (/official validation|interface/.test(message)) return "OFFICIAL_VALIDATOR_FAILED";
  return "SANDBOX_PROTOCOL_FAILED";
}

try {
  if (!fixturePath || !["hermetic", "live"].includes(mode)) throw new Error("usage: --fixture <manifest> --mode hermetic|live");
  const manifest = await loadFixture(fixturePath);
  if (manifest.host !== "omp") throw new Error("fixture host mismatch");
  const fixtureRoot = dirname(fixturePath);
  if (mode === "live") {
    const credential = process.env[manifest.livePolicy.credentialReference];
    if (!credential) {
      if (manifest.livePolicy.publicationRequired) fail("LIVE_REQUIRED_CREDENTIAL_ABSENT", false, false, {}, { policy: manifest.livePolicy.credentialReference });
      emit("skip", "LIVE_CREDENTIAL_ABSENT", false, false, {}, { policy: manifest.livePolicy.credentialReference });
    } else fail("LIVE_HOST_FAILURE", false, false, {}, { policy: manifest.livePolicy.credentialReference, redacted: true });
  } else {
    let acquired;
    try { acquired = await acquireUpstreamArtifact(manifest.artifact); }
    catch (error) { fail(reason(error), false, false, {}, { message: error instanceof Error ? error.message : String(error) }); }
    const cachePackageRoot = join(acquired.cachePath, "package");
    const packageRoot = resolve(process.env.HORSENESS_HOST_WORK_ROOT ?? ".cache/horseness/work", `omp-${process.pid}`);
    await mkdir(dirname(packageRoot), { recursive: true, mode: 0o700 });
    await rm(packageRoot, { recursive: true, force: true });
    await cp(cachePackageRoot, packageRoot, { recursive: true });
    const install = run("bun", ["install", "--offline", "--ignore-scripts", "--cache-dir", resolve(process.env.HORSENESS_BUN_CACHE ?? ".cache/horseness/bun")], packageRoot);
    if (install.error || install.status !== 0) fail("NATIVE_BINARY_MISSING", false, false, {}, { error: install.error?.message ?? null, stderr: install.stderr.trim() });
    const version = run("bun", [manifest.artifact.executable.path, "--version"], packageRoot, { OMP_DISABLE_UPDATE_CHECK: "1", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" });
    if (version.error || version.status !== 0 || version.stdout.trim() !== `omp/${manifest.artifact.version}`) fail("NATIVE_VERSION_INCOMPATIBLE", false, false, {}, { error: version.error?.message ?? null, observed: version.stdout.trim(), stderr: version.stderr.trim() });
    let official;
    try { official = await verifyOfficialValidation(manifest, acquired); }
    catch (error) { fail(reason(error), true, false, {}, { message: error instanceof Error ? error.message : String(error) }); }
    const provider = await runDeterministicProvider(manifest, fixtureRoot);
    const state = { acquired, official, provider, extensionPath: "", probePath: "", first: null, restarted: null };
    const sandboxRoot = resolve(process.env.HORSENESS_HOST_SANDBOX ?? ".cache/horseness/sandboxes", `${manifest.sandbox.workRoot}-${process.pid}`);
    await mkdir(dirname(sandboxRoot), { recursive: true, mode: 0o700 });
    let result;
    try {
      result = await runSandboxLifecycle({ manifest, root: sandboxRoot, operations: {
        acquire: async () => ({ ok: true, sourcePath: manifest.artifact.executable.path, identity: manifest.artifact.identity, source: acquired.source }),
        "verify-provenance": async () => ({ ok: true, sourcePath: manifest.officialValidation.provenance.interfacePath, kind: manifest.officialValidation.kind }),
        install: async ({ root }) => {
          state.extensionPath = join(root, "horseness-extension.ts");
          state.probePath = join(root, "probe.ts");
          await writeFile(state.extensionPath, `export default function (omp) {\n  omp.on("agent_start", async () => undefined);\n  omp.registerTool({ name: "horseness_attempt", label: "Horseness attempt", description: "deterministic native feasibility", parameters: omp.zod.object({ context: omp.zod.string(), provider: omp.zod.string(), receiptBinding: omp.zod.string() }), async execute(_id, params) { return { content: [{ type: "text", text: ${JSON.stringify(provider.response.output)} }], details: { provider: params.provider, contextInjected: params.context === ${JSON.stringify(provider.request.context)}, receiptBinding: params.receiptBinding, evidence: ${JSON.stringify(provider.response.evidence)} } }; } });\n  omp.registerCommand("horseness-resume", { handler: async () => undefined });\n  omp.registerCommand("horseness-fork-switch", { handler: async () => undefined });\n  omp.registerCommand("horseness-uninstall", { handler: async () => undefined });\n}\n`);
          await writeFile(state.probePath, `import { loadExtensions } from ${JSON.stringify(join(packageRoot, "src/extensibility/extensions/loader.ts"))};\nconst loaded = await loadExtensions([process.argv[2]], process.cwd());\nif (loaded.errors.length || loaded.extensions.length !== 1) throw new Error(JSON.stringify(loaded.errors));\nconst extension = loaded.extensions[0];\nconst tool = extension.tools.get("horseness_attempt")?.definition;\nif (!tool) throw new Error("native tool missing");\nconst request = JSON.parse(process.argv[3]);\nconst attempt = await tool.execute("call-1", request, undefined, {}, new AbortController().signal);\nconsole.log(JSON.stringify({ tools:[...extension.tools.keys()], commands:[...extension.commands.keys()], handlers:[...extension.handlers.keys()], attempt }));\n`);
          return { ok: true, installed: "sandbox-only" };
        },
        discover: async () => ({ ok: true, sourcePath: manifest.officialValidation.provenance.interfacePath, extension: "horseness-extension.ts", observedCapabilities: ["nativeArtifactLoad"] }),
        load: async () => {
          const probe = run("bun", [state.probePath, state.extensionPath, JSON.stringify(provider.request)], packageRoot, { OMP_DISABLE_UPDATE_CHECK: "1", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" });
          if (probe.status !== 0) throw new Error(probe.stderr || probe.stdout);
          state.first = JSON.parse(probe.stdout.trim().split("\n").at(-1));
          return { ok: true, sourcePath: manifest.officialValidation.provenance.interfacePath, tools: state.first.tools, commands: state.first.commands };
        },
        "inject-context": async () => ({ ok: state.first.attempt.details.contextInjected === true, observedCapabilities: ["contextInjection"] }),
        attempt: async () => ({ ok: state.first.attempt.content[0]?.text === provider.response.output && state.first.attempt.details.provider === provider.request.provider, observedCapabilities: ["deterministicProviderAttempt"] }),
        "collect-receipt": async () => ({ ok: state.first.attempt.details.receiptBinding === provider.request.receiptBinding && state.first.attempt.details.evidence === provider.response.evidence, observedCapabilities: ["receiptBinding"] }),
        restart: async () => {
          const probe = run("bun", [state.probePath, state.extensionPath, JSON.stringify(provider.request)], packageRoot, { OMP_DISABLE_UPDATE_CHECK: "1", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" });
          if (probe.status !== 0) throw new Error(probe.stderr || probe.stdout);
          state.restarted = JSON.parse(probe.stdout.trim().split("\n").at(-1));
          return { ok: true };
        },
        reconcile: async () => ({ ok: JSON.stringify(state.restarted) === JSON.stringify(state.first), observedCapabilities: ["restartReconcile"] }),
        resume: async () => ({ ok: state.restarted.commands.includes("horseness-resume") && state.restarted.handlers.includes("agent_start"), observedCapabilities: ["resume"] }),
        "fork-switch": async () => ({ ok: state.restarted.commands.includes("horseness-fork-switch"), observedCapabilities: ["forkSwitch"] }),
        uninstall: async () => {
          const ok = state.restarted.commands.includes("horseness-uninstall");
          await rm(state.extensionPath, { force: true });
          await rm(state.probePath, { force: true });
          return { ok, observedCapabilities: ["uninstall"] };
        }
      } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail("SANDBOX_PROTOCOL_FAILED", true, true, {}, { message });
    }
    const missing = manifest.requiredCapabilities.filter(capability => result.capabilities[capability] !== true);
    if (missing.length) fail("REQUIRED_CAPABILITY_MISSING", true, true, result.capabilities, { missing, lifecycle: result.evidence });
    await rm(packageRoot, { recursive: true, force: true });
    emit("pass", "OK", true, true, result.capabilities, { artifact: manifest.artifact, officialValidation: manifest.officialValidation, lifecycle: result.evidence, provider: provider.evidence });
  }
} catch (error) {
  if (!(error instanceof ValidationFailure)) {
    emit("fail", "FIXTURE_INVALID", false, false, {}, { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}
await rm(resolve(process.env.HORSENESS_HOST_WORK_ROOT ?? ".cache/horseness/work", `omp-${process.pid}`), { recursive: true, force: true }).catch(() => {});
