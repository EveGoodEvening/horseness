import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { installerSha256 } from "../journal/index.js";
import type { InstallDaemonClientV1, InstallHostIdV1, NeutralInstallBundleV1 } from "../operations/index.js";

export type DoctorFindingCodeV1 = "HEALTHY" | "MISSING" | "CORRUPT" | "DRIFTED" | "REVOKED" | "PENDING" | "UNKNOWN_NEWER" | "UNSAFE";
export interface DoctorFindingV1 { readonly hostId: InstallHostIdV1; readonly code: DoctorFindingCodeV1; readonly healthy: boolean; readonly detail: string; }
export interface DoctorResultV1 { readonly schema: "horseness.doctor-result.v1"; readonly healthy: boolean; readonly daemon: { readonly running: boolean; readonly bootstrapped: boolean } | null; readonly findings: readonly DoctorFindingV1[]; }
export interface DoctorInputV1 { readonly bundle: NeutralInstallBundleV1; readonly discoveryRoots: Readonly<Record<InstallHostIdV1, string>>; readonly workspaceId: string; readonly daemon?: Pick<InstallDaemonClientV1, "status">; }

async function inspectHost(input: DoctorInputV1, hostId: InstallHostIdV1): Promise<DoctorFindingV1> {
  const entry = input.bundle.contributions.find((candidate) => candidate.hostId === hostId);
  if (entry === undefined) return { hostId, code: "CORRUPT", healthy: false, detail: "catalog entry missing" };
  const root = resolve(input.discoveryRoots[hostId]); const target = resolve(root, entry.targetRelativePath);
  if (target !== root && !target.startsWith(`${root}/`) && !target.startsWith(`${root}\\`)) return { hostId, code: "UNSAFE", healthy: false, detail: "target escapes root" };
  try {
    const targetInfo = await lstat(target); if (targetInfo.isSymbolicLink() || !targetInfo.isDirectory()) return { hostId, code: "UNSAFE", healthy: false, detail: "target is not a plain directory" };
    const markerText = await readFile(`${target}.horseness-owner.json`, "utf8"); const marker = JSON.parse(markerText) as Record<string, unknown>;
    if (typeof marker.schema === "string" && /^horseness\.install-owner\.v[2-9]/u.test(marker.schema)) return { hostId, code: "UNKNOWN_NEWER", healthy: false, detail: "unknown newer owner marker" };
    if (marker.schema !== "horseness.install-owner.v1" || marker.workspaceId !== input.workspaceId || marker.releaseManifestDigest !== input.bundle.releaseManifestDigest) return { hostId, code: "DRIFTED", healthy: false, detail: "owner marker binding mismatch" };
    try { await lstat(`${target}.horseness-owner.json.kill-switch`); return { hostId, code: "REVOKED", healthy: false, detail: "kill switch present" }; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const file of entry.files) { const path = resolve(target, file.path); const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || installerSha256(await readFile(path)) !== file.contentDigest) return { hostId, code: "DRIFTED", healthy: false, detail: `managed file drift: ${file.path}` }; }
    return { hostId, code: "HEALTHY", healthy: true, detail: "managed contribution matches signed bundle" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { hostId, code: "MISSING", healthy: false, detail: "managed contribution missing" };
    if (error instanceof SyntaxError) return { hostId, code: "CORRUPT", healthy: false, detail: "owner marker is not JSON" };
    return { hostId, code: "CORRUPT", healthy: false, detail: error instanceof Error ? error.message : "inspection failed" };
  }
}
export async function doctorNeutralInstallV1(input: DoctorInputV1): Promise<DoctorResultV1> {
  const findings = await Promise.all((["pi", "omp", "claude", "codex"] as const).map((hostId) => inspectHost(input, hostId)));
  const daemon = input.daemon === undefined ? null : await input.daemon.status({ workspaceId: input.workspaceId });
  return Object.freeze({ schema: "horseness.doctor-result.v1", healthy: findings.every((finding) => finding.healthy) && (daemon === null || (daemon.running && daemon.bootstrapped)), daemon, findings: Object.freeze(findings) });
}
