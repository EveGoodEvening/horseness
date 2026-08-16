import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PUBLISHABLE_MANIFESTS,
  RELEASE_ROOT,
  ROOT,
  canonical,
  inventory,
  run,
  sha256,
  sha512Integrity,
  tarballName,
  writeJson,
} from "./lib.mjs";
import { verifyCoherence } from "./coherence.mjs";

async function build(number, coherence, sourceCommit) {
  const root = resolve(RELEASE_ROOT, `build-${number}`);
  const packageRoot = resolve(root, "packages");
  await rm(root, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    CI: "1",
    TZ: "UTC",
    LANG: "C",
    SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "1767225600",
    npm_config_provenance: "false",
  };
  const packages = [];
  for (const manifestPath of PUBLISHABLE_MANIFESTS) {
    const metadata = coherence.manifests.find((item) => item.path === manifestPath);
    if (metadata === undefined) throw new Error(`RELEASE_MANIFEST_MISSING:${manifestPath}`);
    await run("corepack", ["pnpm", "--filter", metadata.name, "pack", "--pack-destination", packageRoot], {
      env,
      code: `PACK_FAILED:${metadata.name}`,
    });
    const filename = tarballName(metadata.name, coherence.version);
    const tarballPath = resolve(packageRoot, filename);
    const bytes = await readFile(tarballPath);
    packages.push({
      name: metadata.name,
      version: coherence.version,
      manifestPath,
      tarball: `packages/${filename}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
      integrity: sha512Integrity(bytes),
    });
  }
  await writeJson(resolve(root, "release-manifest.json"), {
    schema: "horseness.npm-candidate.v1",
    version: coherence.version,
    sourceCommit,
    packages,
  });
  return root;
}

const coherence = await verifyCoherence(ROOT);
const sourceCommit = (await run("git", ["rev-parse", "HEAD"], { code: "RELEASE_SOURCE_COMMIT_UNAVAILABLE" })).stdout.trim();
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("RELEASE_SOURCE_COMMIT_INVALID");
const first = await build(1, coherence, sourceCommit);
const second = await build(2, coherence, sourceCommit);
const left = await inventory(first);
const right = await inventory(second);
if (canonical(left) !== canonical(right)) throw new Error("RELEASE_BUILDS_NOT_REPRODUCIBLE");
process.stdout.write(`${canonical({
  schema: "horseness.reproducible-npm-build.v1",
  version: coherence.version,
  packageCount: PUBLISHABLE_MANIFESTS.length,
  inventoryDigest: sha256(canonical(left)),
})}\n`);
