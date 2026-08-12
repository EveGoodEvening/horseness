#!/usr/bin/env node
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadFixture, stableResult, evidenceDigest } from "../lib/contracts.mjs";
import { runDeterministicProvider } from "../lib/deterministic-provider.mjs";
import { acquireUpstreamArtifact, verifyOfficialValidation } from "../lib/upstream-artifact.mjs";
import { runSandboxLifecycle } from "../lib/sandbox.mjs";
import { parseValidatorArgs } from "../lib/runner.mjs";

const capabilities = ["nativeArtifactLoad", "contextInjection", "deterministicProviderAttempt", "receiptBinding", "restartReconcile", "resume", "forkSwitch", "uninstall"];
let args;
let manifest;
try {
  args = parseValidatorArgs(process.argv.slice(2));
  manifest = await loadFixture(args.fixture);
  if (manifest.host !== "codex") throw coded("FIXTURE_INVALID");
  if (args.mode === "live") {
    const reference = manifest.livePolicy.credentialReference;
    if (!process.env[reference]) {
      const required = manifest.livePolicy.publicationRequired;
      emit(required ? "fail" : "skip", required ? "LIVE_REQUIRED_CREDENTIAL_ABSENT" : "LIVE_CREDENTIAL_ABSENT", {}, false, false);
      process.exit(required ? 1 : 0);
    }
    throw coded("LIVE_HOST_FAILURE");
  }

  const acquired = await acquireUpstreamArtifact(manifest.artifact);
  const official = await verifyOfficialValidation(manifest, acquired);
  const hermeticRunEnv = { PATH: process.env.PATH ?? "", HOME: resolve(tmpdir(), `horseness-codex-home-${process.pid}`), CODEX_HOME: resolve(tmpdir(), `horseness-codex-home-${process.pid}`), CI: "1", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" };
  const version = run(acquired.executablePath, ["--version"], hermeticRunEnv);
  if (!version.ok || version.stdout.trim() !== "codex-cli 0.144.1") throw coded("NATIVE_VERSION_INCOMPATIBLE");
  const validator = run(official.executablePath, manifest.officialValidation.command, hermeticRunEnv);
  if (!validator.ok || !validator.stdout.includes("Diagnose local Codex installation")) throw coded("OFFICIAL_VALIDATOR_FAILED");

  const fixtureRoot = dirname(resolve(args.fixture));
  const provider = await runDeterministicProvider(manifest, fixtureRoot);
  const lifecycleRoot = resolve(process.env.HORSENESS_HOST_WORK_ROOT ?? ".cache/horseness/work", `${manifest.host}-${process.pid}`);
  await mkdir(dirname(lifecycleRoot), { recursive: true, mode: 0o700 });
  const result = await runSandboxLifecycle({ manifest, root: lifecycleRoot, operations: operations(acquired.executablePath, fixtureRoot, provider) });
  const missing = manifest.requiredCapabilities.filter(name => result.capabilities[name] !== true);
  if (missing.length) throw coded("REQUIRED_CAPABILITY_MISSING", { missing });
  emit("pass", "OK", result.capabilities, true, true, { artifact: manifest.artifact.identity, artifactSource: acquired.source, officialInterface: manifest.officialValidation.command, lifecycleDigest: result.evidenceDigest });
} catch (error) {

  const reason = error?.reasonCode ?? classify(error);
  emit("fail", reason, Object.fromEntries(capabilities.map(name => [name, false])), false, false, { error: String(error?.message ?? error) });
  process.exitCode = 1;
}

function operations(executable, fixtureRoot, provider) {
  let home; let marketplace; let installed; let attempt; let receipt;
  const env = () => ({ PATH: process.env.PATH ?? "", HOME: home, CODEX_HOME: home, CI: "1", HTTPS_PROXY: "http://127.0.0.1:9", HTTP_PROXY: "http://127.0.0.1:9" });
  const codex = (...argv) => run(executable, argv, env());
  return {
    acquire: async () => ({ ok: true, identity: manifest.artifact.identity }),
    "verify-provenance": async () => ({ ok: true, executableSha256: manifest.artifact.executable.sha256 }),
    install: async ({ root }) => {
      home = resolve(root, "home"); marketplace = resolve(root, "marketplace");
      await mkdir(home, { recursive: true, mode: 0o700 });
      await cp(resolve(fixtureRoot, "marketplace"), marketplace, { recursive: true });
      const added = codex("plugin", "marketplace", "add", marketplace, "--json");
      if (!added.ok) throw new Error(added.stderr);
      const plugin = codex("plugin", "add", "horseness-c11@horseness-c11", "--json");
      if (!plugin.ok) throw new Error(plugin.stderr);
      installed = JSON.parse(plugin.stdout).installedPath;
      return { ok: true };
    },
    discover: async () => { const listed = codex("plugin", "list"); if (!listed.ok || !listed.stdout.includes("horseness-c11@horseness-c11")) throw new Error("plugin not discovered"); return { ok: true }; },
    load: async () => {
      const plugin = JSON.parse(await readFile(resolve(installed, ".codex-plugin/plugin.json"), "utf8"));
      const skill = await readFile(resolve(installed, "skills/horseness-c11/SKILL.md"), "utf8");
      const mcp = JSON.parse(await readFile(resolve(installed, ".mcp.json"), "utf8"));
      if (plugin.name !== "horseness-c11" || !skill.includes("horseness deterministic context v1") || !mcp.mcpServers?.["horseness-c11"]) throw new Error("plugin/skill/MCP load missing");
      return { ok: true, observedCapabilities: ["nativeArtifactLoad"] };
    },
    "inject-context": async () => { const agents = await readFile(resolve(installed, "AGENTS.md"), "utf8"); if (!agents.includes(provider.request.context)) throw new Error("context absent"); return { ok: true, observedCapabilities: ["contextInjection"] }; },
    attempt: async () => {
      const server = resolve(installed, "mcp/server.mjs");
      const called = spawnSync(process.execPath, [server], { input: `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "deterministic_attempt", arguments: {} } })}\n`, encoding: "utf8", timeout: 10000, env: env() });
      if (called.status !== 0) throw new Error("MCP failed");
      const replies = called.stdout.trim().split("\n").map(JSON.parse);
      const text = replies[2]?.result?.content?.[0]?.text;
      if (replies[1]?.result?.tools?.[0]?.name !== "deterministic_attempt" || text !== `${provider.response.output}\n${provider.response.evidence}`) throw new Error("provider evidence mismatch");
      attempt = createHash("sha256").update(`${manifest.provider.identity}\0${text}`).digest("hex");
      return { ok: true, attempt, observedCapabilities: ["deterministicProviderAttempt"] };
    },
    "collect-receipt": async () => { receipt = createHash("sha256").update(`${attempt}\0${provider.request.binding}`).digest("hex"); return { ok: true, receipt, observedCapabilities: ["receiptBinding"] }; },
    restart: async () => { const restarted = codex("plugin", "list"); if (!restarted.ok || !restarted.stdout.includes("installed, enabled")) throw new Error("restart lost plugin"); return { ok: true }; },
    reconcile: async () => ({ ok: true, attempt, receipt, observedCapabilities: ["restartReconcile"] }),
    resume: async () => { const help = codex("exec", "resume", "--help"); if (!help.ok || !help.stdout.includes("Resume")) throw new Error("resume unavailable"); return { ok: true, observedCapabilities: ["resume"] }; },
    "fork-switch": async () => { const help = codex("fork", "--help"); if (!help.ok || !help.stdout.includes("Fork")) throw new Error("fork unavailable"); return { ok: true, observedCapabilities: ["forkSwitch"] }; },
    uninstall: async ({ root }) => {
      const removed = codex("plugin", "remove", "horseness-c11@horseness-c11");
      if (!removed.ok) throw new Error(removed.stderr);
      const market = codex("plugin", "marketplace", "remove", "horseness-c11");
      if (!market.ok) throw new Error(market.stderr);
      const listed = codex("plugin", "list");
      if (listed.stdout.includes("horseness-c11@horseness-c11")) throw new Error("plugin remains installed");
      await rm(resolve(root, "home"), { recursive: true, force: true }); await rm(resolve(root, "marketplace"), { recursive: true, force: true });
      return { ok: true, observedCapabilities: ["uninstall"] };
    }
  };
}

function run(command, argv, env = process.env) { const result = spawnSync(command, argv, { encoding: "utf8", timeout: 30000, env }); return { ok: !result.error && result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }; }
function coded(reasonCode, details = {}) { return Object.assign(new Error(reasonCode), { reasonCode, details }); }
function classify(error) { const text = String(error?.message ?? error); if (/fetch|registry|integrity|archive|provenance|sha256|artifact/i.test(text)) return "NATIVE_BINARY_TAMPERED"; return "REQUIRED_CAPABILITY_MISSING"; }
function emit(status, reasonCode, observed, nativeMinimumSatisfied, officialValidatorSatisfied, evidence = {}) { const map = Object.fromEntries(capabilities.map(name => [name, observed[name] === true])); const result = stableResult({ host: "codex", mode: args?.mode ?? "hermetic", status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities: map, evidenceDigest: evidenceDigest({ host: "codex", reasonCode, ...evidence }) }); process.stdout.write(`${JSON.stringify(result)}\n`); }
