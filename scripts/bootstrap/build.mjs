import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const FIXTURE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIGcLq+MnoMJ0+s1xKa1yHhwepzbdwKTfivQYe2Okp3mW\n-----END PRIVATE KEY-----\n`;
const privateKey = createPrivateKey(FIXTURE_PRIVATE_KEY);
const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
const root = resolve(import.meta.dirname, "../..");
const specifications = [
  ["pi", "0.73.1", "pi", ".horseness/pi", [["adapters/pi/native/pi-package.json", "manifest", 0o600], ["adapters/pi/native/extensions/horseness-pi.mjs", "native-resource", 0o600]]],
  ["omp", "17.2.15", "omp", ".horseness/omp", [["adapters/omp/native/omp-package.json", "manifest", 0o600], ["adapters/omp/native/extensions/horseness-omp.mjs", "native-resource", 0o600]]],
  ["claude", "2.1.228", "claude", "plugins/horseness", [["adapters/claude/native/plugin/.claude-plugin/plugin.json", "manifest", 0o600], ["adapters/claude/native/plugin/.mcp.json", "manifest", 0o600], ["adapters/claude/native/plugin/servers/horseness-worker.mjs", "mcp-server", 0o600], ["adapters/claude/native/plugin/commands/horseness-worker-return.md", "plugin", 0o600], ["adapters/claude/native/plugin/skills/horseness-worker/SKILL.md", "skill", 0o600], ["adapters/claude/native/plugin/agents/horseness-worker.md", "agent", 0o600], ["adapters/claude/native/plugin/hooks/hooks.json", "hook", 0o600], ["adapters/claude/native/plugin/hooks/session-start.mjs", "hook", 0o600]]],
  ["codex", "0.144.1", "codex", "plugins/horseness", [["adapters/codex/native/plugin/.codex-plugin/plugin.json", "manifest", 0o600], ["adapters/codex/native/plugin/.mcp.json", "manifest", 0o600], ["adapters/codex/native/plugin/AGENTS.md", "agent", 0o600], ["adapters/codex/native/plugin/servers/horseness-worker.mjs", "mcp-server", 0o600], ["adapters/codex/native/plugin/skills/horseness-worker/SKILL.md", "skill", 0o600]]],
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function canonical(value) { if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value); if (typeof value === "number") return String(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
const contributions = [];
const artifacts = {};
for (const [hostId, pinnedHostVersion, discoveryRootId, targetRelativePath, paths] of specifications) {
  const files = [];
  for (const [source, kind, mode] of paths) {
    const bytes = await readFile(resolve(root, source));
    const digest = sha(bytes);
    const base = hostId === "claude" || hostId === "codex" ? `adapters/${hostId}/native/plugin` : `adapters/${hostId}/native`;
    const path = relative(base, source).replaceAll("\\", "/").replace(/^\.\.\//u, "");
    files.push({ path, kind, mode, size: bytes.length, contentDigest: digest, archiveDigest: digest, memberDigest: digest, bytesBase64: bytes.toString("base64") });
    artifacts[`contributions/${hostId}/${path}`] = bytes.toString("base64");
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const packageBytes = Buffer.concat(files.map((file) => Buffer.from(`${file.path}:${file.contentDigest}\n`)));
  contributions.push({ hostId, pinnedHostVersion, support: hostId === "codex" ? "experimental" : "supported", platforms: hostId === "claude" || hostId === "codex" ? [{ platform: "linux", arch: "x64" }] : [{ platform: "linux", arch: "x64" }, { platform: "darwin", arch: "x64" }, { platform: "darwin", arch: "arm64" }, { platform: "win32", arch: "x64" }], discoveryRootId, targetRelativePath, packageDigest: sha(packageBytes), sourceArtifactDigest: sha(Buffer.concat(files.map((file) => Buffer.from(file.bytesBase64, "base64")))), files });
}
const releaseVersion = "0.0.0-c20.1";
const catalog = { releaseVersion, contributions };
const catalogBytes = Buffer.from(JSON.stringify(catalog));
artifacts["catalog.json"] = catalogBytes.toString("base64");
const dependencyGraph = Buffer.from("{}\n");
const identity = { issuer: "https://token.actions.githubusercontent.com", repository: "EveGoodEvening/horseness", workflow: ".github/workflows/release-stage.yml", protectedEnvironment: "fixture" };
const artifactRecords = Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right)).map(([path, base64]) => { const bytes = Buffer.from(base64, "base64"); return { path, sha256: sha(bytes), bytes: bytes.length, lifecycleScripts: [] }; });
const manifest = { schema: "horseness.release-manifest.v1", sequence: 20, version: releaseVersion, previousManifestDigest: null, artifacts: artifactRecords, dependencyGraphDigest: sha(dependencyGraph), sigstoreIdentity: identity };
const manifestDigest = sha(`horseness.release-manifest.v1\0${canonical(manifest)}`);
const signedManifest = { schema: "horseness.signed-release-manifest.v1", manifest, manifestDigest, keyId: "fixture-release-ed25519-v1", signature: sign(null, Buffer.from(canonical(manifest)), privateKey).toString("base64") };
const delegationCore = { keyId: signedManifest.keyId, publicKeyPem: publicKey, validFromSequence: 1, validThroughSequence: 1000 };
const revokedDelegationCore = { ...delegationCore, keyId: "fixture-revoked-ed25519-v1" };
const trustRoot = { schema: "horseness.project-trust-root.v1", rootKeyId: "fixture-root-ed25519-v1", rootPublicKeyPem: publicKey, delegations: [{ ...delegationCore, rootSignature: sign(null, Buffer.from(canonical(delegationCore)), privateKey).toString("base64") }, { ...revokedDelegationCore, rootSignature: sign(null, Buffer.from(canonical(revokedDelegationCore)), privateKey).toString("base64") }], revokedKeyIds: [revokedDelegationCore.keyId], requiredSigstoreIdentity: identity };
const neutralCore = { releaseVersion, releaseManifestDigest: manifestDigest, authenticatedManifestKeyId: signedManifest.keyId, authenticatedManifestSequence: manifest.sequence, contributions };
const catalogDigest = sha(`horseness.neutral-install-catalog.v1\0${canonical(neutralCore)}`);
const envelope = { schema: "horseness.bootstrap-release-envelope.v1", signedManifest, dependencyGraphBase64: dependencyGraph.toString("base64"), artifacts, catalog, catalogDigest };
const generated = resolve(root, "apps/bootstrap/generated");
await rm(generated, { recursive: true, force: true });
await mkdir(generated, { recursive: true, mode: 0o700 });
await writeFile(resolve(generated, "fixture-release.json"), `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
await writeFile(resolve(generated, "fixture-trust-root.json"), `${JSON.stringify(trustRoot)}\n`, { mode: 0o600 });
const dist = resolve(root, "apps/bootstrap/dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true, mode: 0o700 });
const runtime = resolve(dist, "runtime");
const deployRoot = await mkdtemp(resolve(tmpdir(), "horseness-bootstrap-deploy-"));
const deployed = spawnSync("corepack", ["pnpm", "--config.node-linker=hoisted", "--config.strict-peer-dependencies=false", "--filter", "@horseness/bootstrap", "deploy", "--prod", "--legacy", deployRoot], { cwd: root, encoding: "utf8", env: process.env });
if (deployed.status !== 0) throw new Error(`bootstrap deploy failed: ${deployed.stderr}\n${deployed.stdout}`);
await cp(deployRoot, runtime, { recursive: true });
await rm(deployRoot, { recursive: true, force: true });
await cp(generated, resolve(runtime, "generated"), { recursive: true });
const executable = `#!/usr/bin/env node\nprocess.env.HORSENESS_BOOTSTRAP_BUNDLE ??= new URL("./runtime/generated/fixture-release.json", import.meta.url).pathname;\nprocess.env.HORSENESS_PROJECT_TRUST_ROOT ??= new URL("./runtime/generated/fixture-trust-root.json", import.meta.url).pathname;\nprocess.env.HORSENESS_DAEMON_EXECUTABLE ??= new URL("./runtime/node_modules/@horseness/daemon/bin/horseness-daemon.mjs", import.meta.url).pathname;\nawait import(new URL("./runtime/bin/horseness-bootstrap.mjs", import.meta.url));\n`;
await writeFile(resolve(dist, "horseness-bootstrap.mjs"), executable, { mode: 0o700 });
await chmod(resolve(dist, "horseness-bootstrap.mjs"), 0o700);
process.stdout.write(`Built authenticated release ${manifestDigest} with ${contributions.length} host contributions\n`);
