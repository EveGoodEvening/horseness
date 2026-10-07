import { realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
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
  try { return realpathSync(absolute); } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(canonicalPath(parent), basename(absolute));
  }
}

export function resolveDaemonConfig(config: DaemonConfigV1): ResolvedDaemonConfigV1 {
  const workspacePath = canonicalPath(config.workspacePath);
  const databasePath = canonicalPath(config.databasePath);
  const artifactRoot = canonicalPath(config.artifactRoot);
  const stateDirectory = resolve(workspacePath, ".horseness");
  const transport: DaemonTransportConfigV1 = config.transport.kind === "unix-socket"
    ? { kind: "unix-socket", endpointPath: canonicalPath(config.transport.endpointPath) }
    : config.transport;
  return Object.freeze({
    ...config,
    workspacePath,
    databasePath,
    artifactRoot,
    transport,
    workspaceId: config.workspaceId ?? domainDigest("horseness.workspace-path.v1", workspacePath),
    stateDirectory,
    bootstrapCapabilityPath: resolve(stateDirectory, "bootstrap-capability.v1.json"),
    endpointStatePath: resolve(stateDirectory, "daemon-endpoint.v1.json"),
  });
}
