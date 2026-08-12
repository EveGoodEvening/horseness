import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { EndpointStateV1 } from "./daemon.js";

export function discoverDaemonEndpoint(statePath: string, expectedWorkspaceId?: string): EndpointStateV1 {
  const absolute = resolve(statePath);
  const leaf = lstatSync(absolute);
  const parent = lstatSync(dirname(absolute));
  if (!leaf.isFile() || leaf.isSymbolicLink() || (leaf.mode & 0o777) !== 0o600) throw new Error("endpoint state permissions invalid");
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0) throw new Error("endpoint state directory permissions invalid");
  if (realpathSync(absolute) !== absolute || realpathSync(dirname(absolute)) !== dirname(absolute)) throw new Error("endpoint state path is not canonical");
  if (process.platform !== "win32") {
    const processUid = process.getuid?.();
    if (processUid !== undefined && (statSync(absolute).uid !== processUid || statSync(dirname(absolute)).uid !== processUid)) throw new Error("endpoint state owner mismatch");
  }
  const value: unknown = JSON.parse(readFileSync(absolute, "utf8"));
  if (typeof value !== "object" || value === null || !("schemaVersion" in value) || value.schemaVersion !== "1" || !("workspaceId" in value) || typeof value.workspaceId !== "string" || !("transport" in value) || (value.transport !== "stdio" && value.transport !== "unix-socket") || !("endpointPath" in value) || (value.endpointPath !== null && typeof value.endpointPath !== "string") || !("processId" in value) || !Number.isSafeInteger(value.processId) || !("startedAt" in value) || typeof value.startedAt !== "string") throw new Error("endpoint state invalid");
  if (expectedWorkspaceId !== undefined && value.workspaceId !== expectedWorkspaceId) throw new Error("endpoint workspace binding mismatch");
  return Object.freeze(value as EndpointStateV1);
}
