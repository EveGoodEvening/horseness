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
    if (await operations.getTag(item.name, "next") !== item.version) {
      throw new Error(`NPM_NEXT_TAG_MISMATCH:${item.name}; repair with maintainer authority: npm dist-tag add ${item.name}@${item.version} next; then retry publication`);
    }
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
  for (const key of args.keys()) if (!["candidate", "version", "provenance", "bootstrap"].includes(key)) throw new Error(`UNEXPECTED_ARGUMENT:--${key}`);
  if (args.get("provenance") !== true) throw new Error("NPM_PROVENANCE_REQUIRED");
  if (process.env.CI !== "1") throw new Error("NPM_PUBLICATION_REQUIRES_CI");
  if (args.has("bootstrap") && args.get("bootstrap") !== true) throw new Error("NPM_BOOTSTRAP_FLAG_INVALID");
  if (args.get("bootstrap") === true) {
    if (!process.env.NODE_AUTH_TOKEN?.trim()) throw new Error("NPM_BOOTSTRAP_AUTHORITY_MISSING");
  } else {
    if (process.env.NODE_AUTH_TOKEN?.trim() || process.env.NPM_TOKEN?.trim()) throw new Error("NPM_PUBLICATION_TOKEN_FORBIDDEN:use OIDC or explicitly select --bootstrap for initial package creation");
    if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL?.trim() || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN?.trim()) throw new Error("NPM_PUBLICATION_OIDC_AUTHORITY_MISSING");
  }
  const candidate = String(args.get("candidate") ?? resolve(RELEASE_ROOT, "build-1", "release-manifest.json"));
  const version = args.get("version");
  if (typeof version !== "string") throw new Error("NPM_RELEASE_VERSION_REQUIRED");
  process.stdout.write(`${canonical(await publishNext(candidate, defaultOperations, version))}\n`);
}
