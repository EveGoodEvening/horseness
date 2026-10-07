import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
const offline = args.includes("--offline");
const clean = args.includes("--clean-home");
const workspaceIndex = args.indexOf("--workspace");
const workspace = workspaceIndex >= 0 ? resolve(args[workspaceIndex + 1]) : undefined;
if (workspace === undefined) throw new Error("--workspace is required");
if (args.includes("--create-workspace")) await rm(workspace, { recursive: true, force: true });
await mkdir(resolve(workspace, ".."), { recursive: true });
const home = clean ? await mkdtemp(resolve(tmpdir(), "horseness-c20-home-")) : process.env.HOME;
if (home === undefined) throw new Error("HOME is required");
const daemonRoot = await mkdtemp(resolve(tmpdir(), "horseness-c20-daemon-"));
const repositoryRoot = resolve(import.meta.dirname, "../..");
const release = resolve("apps/bootstrap/generated/fixture-release.json");
const executable = resolve("apps/bootstrap/dist/horseness-bootstrap.mjs");
const releaseBytes = await readFile(release);
const forwarded = ["install", "--manifest", release, "--scope", "user", "--workspace", workspace, "--host", args[args.indexOf("--host") + 1] ?? "all", "--accept-executable-risk", args[args.indexOf("--accept-executable-risk") + 1] ?? "fixture-release-digest", ...(args.includes("--create-workspace") ? ["--create-workspace"] : []), "--clean-home", home];
const environment = { ...process.env, HOME: home, HORSENESS_BOOTSTRAP_BUNDLE: release };
if (offline) {
  environment.HTTP_PROXY = "http://127.0.0.1:9";
  environment.HTTPS_PROXY = "http://127.0.0.1:9";
  environment.ALL_PROXY = "http://127.0.0.1:9";
  delete environment.NO_PROXY;
  delete environment.no_proxy;
}
try {
  if (!environment.HORSENESS_DAEMON_EXECUTABLE) {
    const deployed = spawnSync("corepack", ["pnpm", "--config.node-linker=hoisted", "--config.strict-peer-dependencies=false", "--filter", "@horseness/daemon", "deploy", "--prod", "--legacy", daemonRoot], { cwd: repositoryRoot, encoding: "utf8", env: process.env, timeout: 120_000 });
    if (deployed.status !== 0) throw new Error(`Daemon pack failed: ${deployed.stderr}\n${deployed.stdout}`);
    environment.HORSENESS_DAEMON_EXECUTABLE = resolve(daemonRoot, "bin/horseness-daemon.mjs");
  }
  const result = spawnSync(process.execPath, [executable, ...forwarded], { encoding: "utf8", env: environment, timeout: 120_000 });
  const expectedExit = process.platform === "linux" && process.arch === "x64" ? 0 : 3;
  if (result.status !== expectedExit) throw new Error(`install blackbox failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  const value = JSON.parse(result.stdout);
  if (value.schema !== "horseness.install-operation-result.v1" || value.exitCode !== expectedExit || value.hosts.length !== 4) throw new Error("install blackbox result invalid");
  if (expectedExit === 3 && !value.hosts.some((host) => host.detection === "unsupported")) throw new Error("partial install did not prove signed unsupported entries");
  const envelope = JSON.parse(releaseBytes.toString("utf8"));
  if (value.releaseManifestDigest !== envelope.signedManifest.manifestDigest) throw new Error("installed release did not originate from pre-positioned signed archive");
  process.stdout.write(`${offline ? "Offline" : "Online"} install blackbox passed for ${workspace}\n`);
} finally {
  spawnSync(process.execPath, [resolve(repositoryRoot, "apps/cli/bin/horseness.mjs"), "stop", "--workspace-path", workspace, "--json"], { cwd: repositoryRoot, env: environment, encoding: "utf8", timeout: 20_000 });
  await rm(daemonRoot, { recursive: true, force: true });
  if (clean) await rm(home, { recursive: true, force: true });
}
