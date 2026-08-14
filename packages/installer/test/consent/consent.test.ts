import assert from "node:assert/strict";
import test from "node:test";
import { assertInstallConsentV1, createInstallConsentV1, InstallConsentError } from "../../src/consent/index.js";

const releaseManifestDigest = "a".repeat(64);
const request = {
  releaseManifestDigest,
  artifactDigests: ["b".repeat(64)],
  requestedHosts: ["claude", "codex"],
  executableCapabilities: ["native-plugin", "stdio-mcp"],
  installScope: "user" as const,
  osIdentity: { platform: process.platform, arch: process.arch, accountId: "uid-1000" },
  acknowledgedAt: "2026-08-14T00:00:00.000Z",
};

test("explicit and unattended consent bind the exact mutation identity", () => {
  const interactive = createInstallConsentV1({ ...request, interactiveAnswer: "yes" });
  const unattended = createInstallConsentV1({ ...request, acceptedReleaseDigest: releaseManifestDigest });
  assert.equal(interactive.mode, "interactive-explicit-yes");
  assert.equal(unattended.mode, "unattended-release-digest");
  assertInstallConsentV1(interactive, request);
  assertInstallConsentV1(unattended, request);
});

test("missing, mismatched, or rebound consent fails before mutation", () => {
  assert.throws(() => createInstallConsentV1({ ...request, interactiveAnswer: "y" }), (error: unknown) => error instanceof InstallConsentError && error.code === "CONSENT_EXPLICIT_YES_REQUIRED");
  assert.throws(() => createInstallConsentV1({ ...request, acceptedReleaseDigest: "c".repeat(64) }), (error: unknown) => error instanceof InstallConsentError && error.code === "CONSENT_RELEASE_DIGEST_MISMATCH");
  const consent = createInstallConsentV1({ ...request, interactiveAnswer: "yes" });
  assert.throws(() => assertInstallConsentV1(consent, { ...request, requestedHosts: ["pi"] }), (error: unknown) => error instanceof InstallConsentError && error.code === "CONSENT_BINDING_MISMATCH");
});
