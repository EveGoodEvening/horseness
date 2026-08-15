import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { daemonProcessIncarnation, type EndpointStateV1 } from "./daemon.js";

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
  if (typeof value !== "object" || value === null || !("schemaVersion" in value) || value.schemaVersion !== "1" || !("workspaceId" in value) || typeof value.workspaceId !== "string" || !("transport" in value) || (value.transport !== "stdio" && value.transport !== "unix-socket") || !("endpointPath" in value) || (value.endpointPath !== null && typeof value.endpointPath !== "string") || !("processId" in value) || !Number.isSafeInteger(value.processId) || (value.processId as number) <= 0 || !("startedAt" in value) || typeof value.startedAt !== "string") throw new Error("endpoint state invalid");
  if (!("processIncarnation" in value) || typeof value.processIncarnation !== "string" || !/^linux-proc-starttime:[0-9]+$/u.test(value.processIncarnation)) throw new Error("endpoint process incarnation unavailable");
  if (daemonProcessIncarnation(value.processId as number) !== value.processIncarnation) throw new Error("endpoint process incarnation mismatch");
  if (expectedWorkspaceId !== undefined && value.workspaceId !== expectedWorkspaceId) throw new Error("endpoint workspace binding mismatch");
  return Object.freeze(value as unknown as EndpointStateV1);
}
