import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { domainDigest } from "@horseness/domain";

export type DaemonTransportConfigV1 = { readonly kind: "stdio" } | { readonly kind: "unix-socket"; readonly endpointPath: string };

export interface DaemonConfigV1 {
  readonly workspacePath: string;
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly transport: DaemonTransportConfigV1;
  readonly authorityTime: () => string;
  readonly workspaceId?:string;
}

export interface ResolvedDaemonConfigV1 extends DaemonConfigV1 {
  readonly workspaceId: string;
  readonly workspacePath: string;
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly stateDirectory: string;
  readonly bootstrapCapabilityPath: string;
  readonly endpointStatePath: string;
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try { return realpathSync(absolute); } catch { return absolute; }
}

export function resolveDaemonConfig(config: DaemonConfigV1): ResolvedDaemonConfigV1 {
  const workspacePath = canonicalPath(config.workspacePath);
  const databasePath = canonicalPath(config.databasePath);
  const artifactRoot = canonicalPath(config.artifactRoot);
  const stateDirectory = resolve(workspacePath, ".horseness");
  return Object.freeze({
    ...config,
    workspacePath,
    databasePath,
    artifactRoot,
    workspaceId: config.workspaceId ?? domainDigest("horseness.workspace-path.v1", workspacePath),
    stateDirectory,
    bootstrapCapabilityPath: resolve(stateDirectory, "bootstrap-capability.v1.json"),
    endpointStatePath: resolve(stateDirectory, "daemon-endpoint.v1.json"),
  });
}
