import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

export const ROOT = resolve(import.meta.dirname, "../..");
export const RELEASE_ROOT = resolve(ROOT, ".release");
export const PUBLISHABLE_MANIFESTS = Object.freeze([
  "packages/domain/package.json",
  "packages/protocol/package.json",
  "packages/policy/package.json",
  "packages/store-sqlite/package.json",
  "packages/orchestrator/package.json",
  "packages/sdk/package.json",
  "packages/adapter-kit/package.json",
  "packages/installer/package.json",
  "apps/daemon/package.json",
  "apps/cli/package.json",
  "adapters/pi/package.json",
  "adapters/omp/package.json",
  "adapters/claude/package.json",
  "adapters/codex/package.json",
]);
export const DEFERRED_MANIFESTS = Object.freeze(["apps/bootstrap/package.json"]);
export const C22_COMMANDS = Object.freeze([
  "corepack pnpm install --frozen-lockfile",
  "corepack pnpm run release:docs-lint",
  "corepack pnpm run release:coherence",
  "corepack pnpm run release:build-twice",
  "corepack pnpm run release:verify-candidate",
  "corepack pnpm run release:test",
  "corepack pnpm run release:verify-commands",
  "corepack pnpm run release:verify-no-static-secrets",
  "corepack pnpm run boundaries:check",
]);

const SHA256 = /^[0-9a-f]{64}$/u;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

export function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") throw new Error("CANONICAL_JSON_VALUE_INVALID");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha512Integrity(value) {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error(`UNEXPECTED_ARGUMENT:${key ?? ""}`);
    const name = key.slice(2);
    if (parsed.has(name)) throw new Error(`DUPLICATE_ARGUMENT:${key}`);
    const next = values[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      parsed.set(name, next);
      index += 1;
    } else {
      parsed.set(name, true);
    }
  }
  return parsed;
}

