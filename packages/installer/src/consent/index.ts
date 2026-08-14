import { canonicalJson, sha256Hex } from "@horseness/domain";

export type InstallConsentModeV1 = "interactive-explicit-yes" | "unattended-release-digest";

export interface InstallConsentV1 {
  readonly schema: "horseness.install-consent.v1";
  readonly releaseManifestDigest: string;
  readonly artifactDigests: readonly string[];
  readonly requestedHosts: readonly string[];
  readonly executableCapabilities: readonly string[];
  readonly installScope: "user" | "workspace";
  readonly osIdentity: {
    readonly platform: NodeJS.Platform;
    readonly arch: string;
    readonly accountId: string;
  };
  readonly acknowledgedAt: string;
  readonly mode: InstallConsentModeV1;
  readonly consentDigest: string;
}

export interface InstallConsentRequestV1 {
  readonly releaseManifestDigest: string;
  readonly artifactDigests: readonly string[];
  readonly requestedHosts: readonly string[];
  readonly executableCapabilities: readonly string[];
  readonly installScope: "user" | "workspace";
  readonly osIdentity: InstallConsentV1["osIdentity"];
  readonly acknowledgedAt: string;
  readonly interactiveAnswer?: string;
  readonly acceptedReleaseDigest?: string;
}

export class InstallConsentError extends Error {
  constructor(readonly code: string) { super(code); this.name = "InstallConsentError"; }
}

const HEX = /^[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function frozenUnique(values: readonly string[], code: string): readonly string[] {
  if (values.length === 0 || values.some((value) => !TOKEN.test(value))) throw new InstallConsentError(code);
  const sorted = [...values].sort();
  if (sorted.some((value, index) => index > 0 && value === sorted[index - 1])) throw new InstallConsentError(code);
  return Object.freeze(sorted);
}


export function createInstallConsentV1(request: InstallConsentRequestV1): InstallConsentV1 {
  if (!HEX.test(request.releaseManifestDigest) || request.artifactDigests.length === 0 || request.artifactDigests.some((digest) => !HEX.test(digest))) {
    throw new InstallConsentError("INVALID_CONSENT_DIGEST");
  }
  if (!TOKEN.test(request.osIdentity.accountId) || !TOKEN.test(request.osIdentity.arch) || !Number.isFinite(Date.parse(request.acknowledgedAt))) {
    throw new InstallConsentError("INVALID_CONSENT_IDENTITY");
  }
  let mode: InstallConsentModeV1;
  if (request.interactiveAnswer !== undefined) {
    if (request.interactiveAnswer !== "yes") throw new InstallConsentError("CONSENT_EXPLICIT_YES_REQUIRED");
    if (request.acceptedReleaseDigest !== undefined) throw new InstallConsentError("CONSENT_MODE_AMBIGUOUS");
    mode = "interactive-explicit-yes";
  } else {
    if (request.acceptedReleaseDigest !== request.releaseManifestDigest) throw new InstallConsentError("CONSENT_RELEASE_DIGEST_MISMATCH");
    mode = "unattended-release-digest";
  }
  const artifactDigests = Object.freeze([...request.artifactDigests].sort());
  const requestedHosts = frozenUnique(request.requestedHosts, "INVALID_CONSENT_HOSTS");
  const executableCapabilities = frozenUnique(request.executableCapabilities, "INVALID_CONSENT_CAPABILITIES");
  const core = Object.freeze({
    schema: "horseness.install-consent.v1" as const,
    releaseManifestDigest: request.releaseManifestDigest,
    artifactDigests,
    requestedHosts,
    executableCapabilities,
    installScope: request.installScope,
    osIdentity: Object.freeze({ ...request.osIdentity }),
    acknowledgedAt: new Date(request.acknowledgedAt).toISOString(),
    mode,
  });
  return Object.freeze({ ...core, consentDigest: sha256Hex(`horseness.install-consent.v1\0${canonicalJson(core)}`) });
}

export function assertInstallConsentV1(value: unknown, expected: Omit<InstallConsentRequestV1, "interactiveAnswer" | "acceptedReleaseDigest" | "acknowledgedAt">): asserts value is InstallConsentV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InstallConsentError("INVALID_CONSENT_SCHEMA");
  const keys = Object.keys(value).sort();
  const expectedKeys = ["acknowledgedAt", "artifactDigests", "consentDigest", "executableCapabilities", "installScope", "mode", "osIdentity", "releaseManifestDigest", "requestedHosts", "schema"].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) throw new InstallConsentError("INVALID_CONSENT_SCHEMA");
  const consent = value as InstallConsentV1;
  const rebuilt = createInstallConsentV1({
    releaseManifestDigest: consent.releaseManifestDigest,
    artifactDigests: consent.artifactDigests,
    requestedHosts: consent.requestedHosts,
    executableCapabilities: consent.executableCapabilities,
    installScope: consent.installScope,
    osIdentity: consent.osIdentity,
    acknowledgedAt: consent.acknowledgedAt,
    ...(consent.mode === "interactive-explicit-yes" ? { interactiveAnswer: "yes" } : { acceptedReleaseDigest: consent.releaseManifestDigest }),
  });
  if (canonicalJson(rebuilt) !== canonicalJson(consent)) throw new InstallConsentError("CONSENT_INTEGRITY_MISMATCH");
  if (consent.releaseManifestDigest !== expected.releaseManifestDigest
    || canonicalJson(consent.artifactDigests) !== canonicalJson([...expected.artifactDigests].sort())
    || canonicalJson(consent.requestedHosts) !== canonicalJson([...expected.requestedHosts].sort())
    || canonicalJson(consent.executableCapabilities) !== canonicalJson([...expected.executableCapabilities].sort())
    || consent.installScope !== expected.installScope || canonicalJson(consent.osIdentity) !== canonicalJson(expected.osIdentity)) {
    throw new InstallConsentError("CONSENT_BINDING_MISMATCH");
  }
}
