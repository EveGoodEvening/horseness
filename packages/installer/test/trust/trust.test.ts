import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { InstallerTrustError, verifyReleaseV1, type ProjectTrustRootV1, type SignedReleaseManifestV1 } from "../../src/trust/index.js";

const fixtures = resolve("../../tests/fixtures/compat-train");
async function load(): Promise<{ signed: SignedReleaseManifestV1; trustRoot: ProjectTrustRootV1 }> {
  return {
    signed: JSON.parse(await readFile(join(fixtures, "release-manifest.v1.json"), "utf8")) as SignedReleaseManifestV1,
    trustRoot: JSON.parse(await readFile(join(fixtures, "trust-root.v1.json"), "utf8")) as ProjectTrustRootV1,
  };
}

test("frozen project delegation verifies artifact graph and Sigstore identity", async () => {
  const { signed, trustRoot } = await load();
  const state = await verifyReleaseV1({ signed, trustRoot, artifactRoot: fixtures, dependencyGraphPath: join(fixtures, "dependency-graph.v1.json") });
  assert.equal(state.highestSequence, 1);
  assert.equal(state.version, "0.0.0-compat.1");
});

for (const [name, mutate, code] of [
  ["wrong issuer", (root: ProjectTrustRootV1) => ({ ...root, requiredSigstoreIdentity: { ...root.requiredSigstoreIdentity, issuer: "https://issuer.invalid" } }), "SIGSTORE_IDENTITY_MISMATCH"],
  ["wrong repository", (root: ProjectTrustRootV1) => ({ ...root, requiredSigstoreIdentity: { ...root.requiredSigstoreIdentity, repository: "attacker/repository" } }), "SIGSTORE_IDENTITY_MISMATCH"],
  ["revoked key", (root: ProjectTrustRootV1) => ({ ...root, revokedKeyIds: ["release-compat-1"] }), "SIGNING_KEY_REVOKED"],
] as const) {
  test(`${name} fails closed`, async () => {
    const { signed, trustRoot } = await load();
    await assert.rejects(verifyReleaseV1({ signed, trustRoot: mutate(trustRoot), artifactRoot: fixtures, dependencyGraphPath: join(fixtures, "dependency-graph.v1.json") }), (error: unknown) => error instanceof InstallerTrustError && error.code === code);
  });
}

test("artifact and dependency tamper fail closed", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "horseness-trust-"));
  try {
    await cp(fixtures, temporary, { recursive: true });
    const { signed, trustRoot } = await load();
    await writeFile(join(temporary, "compat-train-0.0.0-compat.1.tgz"), "tampered\n");
    await assert.rejects(verifyReleaseV1({ signed, trustRoot, artifactRoot: temporary, dependencyGraphPath: join(temporary, "dependency-graph.v1.json") }), (error: unknown) => error instanceof InstallerTrustError && error.code === "RELEASE_ARTIFACT_TAMPERED");
    await cp(fixtures, temporary, { recursive: true, force: true });
    await writeFile(join(temporary, "dependency-graph.v1.json"), "{}\n");
    await assert.rejects(verifyReleaseV1({ signed, trustRoot, artifactRoot: temporary, dependencyGraphPath: join(temporary, "dependency-graph.v1.json") }), (error: unknown) => error instanceof InstallerTrustError && error.code === "DEPENDENCY_GRAPH_TAMPERED");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("sequence/version replay is rejected", async () => {
  const { signed, trustRoot } = await load();
  await assert.rejects(verifyReleaseV1({ signed, trustRoot, artifactRoot: fixtures, dependencyGraphPath: join(fixtures, "dependency-graph.v1.json"), replayState: { highestSequence: 2, version: "0.0.0", manifestDigest: "0".repeat(64) } }), (error: unknown) => error instanceof InstallerTrustError && error.code === "RELEASE_REPLAY_REFUSED");
});

test("wrong release key fails closed", async () => {
  const { signed, trustRoot } = await load();
  const substituted = { ...signed, keyId: "attacker-key" };
  await assert.rejects(verifyReleaseV1({ signed: substituted, trustRoot, artifactRoot: fixtures, dependencyGraphPath: join(fixtures, "dependency-graph.v1.json") }), (error: unknown) => error instanceof InstallerTrustError && error.code === "SIGNING_KEY_NOT_DELEGATED");
});
