import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";
import {
  C22_COMMANDS,
  DEFERRED_MANIFESTS,
  PUBLISHABLE_MANIFESTS,
  canonical,
  loadCandidate,
  readJson,
  platformCommand,
  run,
  sha256,
  sha512Integrity,
} from "../lib.mjs";
import { verifyCoherence } from "../coherence.mjs";
import { publishNext, publishNextPackages } from "../publish-next.mjs";
import { verifyPublicPackages } from "../verify-public.mjs";
import { promoteLatestPackages } from "../promote-latest.mjs";

async function coherenceFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "horseness-release-coherence-"));
  const manifests = [];
  for (const path of PUBLISHABLE_MANIFESTS) {
    const source = await readJson(resolve(import.meta.dirname, "../../..", path));
    const value = { name: source.name, version: "1.0.0", private: false, type: "module", license: "MIT", publishConfig: { access: "public" } };
    manifests.push({ path, value });
  }
  manifests[1].value.dependencies = { [manifests[0].value.name]: "workspace:1.0.0" };
  const deferredPath = DEFERRED_MANIFESTS[0];
  const deferred = { path: deferredPath, value: { name: "@horseness/bootstrap", version: "0.0.0", private: true, type: "module", dependencies: { [manifests[0].value.name]: "workspace:*" } } };
  for (const { path, value } of [...manifests, deferred]) {
    await mkdir(resolve(root, dirname(path)), { recursive: true });
    await writeFile(resolve(root, path), `${JSON.stringify(value)}\n`);
  }
  const byName = new Map([...manifests, deferred].map(({ path, value }) => [value.name, dirname(path)]));
  const importers = Object.fromEntries([...manifests, deferred].map(({ path, value }) => {
    const importerName = dirname(path);
    const dependencies = Object.fromEntries(Object.entries(value.dependencies ?? {}).map(([name, specifier]) => [name, { specifier, version: `link:${relative(importerName, byName.get(name)).replaceAll("\\", "/")}` }]));
    return [importerName, Object.keys(dependencies).length === 0 ? {} : { dependencies }];
  }));
  await writeFile(resolve(root, "pnpm-lock.yaml"), stringify({ lockfileVersion: "9.0", importers }));
  return { root, manifests, deferred };
}

