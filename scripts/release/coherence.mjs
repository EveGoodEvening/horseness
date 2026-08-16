import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PUBLISHABLE_MANIFESTS, ROOT, canonical, readJson, sha256 } from "./lib.mjs";
export async function verifyCoherence(root = ROOT) {
  const manifests = await Promise.all(PUBLISHABLE_MANIFESTS.map(async (path) => ({ path, value: await readJson(resolve(root, path)) })));
  const versions = new Set(manifests.map(({ value }) => value.version));
  if (versions.size !== 1) throw new Error("RELEASE_VERSION_INCOHERENT");
  const version = manifests[0].value.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) || version === "0.0.0") throw new Error("APPROVED_RELEASE_VERSION_REQUIRED");
  for (const { path, value } of manifests) {
    if (value.private === true) throw new Error(`PUBLICATION_ACCESS_DECISION_REQUIRED:${path}`);
    for (const group of ["dependencies", "optionalDependencies", "peerDependencies"]) for (const [name, specifier] of Object.entries(value[group] ?? {})) if (name.startsWith("@horseness/") && specifier !== version) throw new Error(`INTERNAL_DEPENDENCY_NOT_EXACT:${path}:${name}`);
  }
  const lock = await readFile(resolve(root, "pnpm-lock.yaml"), "utf8");
  if (!lock.includes(`version: ${version}`) && !lock.includes(`version: '${version}'`)) throw new Error("LOCKFILE_RELEASE_VERSION_MISSING");
  return { schema: "horseness.release-coherence.v1", version, manifests: manifests.map(({ path, value }) => ({ path, name: value.name, digest: sha256(canonical(value)) })) };
}
if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? "")}`).href) process.stdout.write(`${canonical(await verifyCoherence())}\n`);
