import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = await realpath(process.cwd());
const groups = ["packages", "apps", "adapters"];
const layers = new Map([
  ["@horseness/domain", 0], ["@horseness/protocol", 1], ["@horseness/policy", 1],
  ["@horseness/store-sqlite", 1], ["@horseness/orchestrator", 2], ["@horseness/sdk", 2],
  ["@horseness/adapter-kit", 3], ["@horseness/installer", 1], ["@horseness/daemon", 4],
  ["@horseness/cli", 4], ["@horseness/adapter-pi", 4], ["@horseness/adapter-omp", 4],
  ["@horseness/adapter-claude", 4], ["@horseness/adapter-codex", 4]
]);
const errors = [];
const manifests = [];
for (const group of groups) {
  for (const entry of await readdir(path.join(root, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, group, entry.name);
    const manifest = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    manifests.push({ dir, group, manifest });
  }
}
const names = new Set(manifests.map(({ manifest }) => manifest.name));
for (const { dir, group, manifest } of manifests) {
  if (!layers.has(manifest.name)) errors.push(`${manifest.name}: unknown workspace boundary`);
  if (manifest.private !== true || manifest.type !== "module") errors.push(`${manifest.name}: must be private ESM`);
  if (manifest.exports?.["."]?.import !== "./src/index.ts") errors.push(`${manifest.name}: public import must be src/index.ts`);
  const index = path.join(dir, "src/index.ts");
  if (!(await stat(index)).isFile()) errors.push(`${manifest.name}: missing src/index.ts`);
  const allDeps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  for (const [dependency, specifier] of Object.entries(allDeps)) {
    if (!names.has(dependency)) continue;
    if (specifier !== "workspace:*") errors.push(`${manifest.name}: ${dependency} must use workspace:*`);
    if ((layers.get(dependency) ?? Infinity) >= (layers.get(manifest.name) ?? -1)) errors.push(`${manifest.name}: invalid inward dependency on ${dependency}`);
  }
  if (group === "packages" && Object.keys(allDeps).some((name) => name.startsWith("@horseness/adapter-"))) errors.push(`${manifest.name}: core package depends on adapter`);
  for (const file of await walk(path.join(dir, "src"))) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)) {
      const specifier = match[2];
      if (specifier.includes("/src/") || specifier.startsWith("../") && specifier.split("/").includes("..")) errors.push(`${path.relative(root, file)}: deep or escaping import ${specifier}`);
    }
  }
}
if (manifests.length !== layers.size) errors.push(`expected ${layers.size} workspace packages, found ${manifests.length}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`Boundary check passed for ${manifests.length} packages`);

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink not allowed: ${path.relative(root, target)}`);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name)) files.push(target);
  }
  return files;
}
