import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import {
  DEFERRED_MANIFESTS,
  PUBLISHABLE_MANIFESTS,
  ROOT,
  canonical,
  readJson,
  sha256,
} from "./lib.mjs";

const DEPENDENCY_GROUPS = ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"];
const slash = (value) => value.split(sep).join("/");

function internalDependencies(value) {
  return DEPENDENCY_GROUPS.flatMap((group) => Object.entries(value[group] ?? {}).map(([name, specifier]) => ({ group, name, specifier })));
}

export async function verifyCoherence(root = ROOT) {
  const manifests = await Promise.all(PUBLISHABLE_MANIFESTS.map(async (path) => ({ path, value: await readJson(resolve(root, path)) })));
  const deferred = await Promise.all(DEFERRED_MANIFESTS.map(async (path) => ({ path, value: await readJson(resolve(root, path)) })));
  const versions = new Set(manifests.map(({ value }) => value.version));
  if (versions.size !== 1) throw new Error("RELEASE_VERSION_INCOHERENT");
  const version = manifests[0]?.value.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) || version === "0.0.0") throw new Error("APPROVED_RELEASE_VERSION_REQUIRED");
  const exactWorkspaceSpecifier = `workspace:${version}`;
  const packagePaths = new Map(manifests.map(({ path, value }) => [value.name, dirname(path)]));
  const deferredNames = new Set(deferred.map(({ value }) => value.name));

  for (const { path, value } of manifests) {
    if (value.private === true || value.publishConfig?.access !== "public") throw new Error(`PUBLICATION_ACCESS_DECISION_REQUIRED:${path}`);
    if (value.license !== "MIT") throw new Error(`PUBLICATION_LICENSE_REQUIRED:${path}`);
    for (const { group, name, specifier } of internalDependencies(value)) {
      if (!name.startsWith("@horseness/")) continue;
      if (deferredNames.has(name)) throw new Error(`PUBLIC_PACKAGE_DEPENDS_ON_DEFERRED:${path}:${group}:${name}`);
      if (!packagePaths.has(name)) throw new Error(`INTERNAL_PACKAGE_UNKNOWN:${name}`);
      if (specifier !== exactWorkspaceSpecifier) throw new Error(`INTERNAL_DEPENDENCY_NOT_EXACT:${path}:${group}:${name}`);
    }
  }

  for (const { path, value } of deferred) {
    if (value.version !== "0.0.0" || value.private !== true || value.type !== "module" || value.publishConfig !== undefined) throw new Error(`DEFERRED_PACKAGE_METADATA_INVALID:${path}`);
    for (const { group, name, specifier } of internalDependencies(value)) {
      if (!name.startsWith("@horseness/")) continue;
      if (!packagePaths.has(name) && !deferredNames.has(name)) throw new Error(`INTERNAL_PACKAGE_UNKNOWN:${name}`);
      if (specifier !== "workspace:*") throw new Error(`DEFERRED_DEPENDENCY_NOT_WILDCARD:${path}:${group}:${name}`);
    }
  }

  const lock = parse(await readFile(resolve(root, "pnpm-lock.yaml"), "utf8"));
  if (lock === null || typeof lock !== "object" || lock.importers === null || typeof lock.importers !== "object") throw new Error("LOCKFILE_IMPORTERS_INVALID");
  for (const { path, value } of [...manifests, ...deferred]) {
    const importerName = dirname(path);
    const importer = lock.importers[importerName];
    if (importer === null || typeof importer !== "object") throw new Error(`LOCKFILE_IMPORTER_MISSING:${importerName}`);
    const expectedSpecifier = value.private === true ? "workspace:*" : exactWorkspaceSpecifier;
    for (const group of DEPENDENCY_GROUPS) {
      const expected = new Map(Object.entries(value[group] ?? {}).filter(([name]) => name.startsWith("@horseness/")));
      const actual = new Map(Object.entries(importer[group] ?? {}).filter(([name]) => name.startsWith("@horseness/")));
      for (const [name] of expected) {
        const entry = actual.get(name);
        if (entry === undefined) throw new Error(`LOCKFILE_INTERNAL_DEPENDENCY_MISSING:${importerName}:${group}:${name}`);
        if (entry.specifier !== expectedSpecifier) throw new Error(`LOCKFILE_INTERNAL_SPECIFIER_INVALID:${importerName}:${group}:${name}`);
        const deferredTarget = deferred.find(({ value: candidate }) => candidate.name === name);
        const target = packagePaths.get(name) ?? (deferredTarget === undefined ? undefined : dirname(deferredTarget.path));
        if (target === undefined) throw new Error(`INTERNAL_PACKAGE_UNKNOWN:${name}`);
        const expectedLink = `link:${slash(relative(importerName, target))}`;
        if (entry.version !== expectedLink) throw new Error(`LOCKFILE_INTERNAL_LINK_INVALID:${importerName}:${group}:${name}`);
      }
      for (const name of actual.keys()) if (!expected.has(name)) throw new Error(`LOCKFILE_INTERNAL_DEPENDENCY_EXTRA:${importerName}:${group}:${name}`);
    }
  }

  return {
    schema: "horseness.release-coherence.v2",
    version,
    manifests: manifests.map(({ path, value }) => ({ path, name: value.name, digest: sha256(canonical(value)) })),
    deferred: deferred.map(({ path, value }) => ({ path, name: value.name, digest: sha256(canonical(value)) })),
  };
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? "")}`).href) {
  process.stdout.write(`${canonical(await verifyCoherence())}\n`);
}
