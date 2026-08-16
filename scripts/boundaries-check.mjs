import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const groups = ["packages", "apps", "adapters"];
const layers = new Map([
  ["@horseness/domain", 0], ["@horseness/protocol", 1], ["@horseness/policy", 1],
  ["@horseness/store-sqlite", 1], ["@horseness/orchestrator", 2], ["@horseness/sdk", 2],
  ["@horseness/adapter-kit", 3], ["@horseness/installer", 1], ["@horseness/daemon", 4],
  ["@horseness/cli", 4], ["@horseness/adapter-pi", 4], ["@horseness/adapter-omp", 4],
  ["@horseness/adapter-claude", 4], ["@horseness/adapter-codex", 4], ["@horseness/bootstrap", 5]
]);
export function importBoundaryError({ file, packageDir, specifier, workspaceNames }) {
  if (specifier.startsWith(".")) {
    const resolved = path.resolve(path.dirname(file), specifier);
    const relative = path.relative(packageDir, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return `deep or escaping import ${specifier}`;
    }
    return null;
  }
  for (const name of workspaceNames) {
    if (specifier.startsWith(`${name}/`)) return `cross-package deep import ${specifier}`;
  }
  return null;
}
export function metadataBoundaryErrors(manifests) {
  const errors = [];
  const byName = new Map(manifests.map(({ manifest }) => [manifest.name, manifest]));
  const publicManifests = manifests.filter(({ manifest }) => manifest.private !== true);
  const publicVersions = new Set(publicManifests.map(({ manifest }) => manifest.version));
  if (publicVersions.size > 1) return ["public workspace manifests must use one coherent version"];
  const releaseVersion = publicManifests[0]?.manifest.version;
  if (releaseVersion === "0.0.0") errors.push("public workspace version must not be 0.0.0");

  for (const { manifest } of manifests) {
    const isPrivate = manifest.private === true;
    if (manifest.type !== "module") errors.push(`${manifest.name}: must be ESM`);
    if (isPrivate) {
      if (manifest.version !== "0.0.0" || manifest.publishConfig !== undefined) errors.push(`${manifest.name}: private workspace must use 0.0.0 without publishConfig`);
    } else if (manifest.version !== releaseVersion) {
      errors.push(`${manifest.name}: public workspace must use ${releaseVersion}`);
    }

    const expectedSpecifier = isPrivate ? "workspace:*" : `workspace:${releaseVersion}`;
    const allDeps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies };
    for (const [dependency, specifier] of Object.entries(allDeps)) {
      const target = byName.get(dependency);
      if (target === undefined) continue;
      if (!isPrivate && target.private === true) errors.push(`${manifest.name}: public package cannot depend on private ${dependency}`);
      if (specifier !== expectedSpecifier) errors.push(`${manifest.name}: ${dependency} must use ${expectedSpecifier}`);
    }
  }
  return errors;
}


export async function checkBoundaries(cwd = process.cwd()) {
 const root = await realpath(cwd);
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
 errors.push(...metadataBoundaryErrors(manifests));
 for (const { dir, group, manifest } of manifests) {
  if (!layers.has(manifest.name)) errors.push(`${manifest.name}: unknown workspace boundary`);

  if (manifest.exports?.["."]?.import !== "./src/index.ts") errors.push(`${manifest.name}: public import must be src/index.ts`);
  const index = path.join(dir, "src/index.ts");
  if (!(await stat(index)).isFile()) errors.push(`${manifest.name}: missing src/index.ts`);
  const allDeps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  for (const dependency of Object.keys(allDeps)) {
    if (!names.has(dependency)) continue;

    if ((layers.get(dependency) ?? Infinity) >= (layers.get(manifest.name) ?? -1)) errors.push(`${manifest.name}: invalid inward dependency on ${dependency}`);
  }
  if (group === "packages" && Object.keys(allDeps).some((name) => name.startsWith("@horseness/adapter-"))) errors.push(`${manifest.name}: core package depends on adapter`);
  for (const file of await walk(path.join(dir, "src"), root)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)) {
      const specifier = match[2];
      const boundaryError = importBoundaryError({ file, packageDir: dir, specifier, workspaceNames: names });
      if (boundaryError) errors.push(`${path.relative(root, file)}: ${boundaryError}`);
    }
  }
 }
 if (manifests.length !== layers.size) errors.push(`expected ${layers.size} workspace packages, found ${manifests.length}`);
 return { errors, packageCount: manifests.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
 const result = await checkBoundaries();
 if (result.errors.length) { console.error(result.errors.join("\n")); process.exit(1); }
 console.log(`Boundary check passed for ${result.packageCount} packages`);
}

async function walk(dir, root) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symlink not allowed: ${path.relative(root, target)}`);
    if (entry.isDirectory()) files.push(...await walk(target, root));
    else if (entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name)) files.push(target);
  }
  return files;
}
