export interface UpstreamArtifactPinV1 {
  readonly identity: string;
  readonly version: string;
  readonly registryUrl: string;
  readonly packageIntegrity: string;
  readonly archiveSha256: string;
  readonly cacheKey: string;
  readonly executable: { readonly path: string; readonly sha256: string };
}

export interface C11HostFixtureV1 {
  readonly artifact: UpstreamArtifactPinV1;
  readonly officialValidation: {
    readonly kind: "same-distribution-interface";
    readonly provenance: {
      readonly artifactIdentity: string;
      readonly interfacePath: string;
      readonly interfaceSha256: string;
    };
    readonly command: readonly string[];
  };
}

export interface AcquiredUpstreamArtifactV1 {
  readonly cachePath: string;
  readonly executablePath: string;
  readonly archivePath: string;
  readonly source: "cache" | "registry";
}

export function acquireUpstreamArtifact(
  pin: UpstreamArtifactPinV1,
  options?: Readonly<{ cacheRoot?: string }>,
): Promise<AcquiredUpstreamArtifactV1>;

export function verifyOfficialValidation(
  manifest: C11HostFixtureV1,
  acquired: AcquiredUpstreamArtifactV1,
): Promise<{
  readonly executablePath: string;
  readonly cachePath: string;
  readonly source: "same-distribution";
}>;
