import { resolve } from "node:path";
import {
  RELEASE_ROOT,
  canonical,
  loadCandidate,
  parseArgs,
  registryIntegrity,
  registryTagVersion,
  run,
} from "./lib.mjs";

const defaultOperations = {
  getIntegrity: registryIntegrity,
  getTag: registryTagVersion,
  setTag: (item, tag) => run("npm", ["dist-tag", "add", `${item.name}@${item.version}`, tag], {
    code: `NPM_DIST_TAG_FAILED:${item.name}:${tag}`,
  }),
};

export async function promoteLatestPackages(packages, operations = defaultOperations) {
  const results = [];
  for (const item of packages) {
    if (await operations.getIntegrity(item.name, item.version) !== item.integrity) throw new Error(`PROMOTION_INTEGRITY_MISMATCH:${item.name}@${item.version}`);
    if (await operations.getTag(item.name, "next") !== item.version) throw new Error(`PROMOTION_NEXT_TAG_MISMATCH:${item.name}`);
    if (await operations.getTag(item.name, "latest") !== item.version) await operations.setTag(item, "latest");
    if (await operations.getTag(item.name, "latest") !== item.version) throw new Error(`PROMOTION_LATEST_TAG_MISMATCH:${item.name}`);
    results.push({ name: item.name, version: item.version, integrity: item.integrity });
  }
  return results;
}

export async function promoteLatest(candidatePath, operations = defaultOperations, expectedVersion) {
  const candidate = await loadCandidate(candidatePath);
  if (expectedVersion !== undefined && candidate.manifest.version !== expectedVersion) throw new Error("PROMOTION_CANDIDATE_VERSION_MISMATCH");
  const packages = await promoteLatestPackages(candidate.packages, operations);
  return {
    schema: "horseness.npm-latest-promotion.v1",
    version: candidate.manifest.version,
    packages,
  };
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? "")}`).href) {
  const args = parseArgs();
  for (const key of args.keys()) if (!["candidate", "version"].includes(key)) throw new Error(`UNEXPECTED_ARGUMENT:--${key}`);
  if (process.env.CI !== "1") throw new Error("NPM_PROMOTION_REQUIRES_CI");
  if (process.env.NODE_AUTH_TOKEN === undefined) throw new Error("NPM_PROMOTION_AUTHORITY_MISSING");
  const candidate = String(args.get("candidate") ?? resolve(RELEASE_ROOT, "build-1", "release-manifest.json"));
  const version = args.get("version");
  if (typeof version !== "string") throw new Error("NPM_RELEASE_VERSION_REQUIRED");
  process.stdout.write(`${canonical(await promoteLatest(candidate, defaultOperations, version))}\n`);
}
