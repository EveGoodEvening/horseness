import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SRI512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/;

export function assertUpstreamArtifact(value, label = "artifact") {
  exact(value, ["identity", "version", "registryUrl", "packageIntegrity", "archiveSha256", "cacheKey", "executable"], label);
  if (!/^npm:(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)@[^\s@]+$/i.test(value.identity)) throw new Error(`${label}: invalid canonical identity`);
  const suffix = `@${value.version}`;
  if (!value.identity.endsWith(suffix) || !value.version) throw new Error(`${label}: identity/version mismatch`);
  const url = new URL(value.registryUrl);
  if (url.protocol !== "https:") throw new Error(`${label}: registry URL must use https`);
  if (!SRI512.test(value.packageIntegrity)) throw new Error(`${label}: invalid package integrity`);
  if (!SHA256.test(value.archiveSha256)) throw new Error(`${label}: invalid archive sha256`);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/.test(value.cacheKey)) throw new Error(`${label}: invalid cache key`);
  exact(value.executable, ["path", "sha256"], `${label}.executable`);
  assertSafeMember(value.executable.path, `${label}.executable.path`);
  if (!SHA256.test(value.executable.sha256)) throw new Error(`${label}: invalid executable sha256`);
}

export function assertOfficialValidation(value) {
  exact(value, ["kind", "provenance", "command"], "officialValidation");
  if (!["independent-artifact", "same-distribution-interface"].includes(value.kind)) throw new Error("officialValidation: invalid kind");
  if (!Array.isArray(value.command) || value.command.length === 0 || value.command.some((part) => typeof part !== "string" || !part)) throw new Error("officialValidation: invalid command");
  if (value.kind === "independent-artifact") assertUpstreamArtifact(value.provenance, "officialValidation.provenance");
  else {
    exact(value.provenance, ["artifactIdentity", "interfacePath", "interfaceSha256"], "officialValidation.provenance");
    if (!value.provenance.artifactIdentity.startsWith("npm:")) throw new Error("officialValidation: invalid distribution identity");
    assertSafeMember(value.provenance.interfacePath, "officialValidation.interfacePath");
    if (!SHA256.test(value.provenance.interfaceSha256)) throw new Error("officialValidation: invalid interface sha256");
  }
}