async function candidateFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "horseness-release-candidate-"));
  await mkdir(resolve(root, "packages"));
  const packages = [];
  for (const manifestPath of PUBLISHABLE_MANIFESTS) {
    const manifest = await readJson(resolve(import.meta.dirname, "../../..", manifestPath));
    const filename = `${manifest.name.slice(1).replace("/", "-")}-1.0.0.tgz`;
    const bytes = Buffer.from(`tarball:${manifest.name}`);
    await writeFile(resolve(root, "packages", filename), bytes);
    packages.push({
      name: manifest.name,
      version: "1.0.0",
      manifestPath,
      tarball: `packages/${filename}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
      integrity: sha512Integrity(bytes),
    });
  }
  const manifestPath = resolve(root, "release-manifest.json");
  await writeFile(manifestPath, `${canonical({ schema: "horseness.npm-candidate.v1", version: "1.0.0", sourceCommit: "a".repeat(40), packages })}\n`);
  return { root, manifestPath, packages };
}

test("command and package contracts are exact", () => {
  assert.equal(C22_COMMANDS.length, 9);
  assert.equal(new Set(C22_COMMANDS).size, 9);
  assert.equal(PUBLISHABLE_MANIFESTS.length, 14);
  assert.deepEqual(DEFERRED_MANIFESTS, ["apps/bootstrap/package.json"]);
  assert.ok(!PUBLISHABLE_MANIFESTS.includes("apps/bootstrap/package.json"));
});

test("release command runner resolves Windows shims", () => {
  assert.equal(platformCommand("npm", "win32"), "npm.cmd");
  assert.equal(platformCommand("git", "win32"), "git");
  assert.equal(platformCommand("npm", "linux"), "npm");
});

test("workflow binds every public side effect to exact upstream runs", async () => {
  const workflow = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/release.yml"), "utf8");
  const parsed = parse(workflow);
  assert.equal(parsed["run-name"], "npm release ${{ inputs.phase }} ${{ inputs.version }} candidate=${{ inputs.candidate_run_id }}");
  assert.deepEqual(parsed.on.workflow_dispatch.inputs.phase.options, ["publish-next", "verify-public", "promote-latest"]);
  assert.deepEqual(Object.keys(parsed.jobs).sort(), ["build-candidate", "promote-latest", "publish-next", "verify-public"]);
  for (const phase of ["publish-next", "verify-public", "promote-latest"]) assert.match(workflow, new RegExp(phase, "u"));
  for (const runner of ["ubuntu-latest", "macos-latest", "windows-latest"]) assert.match(workflow, new RegExp(runner, "u"));
  assert.match(workflow, /environment: release/u);
  assert.match(workflow, /secrets\.NPM_TOKEN/u);
  assert.match(workflow, /RELEASE_VERSION: \$\{\{ inputs\.version \}\}/u);
  assert.match(workflow, /--version "\$RELEASE_VERSION"/u);
  assert.match(workflow, /--provenance/u);
  assert.match(workflow, /conclusion,displayTitle,event,headBranch,workflowName/u);
  assert.match(workflow, /success\|workflow_dispatch\|main\|npm release\|npm release publish-next \$RELEASE_VERSION candidate=/u);
  assert.match(workflow, /success\|workflow_dispatch\|main\|npm release\|npm release verify-public \$RELEASE_VERSION candidate=\$CANDIDATE_RUN_ID/u);
  assert.match(workflow, /git rev-list -n 1 "\$tag"/u);
  assert.match(workflow, /gh release create "\$tag" --target "\$target"/u);
  for (const obsolete of ["verify-root-ceremony", "KMS", "immutable", "artifact-receipt", "live-gates", "c22-signed-builds"]) assert.doesNotMatch(workflow, new RegExp(obsolete, "u"));
});

test("bootstrap is explicitly deferred from npm publication", async () => {
  const bootstrap = await readJson(resolve(import.meta.dirname, "../../../apps/bootstrap/package.json"));
  assert.equal(bootstrap.version, "0.0.0");
  assert.equal(bootstrap.private, true);
  assert.equal(bootstrap.publishConfig, undefined);
  for (const [name, specifier] of Object.entries(bootstrap.dependencies)) if (name.startsWith("@horseness/")) assert.equal(specifier, "workspace:*");
});

test("coherence accepts fourteen public packages and one private deferred bootstrap", async () => {
  const fixture = await coherenceFixture();
  try {
    const result = await verifyCoherence(fixture.root);
    assert.equal(result.schema, "horseness.release-coherence.v2");
    assert.equal(result.manifests.length, 14);
    assert.equal(result.deferred.length, 1);
    fixture.deferred.value.publishConfig = { access: "public" };
    await writeFile(resolve(fixture.root, fixture.deferred.path), JSON.stringify(fixture.deferred.value));
    await assert.rejects(verifyCoherence(fixture.root), /DEFERRED_PACKAGE_METADATA_INVALID/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("candidate manifest binds every tarball and rejects tamper", async () => {
  const fixture = await candidateFixture();
  try {
    const loaded = await loadCandidate(fixture.manifestPath);
    assert.equal(loaded.packages.length, 14);
    await assert.rejects(publishNext(fixture.manifestPath, {}, "2.0.0"), /NPM_CANDIDATE_VERSION_MISMATCH/u);
    await writeFile(loaded.packages[0].tarballPath, "tampered");
    await assert.rejects(loadCandidate(fixture.manifestPath), /RELEASE_CANDIDATE_TARBALL_MISMATCH/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("publish-next reconciles exact versions and repairs the next tag", async () => {
  const packages = [
    { name: "@horseness/a", version: "1.0.0", integrity: "sha512-YQ==", tarballPath: "/a.tgz" },
    { name: "@horseness/b", version: "1.0.0", integrity: "sha512-Yg==", tarballPath: "/b.tgz" },
  ];
  const integrities = new Map([["@horseness/a", "sha512-YQ=="]]);
  const tags = new Map();
  const published = [];
  const operations = {
    getIntegrity: async (name) => integrities.get(name) ?? null,
    getTag: async (name, tag) => tags.get(`${name}:${tag}`) ?? null,
    publish: async (item) => { published.push(item.name); integrities.set(item.name, item.integrity); tags.set(`${item.name}:next`, item.version); },
    setTag: async (item, tag) => { tags.set(`${item.name}:${tag}`, item.version); },
  };
  const result = await publishNextPackages(packages, operations);
  assert.deepEqual(published, ["@horseness/b"]);
  assert.deepEqual(result.map((item) => item.status), ["reconciled", "published"]);
  assert.equal(tags.get("@horseness/a:next"), "1.0.0");
  integrities.set("@horseness/a", "sha512-bWlzbWF0Y2g=");
  await assert.rejects(publishNextPackages(packages.slice(0, 1), operations), /NPM_EXISTING_VERSION_INTEGRITY_MISMATCH/u);
});

test("public verification requires exact integrity and next tags before smoke", async () => {
  const packages = [{ name: "@horseness/a", version: "1.0.0", integrity: "sha512-YQ==" }];
  let smoked = false;
  const operations = {
    getIntegrity: async () => "sha512-YQ==",
    getTag: async () => "1.0.0",
    installAndSmoke: async () => { smoked = true; },
  };
  await verifyPublicPackages(packages, operations);
  assert.equal(smoked, true);
  operations.getTag = async () => "0.9.0";
  await assert.rejects(verifyPublicPackages(packages, operations), /PUBLIC_NEXT_TAG_MISMATCH/u);
});

test("promotion moves latest only from the verified next version", async () => {
  const packages = [{ name: "@horseness/a", version: "1.0.0", integrity: "sha512-YQ==" }];
  const tags = new Map([["next", "1.0.0"]]);
  const operations = {
    getIntegrity: async () => "sha512-YQ==",
    getTag: async (_name, tag) => tags.get(tag) ?? null,
    setTag: async (_item, tag) => { tags.set(tag, "1.0.0"); },
  };
  await promoteLatestPackages(packages, operations);
  assert.equal(tags.get("latest"), "1.0.0");
  tags.set("next", "0.9.0");
  await assert.rejects(promoteLatestPackages(packages, operations), /PROMOTION_NEXT_TAG_MISMATCH/u);
});

test("release command and secret policies pass", async () => {
  await run(process.execPath, [resolve(import.meta.dirname, "../verify-commands.mjs")]);
  await run(process.execPath, [resolve(import.meta.dirname, "../verify-no-static-secrets.mjs")]);
});
