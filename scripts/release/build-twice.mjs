import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PUBLISHABLE_MANIFESTS, ROOT, RELEASE_IDENTITY, canonical, inventory, provenanceSubjects, run, sha256 } from "./lib.mjs";
import { verifyCoherence } from "./coherence.mjs";
import { signDigest } from "./side-effect-journal.mjs";

async function build(number, coherence) {
  const root = resolve(ROOT, ".acceptance", `build-${number}`); await rm(root, { recursive: true, force: true }); await mkdir(resolve(root, "packages"), { recursive: true, mode: 0o700 });
  const env = { ...process.env, CI: "1", TZ: "UTC", LANG: "C", SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "1767225600", npm_config_provenance: "false" };
  for (const manifestPath of PUBLISHABLE_MANIFESTS) { const manifest = JSON.parse(await readFile(resolve(ROOT, manifestPath), "utf8")); await run("corepack", ["pnpm", "--filter", manifest.name, "pack", "--pack-destination", resolve(root, "packages")], { env, code: `PACK_FAILED:${manifest.name}` }); }
  const artifacts = await inventory(resolve(root, "packages"));
  const dependencyGraph = { schema: "horseness.release-dependency-graph.v1", version: coherence.version, packages: PUBLISHABLE_MANIFESTS.map((path) => coherence.manifests.find((item) => item.path === path)) };
  await writeFile(resolve(root, "dependency-graph.json"), `${canonical(dependencyGraph)}\n`, { mode: 0o600 });
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: `urn:uuid:${sha256(canonical(dependencyGraph)).slice(0, 32)}`, version: 1, metadata: { timestamp: "2026-01-01T00:00:00.000Z", component: { type: "application", name: "horseness", version: coherence.version } }, components: coherence.manifests.map((item) => ({ type: "library", name: item.name, version: coherence.version, hashes: [{ alg: "SHA-256", content: item.digest }] })) };
  await writeFile(resolve(root, "sbom.cdx.json"), `${canonical(sbom)}\n`, { mode: 0o600 });
  const provenance = { _type: "https://in-toto.io/Statement/v1", subject: provenanceSubjects(artifacts), predicateType: "https://slsa.dev/provenance/v1", predicate: { buildDefinition: { buildType: "https://horseness.dev/build/v1", externalParameters: { version: coherence.version }, internalParameters: {}, resolvedDependencies: [] }, runDetails: { builder: { id: `${RELEASE_IDENTITY.issuer}/${RELEASE_IDENTITY.repository}/${RELEASE_IDENTITY.workflow}` }, metadata: { invocationId: process.env.GITHUB_RUN_ID ?? "local-untrusted-build", startedOn: "2026-01-01T00:00:00.000Z", finishedOn: "2026-01-01T00:00:00.000Z" } } } };
  await writeFile(resolve(root, "provenance.intoto.jsonl"), `${canonical(provenance)}\n`, { mode: 0o600 });
  const complete = await inventory(root); const manifest = { schema: "horseness.release-candidate.v1", version: coherence.version, build: number, identity: RELEASE_IDENTITY, artifacts: complete.filter((item) => item.path !== "release-manifest.json") };
  await writeFile(resolve(root, "release-manifest.json"), `${canonical(manifest)}\n`, { mode: 0o600 });
  const manifestDigest = sha256(canonical(manifest)); const provenanceDigest = sha256(`${canonical(provenance)}\n`);
  await writeFile(resolve(root, "release-manifest.sig"), `${canonical({ payloadDigest: manifestDigest, ...await signDigest(manifestDigest) })}\n`, { mode: 0o600 });
  await writeFile(resolve(root, "provenance.sig"), `${canonical({ payloadDigest: provenanceDigest, ...await signDigest(provenanceDigest) })}\n`, { mode: 0o600 });
  return root;
}
const coherence = await verifyCoherence(); const first = await build(1, coherence); const second = await build(2, coherence);
const normalize = (items) => items.filter((item) => item.path !== "release-manifest.json" && !item.path.endsWith(".sig")); const left = normalize(await inventory(first)); const right = normalize(await inventory(second));
if (canonical(left) !== canonical(right)) throw new Error("RELEASE_BUILDS_NOT_REPRODUCIBLE");
process.stdout.write(`${canonical({ schema: "horseness.reproducible-build.v1", version: coherence.version, inventoryDigest: sha256(canonical(left)), artifacts: left.length })}\n`);
