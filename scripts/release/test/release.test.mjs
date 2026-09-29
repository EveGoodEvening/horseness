import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { stringify } from "yaml";
import {
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
    const value = {
      name: source.name, version: "1.0.0", private: false, type: "module", license: "MIT", publishConfig: { access: "public" },
      repository: { type: "git", url: "git+https://github.com/EveGoodEvening/horseness.git", directory: dirname(path) },
    };
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

test("release command runner resolves Windows shims", () => {
  assert.equal(platformCommand("npm", "win32"), "npm.cmd");
  assert.equal(platformCommand("git", "win32"), "git");
  assert.equal(platformCommand("npm", "linux"), "npm");
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

test("coherence rejects missing, foreign, or misplaced provenance identity", async () => {
  const fixture = await coherenceFixture();
  try {
    const item = fixture.manifests[0];
    const repository = item.value.repository;
    for (const invalid of [undefined, { ...repository, url: "git+https://github.com/untrusted/horseness.git" }, { ...repository, directory: "apps/cli" }]) {
      item.value.repository = invalid;
      await writeFile(resolve(fixture.root, item.path), JSON.stringify(item.value));
      await assert.rejects(verifyCoherence(fixture.root), /PUBLICATION_REPOSITORY_MISMATCH/u);
    }
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

test("publish-next reconciles exact tagged versions and publishes only missing versions", async () => {
  const packages = [
    { name: "@horseness/a", version: "1.0.0", integrity: "sha512-YQ==", tarballPath: "/a.tgz" },
    { name: "@horseness/b", version: "1.0.0", integrity: "sha512-Yg==", tarballPath: "/b.tgz" },
  ];
  const integrities = new Map([["@horseness/a", "sha512-YQ=="]]);
  const tags = new Map([["@horseness/a:next", "1.0.0"]]);
  const published = [];
  const operations = {
    getIntegrity: async (name) => integrities.get(name) ?? null,
    getTag: async (name, tag) => tags.get(`${name}:${tag}`) ?? null,
    publish: async (item) => { published.push(item.name); integrities.set(item.name, item.integrity); tags.set(`${item.name}:next`, item.version); },
  };
  const result = await publishNextPackages(packages, operations);
  assert.deepEqual(published, ["@horseness/b"]);
  assert.deepEqual(result.map((item) => item.status), ["reconciled", "published"]);
  assert.equal(tags.get("@horseness/a:next"), "1.0.0");
  integrities.set("@horseness/a", "sha512-bWlzbWF0Y2g=");
  await assert.rejects(publishNextPackages(packages.slice(0, 1), operations), /NPM_EXISTING_VERSION_INTEGRITY_MISMATCH/u);
});

test("publish-next refuses tag drift without mutating tags or publishing later packages", async () => {
  const item = { name: "@horseness/a", version: "1.0.0", integrity: "sha512-YQ==" };
  const mutations = [];
  const operations = {
    getIntegrity: async () => item.integrity,
    getTag: async () => "0.9.0",
    publish: async (value) => { mutations.push(`publish:${value.name}`); },
    setTag: async () => { mutations.push("dist-tag"); },
  };
  await assert.rejects(publishNextPackages([item, { ...item, name: "@horseness/b" }], operations), /NPM_NEXT_TAG_MISMATCH/u);
  assert.deepEqual(mutations, []);
});

test("publish-next refuses a newly published package whose next tag is missing", async () => {
  const item = { name: "@horseness/a", version: "1.0.0", integrity: "sha512-YQ==" };
  let integrity = null;
  let tagMutations = 0;
  const operations = {
    getIntegrity: async () => integrity,
    getTag: async () => null,
    publish: async () => { integrity = item.integrity; },
    setTag: async () => { tagMutations += 1; },
  };
  await assert.rejects(publishNextPackages([item], operations), /NPM_NEXT_TAG_MISMATCH/u);
  assert.equal(integrity, item.integrity);
  assert.equal(tagMutations, 0);
});

for (const scenario of [
  { name: "missing OIDC request token", env: { ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.invalid" }, error: /NPM_PUBLICATION_OIDC_AUTHORITY_MISSING/u },
  { name: "missing OIDC request URL", env: { ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-only" }, error: /NPM_PUBLICATION_OIDC_AUTHORITY_MISSING/u },
  { name: "implicit token fallback", env: { NODE_AUTH_TOKEN: "test-only" }, error: /NPM_PUBLICATION_TOKEN_FORBIDDEN/u },
  { name: "token supplied alongside OIDC", env: { NPM_TOKEN: "test-only", ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.invalid", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-only" }, error: /NPM_PUBLICATION_TOKEN_FORBIDDEN/u },
  { name: "empty bootstrap credential", args: ["--bootstrap"], env: { NODE_AUTH_TOKEN: " " }, error: /NPM_BOOTSTRAP_AUTHORITY_MISSING/u },
  { name: "ambiguous bootstrap flag", args: ["--bootstrap", "false"], error: /NPM_BOOTSTRAP_FLAG_INVALID/u },
]) {
  test(`publication entry point refuses ${scenario.name}`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), "horseness-release-auth-"));
    try {
      const env = { ...process.env, CI: "1", NODE_AUTH_TOKEN: "", NPM_TOKEN: "", ACTIONS_ID_TOKEN_REQUEST_URL: "", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "", ...scenario.env };
      await assert.rejects(run(process.execPath, [resolve(import.meta.dirname, "../publish-next.mjs"), "--candidate", resolve(root, "absent.json"), "--version", "1.0.0", "--provenance", ...scenario.args ?? []], { env }), scenario.error);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

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
