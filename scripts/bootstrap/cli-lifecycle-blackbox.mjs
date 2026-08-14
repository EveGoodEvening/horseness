import { spawnSync } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXPECTED_COMMANDS = ["install", "upgrade", "downgrade", "rollback", "retry-install", "uninstall", "doctor", "repair", "rebind-workspace", "smoke"];
const requested = process.argv.slice(2).filter((value) => value !== "--");
if (requested.length !== EXPECTED_COMMANDS.length || requested.some((command, index) => command !== EXPECTED_COMMANDS[index])) throw new Error("CLI command registry mismatch");
const root = resolve(import.meta.dirname, "../..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "horseness-cli-lifecycle-"));
const deployRoot = join(temporaryRoot, "cli");
const deployed = spawnSync("corepack", ["pnpm", "--config.node-linker=hoisted", "--config.strict-peer-dependencies=false", "--filter", "@horseness/cli", "deploy", "--prod", "--legacy", deployRoot], { cwd: root, encoding: "utf8", env: process.env });
if (deployed.status !== 0) throw new Error(`CLI pack failed: ${deployed.stderr}\n${deployed.stdout}`);
const cli = join(deployRoot, "bin", "horseness.mjs");
const bootstrap = resolve(root, "apps/bootstrap/dist/horseness-bootstrap.mjs");
const baseEnvelope = JSON.parse(readFileSync(resolve(root, "apps/bootstrap/generated/fixture-release.json"), "utf8"));
const privateKey = createPrivateKey(`-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIGcLq+MnoMJ0+s1xKa1yHhwepzbdwKTfivQYe2Okp3mW\n-----END PRIVATE KEY-----\n`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function canonical(value) { if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value); if (typeof value === "number") return String(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
function releaseVariant(version, sequence, previousManifestDigest) {
  const envelope = structuredClone(baseEnvelope);
  envelope.catalog.releaseVersion = version;
  const catalogBytes = Buffer.from(JSON.stringify(envelope.catalog));
  envelope.artifacts["catalog.json"] = catalogBytes.toString("base64");
  const catalogRecord = envelope.signedManifest.manifest.artifacts.find((artifact) => artifact.path === "catalog.json");
  catalogRecord.sha256 = sha(catalogBytes); catalogRecord.bytes = catalogBytes.length;
  envelope.signedManifest.manifest.version = version; envelope.signedManifest.manifest.sequence = sequence; envelope.signedManifest.manifest.previousManifestDigest = previousManifestDigest;
  envelope.signedManifest.manifestDigest = sha(`horseness.release-manifest.v1\0${canonical(envelope.signedManifest.manifest)}`);
  envelope.signedManifest.signature = sign(null, Buffer.from(canonical(envelope.signedManifest.manifest)), privateKey).toString("base64");
  const neutral = { releaseVersion: version, releaseManifestDigest: envelope.signedManifest.manifestDigest, authenticatedManifestKeyId: envelope.signedManifest.keyId, authenticatedManifestSequence: sequence, contributions: envelope.catalog.contributions };
  envelope.catalogDigest = sha(`horseness.neutral-install-catalog.v1\0${canonical(neutral)}`);
  const path = join(temporaryRoot, `release-${sequence}.json`); writeFileSync(path, JSON.stringify(envelope)); return { path, digest: envelope.signedManifest.manifestDigest };
}
const v1 = releaseVariant("1.0.0", 20, null);
const v2 = releaseVariant("2.0.0", 21, v1.digest);
const downgrade = releaseVariant("1.5.0", 22, v2.digest);
const rollback = releaseVariant("2.0.0", 23, downgrade.digest);
const v3 = releaseVariant("3.0.0", 24, rollback.digest);
const workspace = join(temporaryRoot, "workspace");
const home = join(temporaryRoot, "home");
const environment = { ...process.env, HOME: home, PI_CODING_AGENT_HOME: join(home, ".pi", "agent"), OMP_HOME: join(home, ".omp"), CLAUDE_CONFIG_DIR: join(home, ".claude"), CODEX_HOME: join(home, ".codex"), HORSENESS_BOOTSTRAP_EXECUTABLE: bootstrap };
function invoke(command, release, extra = [], expected = 0) {
  const args = [cli, command, "--manifest", release.path, "--workspace", workspace, "--host", "pi", "--scope", "user", "--accept-executable-risk", release.digest, "--json", ...extra];
  const loader = resolve(root, "apps/cli/node_modules/tsx/dist/loader.mjs"); const result = spawnSync(process.execPath, ["--import", loader, ...args], { cwd: deployRoot, encoding: "utf8", env: environment, timeout: 120_000 });
  if (result.status !== expected) throw new Error(`${command} failed (${String(result.status)}): ${result.stderr}\n${result.stdout}`);
  const output = JSON.parse(result.stdout); if (output.command !== command || output.ok !== (expected === 0)) throw new Error(`${command} output mismatch: ${result.stdout}`); return output.data;
}
try {
  const installed = invoke("install", v1, ["--create-workspace"]); if (installed.operation !== "install") throw new Error("install did not mutate real state");
  if (invoke("upgrade", v2).releaseManifestDigest !== v2.digest) throw new Error("upgrade did not activate v2");
  if (invoke("downgrade", downgrade).releaseManifestDigest !== downgrade.digest) throw new Error("downgrade did not activate older version under newer signed sequence");
  if (invoke("rollback", rollback).releaseManifestDigest !== rollback.digest) throw new Error("rollback did not restore retained generation");
  invoke("upgrade", v3, ["--crash-point", "lifecycle-after-retain:pi"], 1);
  if (invoke("retry-install", v3).releaseManifestDigest !== v3.digest) throw new Error("retry did not resume journaled transaction");
  const doctor = invoke("doctor", v3); if (!doctor.healthy) throw new Error("doctor did not observe healthy installed state");
  const repair = invoke("repair", v3); if (!repair.after.healthy) throw new Error("repair did not preserve healthy state");
  const rebound = invoke("rebind-workspace", v3); if (!rebound.rebound) throw new Error("workspace rebind was not observable");
  const smoke = invoke("smoke", v3); if (!smoke.healthy) throw new Error("smoke did not query real state");
  const removed = invoke("uninstall", v3); if (!Array.isArray(removed.removed) || !removed.removed.includes("pi")) throw new Error("uninstall did not remove contribution");
  process.stdout.write(`CLI lifecycle blackbox passed for ${requested.length} packed commands\n`);
} finally {
  try { const endpoint = JSON.parse(readFileSync(join(workspace, ".horseness", "daemon-endpoint.v1.json"), "utf8")); process.kill(endpoint.processId, "SIGTERM"); } catch {}
  rmSync(temporaryRoot, { recursive: true, force: true });
}