export function exactKeys(value, keys, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, value, options = {}) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${canonical(value)}\n`, { mode: 0o600, ...options });
}

export async function regularFile(path, code) {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(code);
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(code);
  return info;
}

export function platformCommand(command, platform = process.platform) {
  if (platform === "win32" && ["corepack", "npm", "npx", "pnpm"].includes(command)) return `${command}.cmd`;
  return command;
}

export async function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(platformCommand(command), args, {
      cwd: options.cwd ?? ROOT,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const limit = options.limit ?? 1024 * 1024;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) child.kill("SIGKILL");
      else target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", reject);
    child.on("close", (status, signal) => {
      const result = {
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (status === 0 || (options.allowedStatuses ?? []).includes(status)) accept(result);
      else reject(new Error(`${options.code ?? "COMMAND_FAILED"}:${command}:${status ?? signal ?? "unknown"}\n${result.stderr}${result.stdout}`));
    });
  });
}

export async function walkFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("RELEASE_TREE_SYMLINK_REFUSED");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(root);
  return output;
}

export async function inventory(root) {
  const files = await walkFiles(root);
  return Promise.all(files.map(async (path) => {
    const bytes = await readFile(path);
    return {
      path: relative(root, path).split(sep).join("/"),
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
  }));
}

export function tarballName(packageName, version) {
  const base = packageName.startsWith("@") ? packageName.slice(1).replace("/", "-") : packageName;
  return `${base}-${version}.tgz`;
}

export async function readPublishablePackages(root = ROOT) {
  return Promise.all(PUBLISHABLE_MANIFESTS.map(async (manifestPath) => {
    const manifest = await readJson(resolve(root, manifestPath));
    return { manifestPath, manifest };
  }));
}

export async function loadCandidate(candidatePath = resolve(RELEASE_ROOT, "build-1", "release-manifest.json")) {
  const resolvedPath = isAbsolute(candidatePath) ? candidatePath : resolve(ROOT, candidatePath);
  const root = dirname(resolvedPath);
  await regularFile(resolvedPath, "RELEASE_CANDIDATE_MANIFEST_INVALID");
  const manifest = await readJson(resolvedPath);
  exactKeys(manifest, ["schema", "version", "sourceCommit", "packages"], "RELEASE_CANDIDATE_INVALID");
  if (manifest.schema !== "horseness.npm-candidate.v1" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version) || !/^[0-9a-f]{40}$/u.test(manifest.sourceCommit)) throw new Error("RELEASE_CANDIDATE_INVALID");

  const expected = await readPublishablePackages();
  if (!Array.isArray(manifest.packages) || manifest.packages.length !== expected.length) throw new Error("RELEASE_CANDIDATE_PACKAGE_COUNT_INVALID");

  const packages = [];
  for (let index = 0; index < expected.length; index += 1) {
    const item = manifest.packages[index];
    exactKeys(item, ["name", "version", "manifestPath", "tarball", "bytes", "sha256", "integrity"], "RELEASE_CANDIDATE_PACKAGE_INVALID");
    const expectedPackage = expected[index];
    if (item.name !== expectedPackage.manifest.name || item.version !== manifest.version || item.manifestPath !== expectedPackage.manifestPath) throw new Error("RELEASE_CANDIDATE_PACKAGE_ORDER_INVALID");
    if (!item.tarball.startsWith("packages/") || item.tarball.includes("..") || !item.tarball.endsWith(".tgz")) throw new Error("RELEASE_CANDIDATE_TARBALL_PATH_INVALID");
    if (!Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !SHA256.test(item.sha256) || !INTEGRITY.test(item.integrity)) throw new Error("RELEASE_CANDIDATE_PACKAGE_INVALID");
    const tarballPath = resolve(root, item.tarball);
    if (!tarballPath.startsWith(`${root}${sep}`)) throw new Error("RELEASE_CANDIDATE_TARBALL_PATH_INVALID");
    const info = await regularFile(tarballPath, "RELEASE_CANDIDATE_TARBALL_MISSING");
    const bytes = await readFile(tarballPath);
    if (info.size !== item.bytes || sha256(bytes) !== item.sha256 || sha512Integrity(bytes) !== item.integrity) throw new Error(`RELEASE_CANDIDATE_TARBALL_MISMATCH:${item.name}`);
    packages.push({ ...item, tarballPath });
  }

  const actualFiles = (await inventory(root)).map((item) => item.path).sort();
  const expectedFiles = ["release-manifest.json", ...manifest.packages.map((item) => item.tarball)].sort();
  if (canonical(actualFiles) !== canonical(expectedFiles)) throw new Error("RELEASE_CANDIDATE_INVENTORY_INVALID");
  return { path: resolvedPath, root, manifest, packages };
}

function parseNpmJson(result, code) {
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(code);
  }
}

function isMissingPackage(result) {
  return /E404|404 Not Found|is not in this registry/iu.test(`${result.stderr}\n${result.stdout}`);
}

export async function registryIntegrity(name, version, options = {}) {
  const result = await run("npm", ["view", `${name}@${version}`, "dist.integrity", "--json"], {
    ...options,
    allowedStatuses: [1],
    code: "NPM_VIEW_INTEGRITY_FAILED",
  });
  if (result.status !== 0) {
    if (isMissingPackage(result)) return null;
    throw new Error(`NPM_VIEW_INTEGRITY_FAILED:${name}@${version}\n${result.stderr}${result.stdout}`);
  }
  const value = parseNpmJson(result, "NPM_VIEW_INTEGRITY_INVALID");
  if (typeof value !== "string" || !INTEGRITY.test(value)) throw new Error(`NPM_VIEW_INTEGRITY_INVALID:${name}@${version}`);
  return value;
}

export async function registryTagVersion(name, tag, options = {}) {
  const result = await run("npm", ["view", `${name}@${tag}`, "version", "--json"], {
    ...options,
    allowedStatuses: [1],
    code: "NPM_VIEW_TAG_FAILED",
  });
  if (result.status !== 0) {
    if (isMissingPackage(result)) return null;
    throw new Error(`NPM_VIEW_TAG_FAILED:${name}@${tag}\n${result.stderr}${result.stdout}`);
  }
  const value = parseNpmJson(result, "NPM_VIEW_TAG_INVALID");
  if (typeof value !== "string") throw new Error(`NPM_VIEW_TAG_INVALID:${name}@${tag}`);
  return value;
}
