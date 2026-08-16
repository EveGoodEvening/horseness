import { createHash, createPublicKey, verify } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

export const ROOT = resolve(import.meta.dirname, "../..");
export const SHA256 = /^[0-9a-f]{64}$/u;
export const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
export const RELEASE_IDENTITY = Object.freeze({ issuer: "https://token.actions.githubusercontent.com", repository: "EveGoodEvening/horseness", workflow: "refs/heads/main:.github/workflows/release.yml", protectedEnvironment: "release" });
export const PUBLISHABLE_MANIFESTS = Object.freeze([
  "packages/domain/package.json", "packages/protocol/package.json", "packages/policy/package.json", "packages/store-sqlite/package.json", "packages/orchestrator/package.json", "packages/sdk/package.json", "packages/adapter-kit/package.json", "packages/installer/package.json", "apps/daemon/package.json", "apps/cli/package.json", "apps/bootstrap/package.json", "adapters/pi/package.json", "adapters/omp/package.json", "adapters/claude/package.json", "adapters/codex/package.json",
]);
export function provenanceSubjects(artifacts) {
  return artifacts.map((item) => ({ name: `packages/${item.path}`, digest: { sha256: item.sha256 } }));
}
export const C22_COMMANDS = Object.freeze([
  "corepack pnpm run release:verify-root-ceremony -- --schema docs/trust/root-ceremony-v1.schema.json --record docs/trust/root-ceremony-v1.json --evidence docs/trust/evidence --offline --threshold 2-of-2",
  "corepack pnpm run release:verify-delegation -- --root-record docs/trust/root-ceremony-v1.json --require-version-range --require-kms-policy --require-two-approvals",
  "corepack pnpm install --frozen-lockfile", "corepack pnpm run release:coherence", "corepack pnpm run release:build-twice", "corepack pnpm run release:verify-sbom-provenance-signatures", "corepack pnpm run live-gates:required -- --matrix config/hosts/capability-matrix.v1.json", "corepack pnpm run release:dry-run", "corepack pnpm run release:verify-no-static-secrets", "corepack pnpm run release:upload-immutable -- --select-build build-1 --receipt-out .acceptance/C22-artifact-receipt.json", "corepack pnpm run release:verify-artifact-receipt -- --checkpoint-subject C22",
]);
export function canonical(value) { if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value); if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (typeof value !== "object") throw new Error("CANONICAL_JSON_VALUE_INVALID"); return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function parseArgs(argv = process.argv.slice(2)) { const values = argv[0] === "--" ? argv.slice(1) : argv; const parsed = new Map(); for (let index = 0; index < values.length; index += 1) { const key = values[index]; if (!key?.startsWith("--")) throw new Error(`UNEXPECTED_ARGUMENT:${key ?? ""}`); const next = values[index + 1]; if (next !== undefined && !next.startsWith("--")) { parsed.set(key.slice(2), next); index += 1; } else parsed.set(key.slice(2), true); } return parsed; }
export function exactKeys(value, keys, code) { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(code); const actual = Object.keys(value).sort(); const wanted = [...keys].sort(); if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code); }
export async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
export async function writeJson(path, value, options = {}) { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, `${canonical(value)}\n`, { mode: 0o600, ...options }); }
export async function regularFile(path, code) { let info; try { info = await lstat(path); } catch (error) { if (error.code === "ENOENT") throw new Error(code); throw error; } if (!info.isFile() || info.isSymbolicLink()) throw new Error(code); return info; }
export function verifyEd25519(pem, bytes, signature) { if (typeof pem !== "string" || typeof signature !== "string" || !BASE64.test(signature)) return false; try { return verify(null, bytes, createPublicKey(pem), Buffer.from(signature, "base64")); } catch { return false; } }
export async function run(command, args, options = {}) { return new Promise((accept, reject) => { const child = spawn(command, args, { cwd: ROOT, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); const out = []; const err = []; let bytes = 0; const limit = options.limit ?? 1024 * 1024; const collect = (target) => (chunk) => { bytes += chunk.length; if (bytes > limit) child.kill("SIGKILL"); else target.push(chunk); }; child.stdout.on("data", collect(out)); child.stderr.on("data", collect(err)); child.on("error", reject); child.on("close", (status, signal) => { const result = { status, signal, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }; if (status !== 0) reject(new Error(`${options.code ?? "COMMAND_FAILED"}:${command}:${status ?? signal}\n${result.stderr.slice(0, 2048)}`)); else accept(result); }); }); }
export async function walkFiles(root) { const output = []; async function visit(directory) { const entries = await readdir(directory, { withFileTypes: true }); entries.sort((a, b) => a.name.localeCompare(b.name)); for (const entry of entries) { const path = resolve(directory, entry.name); if (entry.isSymbolicLink()) throw new Error("RELEASE_TREE_SYMLINK_REFUSED"); if (entry.isDirectory()) await visit(path); else if (entry.isFile()) output.push(path); } } await visit(root); return output; }
export async function inventory(root) { const files = await walkFiles(root); return Promise.all(files.map(async (path) => { const bytes = await readFile(path); return { path: relative(root, path).split(sep).join("/"), sha256: sha256(bytes), bytes: bytes.length }; })); }
export function assertReleaseIdentity(value) { exactKeys(value, ["issuer", "repository", "workflow", "protectedEnvironment"], "RELEASE_IDENTITY_INVALID"); if (canonical(value) !== canonical(RELEASE_IDENTITY)) throw new Error("RELEASE_IDENTITY_MISMATCH"); }
export function candidateIdentity() { const head = process.env.HORSENESS_CANDIDATE_SHA ?? process.env.GITHUB_SHA; const tree = process.env.HORSENESS_CANDIDATE_TREE; if (!/^[0-9a-f]{40}$/u.test(head ?? "") || !/^[0-9a-f]{40}$/u.test(tree ?? "")) throw new Error("CANDIDATE_IDENTITY_REQUIRED"); return { head, tree }; }
export async function reconcileImmutableObject(fetcher, objectUrl, headers, bytes) {
  let response = await fetcher(objectUrl, { method: "GET", headers });
  if (response.status === 404) response = await fetcher(objectUrl, { method: "PUT", headers: { ...headers, "content-type": "application/vnd.horseness.immutable-candidate.v1+json", "if-none-match": "*", "content-length": String(bytes.length) }, body: bytes });
  if (!response.ok && response.status !== 409 && response.status !== 412) throw new Error(`IMMUTABLE_UPLOAD_FAILED:${response.status}`);
  const lookup = await fetcher(objectUrl, { method: "GET", headers });
  if (!lookup.ok) throw new Error(`IMMUTABLE_LOOKUP_FAILED:${lookup.status}`);
  const observed = Buffer.from(await lookup.arrayBuffer());
  if (sha256(observed) !== sha256(bytes) || observed.length !== bytes.length) throw new Error("IMMUTABLE_OBJECT_MISMATCH");
  return { lookup, observed };
}