async function withCacheLock(root, body) {
  const lockPath = join(root, ".lock");
  const timeoutMs = 30_000;
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (handle === undefined) {
    try { handle = await open(lockPath, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try {
    return await body();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

export async function acquireUpstreamArtifact(pin, { cacheRoot = process.env.HORSENESS_HOST_CACHE ?? ".cache/horseness/hosts", fetchImpl = fetch } = {}) {
  assertUpstreamArtifact(pin);
  const root = resolve(cacheRoot);
  const leaf = resolve(root, pin.cacheKey);
  assertContained(root, leaf);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await rejectSymlinkPath(root, leaf);
  return withCacheLock(root, async () => {
    const ready = join(leaf, "READY.json");
    try {
      const record = JSON.parse(await readFile(ready, "utf8"));
      if (record.identity === pin.identity && record.archiveSha256 === pin.archiveSha256 && record.executableSha256 === pin.executable.sha256) {
        const executablePath = resolve(leaf, "package", pin.executable.path);
        await verifyRegularFile(executablePath, pin.executable.sha256);
        return { cachePath: leaf, executablePath, archivePath: join(leaf, "artifact.tgz"), source: "cache" };
      }
    } catch {}
    const staging = `${leaf}.stage-${process.pid}-${Date.now()}`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: false, mode: 0o700 });
    try {
      const metadataUrl = metadataUrlFor(pin);
      const response = await fetchImpl(metadataUrl, { redirect: "error", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`registry metadata failed: ${response.status}`);
      const metadata = await response.json();
      const dist = metadata?.dist;
      if (!dist || dist.integrity !== pin.packageIntegrity || typeof dist.tarball !== "string") throw new Error("registry provenance mismatch");
      const tarball = new URL(dist.tarball);
      if (tarball.protocol !== "https:" || tarball.host !== new URL(pin.registryUrl).host) throw new Error("registry tarball origin mismatch");
      const archiveResponse = await fetchImpl(tarball, { redirect: "error" });
      if (!archiveResponse.ok) throw new Error(`artifact fetch failed: ${archiveResponse.status}`);
      const bytes = Buffer.from(await archiveResponse.arrayBuffer());
      verifyBytes(bytes, pin.archiveSha256, "archive sha256");
      verifyIntegrity(bytes, pin.packageIntegrity);
      const archivePath = join(staging, "artifact.tgz");
      await writeFile(archivePath, bytes, { mode: 0o600, flag: "wx" });
      await run("tar", ["-xzf", archivePath, "-C", staging, "--no-same-owner", "--no-same-permissions"]);
      const executablePath = resolve(staging, "package", pin.executable.path);
      assertContained(resolve(staging, "package"), executablePath);
      await verifyRegularFile(executablePath, pin.executable.sha256);
      await chmod(executablePath, 0o700);
      await writeFile(join(staging, "READY.json"), JSON.stringify({ identity: pin.identity, archiveSha256: pin.archiveSha256, executableSha256: pin.executable.sha256 }) + "\n", { mode: 0o600, flag: "wx" });
      await rm(leaf, { recursive: true, force: true });
      await rename(staging, leaf);
      return { cachePath: leaf, executablePath: resolve(leaf, "package", pin.executable.path), archivePath: join(leaf, "artifact.tgz"), source: "registry" };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  });
}

export async function verifyOfficialValidation(manifest, acquiredNative, acquire = acquireUpstreamArtifact) {
  assertOfficialValidation(manifest.officialValidation);
  if (manifest.officialValidation.kind === "independent-artifact") return acquire(manifest.officialValidation.provenance);
  if (manifest.officialValidation.provenance.artifactIdentity !== manifest.artifact.identity) throw new Error("official validation provenance is not the native distribution");
  const path = resolve(acquiredNative.cachePath, "package", manifest.officialValidation.provenance.interfacePath);
  assertContained(resolve(acquiredNative.cachePath, "package"), path);
  await verifyRegularFile(path, manifest.officialValidation.provenance.interfaceSha256);
  return { executablePath: path, cachePath: acquiredNative.cachePath, source: "same-distribution" };
}

function metadataUrlFor(pin) {
  const identity = pin.identity.slice(4, -(pin.version.length + 1));
  const encoded = identity.startsWith("@") ? `@${encodeURIComponent(identity.slice(1))}` : encodeURIComponent(identity);
  return new URL(`${encoded}/${encodeURIComponent(pin.version)}`, pin.registryUrl).href;
}
function verifyBytes(bytes, digest, label) { const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`; if (actual !== digest) throw new Error(`${label} mismatch`); }
function verifyIntegrity(bytes, integrity) { const actual = `sha512-${createHash("sha512").update(bytes).digest("base64")}`; if (actual !== integrity) throw new Error("package integrity mismatch"); }
async function verifyRegularFile(path, digest) { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error("artifact member is not a regular file"); verifyBytes(await readFile(path), digest, "artifact member sha256"); }
function assertSafeMember(path, label) { if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..") || path.includes("\0")) throw new Error(`${label}: unsafe member path`); }
function assertContained(root, child) { const rel = relative(root, child); if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("path escapes cache root"); }
async function rejectSymlinkPath(root, leaf) { let cursor = leaf; while (cursor !== root) { try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error("symlink in cache path"); } catch (error) { if (error.code !== "ENOENT") throw error; } cursor = dirname(cursor); } }
function exact(value, keys, label) { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: expected object`); const actual = Object.keys(value).sort(); const expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label}: fields mismatch`); }
function run(command, args) { return new Promise((resolvePromise, reject) => { const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] }); let stderr = ""; child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr += chunk; }); child.on("error", reject); child.on("close", code => code === 0 ? resolvePromise() : reject(new Error(`${command} failed (${code}): ${stderr.trim()}`))); }); }
