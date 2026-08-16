import { lstat, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { ROOT, walkFiles } from "./lib.mjs";

const roots = [
  "scripts/release",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "package.json",
  "docs/release-process.md",
  "docs/trust-root.md",
];
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^${][^"']{8,}["']/iu,
  /AKIA[0-9A-Z]{16}/u,
  /gh[pousr]_[A-Za-z0-9]{32,}/u,
  /npm_[A-Za-z0-9]{32,}/u,
];
for (const root of roots) {
  const path = resolve(ROOT, root);
  const info = await lstat(path);
  const files = info.isDirectory() ? await walkFiles(path) : [path];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (patterns.some((pattern) => pattern.test(text))) throw new Error(`STATIC_SECRET_DETECTED:${relative(ROOT, file)}`);
    const relativePath = relative(ROOT, file).replaceAll("\\", "/");
    if (!relativePath.startsWith("scripts/release/test/") && relativePath !== "scripts/release/verify-no-static-secrets.mjs" && /tests\/fixtures\/install-bundles|c20-fixture-signing-key/u.test(text)) throw new Error(`FIXTURE_REFERENCE_IN_RELEASE_PATH:${relativePath}`);
  }
}

const workflow = await readFile(resolve(ROOT, ".github/workflows/release.yml"), "utf8");
for (const obsolete of ["verify-root-ceremony", "verify-delegation", "KMS", "immutable", "artifact-receipt", "live-gates", "c22-signed-builds"]) {
  if (workflow.includes(obsolete)) throw new Error(`OBSOLETE_RELEASE_TRUST_REFERENCE:${obsolete}`);
}
if (!workflow.includes("secrets.NPM_TOKEN") || !workflow.includes("--provenance") || !workflow.includes("environment: release")) throw new Error("NPM_RELEASE_AUTHORITY_CONTROLS_MISSING");

const bootstrap = JSON.parse(await readFile(resolve(ROOT, "apps/bootstrap/package.json"), "utf8"));
if (bootstrap.private !== true || bootstrap.version !== "0.0.0" || bootstrap.publishConfig !== undefined) throw new Error("DEFERRED_BOOTSTRAP_MUST_BE_PRIVATE");
process.stdout.write("Verified npm-first release surfaces contain no static credentials or fixture publication path\n");
