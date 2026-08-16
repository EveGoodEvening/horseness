import { lstat, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { ROOT, walkFiles } from "./lib.mjs";

const roots = [
  "scripts/release",
  "scripts/bootstrap/build.mjs",
  ".github/workflows",
  "package.json",
  "pnpm-workspace.yaml",
  "apps/bootstrap/package.json",
  "apps/bootstrap/src",
  "apps/bootstrap/bin",
  "docs/release-process.md",
  "docs/trust",
  "apps/bootstrap/generated/production-trust-root.json",
  "apps/bootstrap/generated/production-trust-pin.json",
];
const optional = new Set(["apps/bootstrap/generated/production-trust-root.json", "apps/bootstrap/generated/production-trust-pin.json"]);
const patterns = [new RegExp(`-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE ${"KEY"}-----`, "u"), /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^${][^"']{8,}["']/iu, new RegExp(`A${"KIA"}[0-9A-Z]{16}`, "u"), new RegExp(`g${"h"}[pousr]_[A-Za-z0-9]{32,}`, "u")];
for (const root of roots) {
  const path = resolve(ROOT, root);
  let files;
  try { const info = await lstat(path); files = info.isDirectory() ? await walkFiles(path) : [path]; }
  catch (error) { if (error.code === "ENOENT" && optional.has(root)) continue; throw error; }
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (patterns.some((pattern) => pattern.test(text))) throw new Error(`STATIC_SECRET_DETECTED:${relative(ROOT, file)}`);
    const relativePath = relative(ROOT, file).replaceAll("\\", "/");
    if (!relativePath.startsWith("scripts/release/test/") && file !== new URL(import.meta.url).pathname && (root === "scripts/release" || root === ".github/workflows") && /c20-fixture-signing-key|tests\/fixtures\/install-bundles/u.test(text)) throw new Error(`FIXTURE_SECRET_REFERENCE_IN_PRODUCTION:${relativePath}`);
  }
}
const bootstrapBuild = await readFile(resolve(ROOT, "scripts/bootstrap/build.mjs"), "utf8");
if (!bootstrapBuild.includes('const privateKey = production ? null : createPrivateKey(await readFile(fixtureKeyPath));')) throw new Error("FIXTURE_KEY_NOT_PRODUCTION_GUARDED");
const bootstrapSource = await readFile(resolve(ROOT, "apps/bootstrap/src/index.ts"), "utf8");
if (bootstrapSource.includes("HORSENESS_PROJECT_TRUST_ROOT_SHA256")) throw new Error("RUNTIME_TRUST_PIN_OVERRIDE_PRESENT");
process.stdout.write("Verified all C22 production release, build, workflow, and bootstrap surfaces contain no static secrets\n");
