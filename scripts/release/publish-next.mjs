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
  publish: (item) => run("npm", ["publish", item.tarballPath, "--access", "public", "--tag", "next", "--provenance"], {
    code: `NPM_PUBLISH_FAILED:${item.name}`,
    limit: 4 * 1024 * 1024,
  }),
  setTag: (item, tag) => run("npm", ["dist-tag", "add", `${item.name}@${item.version}`, tag], {
    code: `NPM_DIST_TAG_FAILED:${item.name}:${tag}`,
  }),
};

export async function publishNextPackages(packages, operations = defaultOperations) {
  const results = [];
  for (const item of packages) {
    const existing = await operations.getIntegrity(item.name, item.version);
    let status;
    if (existing === null) {
      await operations.publish(item);
      status = "published";
    } else {
      if (existing !== item.integrity) throw new Error(`NPM_EXISTING_VERSION_INTEGRITY_MISMATCH:${item.name}@${item.version}`);
      status = "reconciled";
    }
    const observed = await operations.getIntegrity(item.name, item.version);
    if (observed !== item.integrity) throw new Error(`NPM_PUBLISHED_INTEGRITY_MISMATCH:${item.name}@${item.version}`);
    if (await operations.getTag(item.name, "next") !== item.version) await operations.setTag(item, "next");
    if (await operations.getTag(item.name, "next") !== item.version) throw new Error(`NPM_NEXT_TAG_MISMATCH:${item.name}`);
    results.push({ name: item.name, version: item.version, integrity: item.integrity, status });
  }
  return results;
}

export async function publishNext(candidatePath, operations = defaultOperations, expectedVersion) {
  const candidate = await loadCandidate(candidatePath);
  if (expectedVersion !== undefined && candidate.manifest.version !== expectedVersion) throw new Error("NPM_CANDIDATE_VERSION_MISMATCH");
  const packages = await publishNextPackages(candidate.packages, operations);
  return {
    schema: "horseness.npm-next-publication.v1",
    version: candidate.manifest.version,
    packages,
  };
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? "")}`).href) {
  const args = parseArgs();
  for (const key of args.keys()) if (!["candidate", "version", "provenance"].includes(key)) throw new Error(`UNEXPECTED_ARGUMENT:--${key}`);
  if (args.get("provenance") !== true) throw new Error("NPM_PROVENANCE_REQUIRED");
  if (process.env.CI !== "1") throw new Error("NPM_PUBLICATION_REQUIRES_CI");
  if (process.env.NODE_AUTH_TOKEN === undefined && process.env.ACTIONS_ID_TOKEN_REQUEST_URL === undefined) throw new Error("NPM_PUBLICATION_AUTHORITY_MISSING");
  const candidate = String(args.get("candidate") ?? resolve(RELEASE_ROOT, "build-1", "release-manifest.json"));
  const version = args.get("version");
  if (typeof version !== "string") throw new Error("NPM_RELEASE_VERSION_REQUIRED");
  process.stdout.write(`${canonical(await publishNext(candidate, defaultOperations, version))}\n`);
}
