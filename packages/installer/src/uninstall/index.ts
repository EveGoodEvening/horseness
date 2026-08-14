import { join } from "node:path";
import { InstallerJournal, installerSha256 } from "../journal/index.js";
import { disableAndRemoveContributionV1, type InstallDaemonClientV1, type InstallHostIdV1, type NeutralInstallBundleV1 } from "../operations/index.js";

export interface UninstallRequestV1 { readonly bundle: NeutralInstallBundleV1; readonly stateRoot: string; readonly discoveryRoots: Readonly<Record<InstallHostIdV1, string>>; readonly workspaceId: string; readonly accountId: string; readonly daemon: InstallDaemonClientV1; readonly hosts: readonly InstallHostIdV1[] | "all"; readonly crash?: (point: string) => void; }
export interface UninstallResultV1 { readonly schema: "horseness.uninstall-result.v1"; readonly exitCode: 0 | 1 | 3; readonly removed: readonly InstallHostIdV1[]; readonly failed: readonly { readonly hostId: InstallHostIdV1; readonly code: string }[]; }
export async function uninstallNeutralBundleV1(request: UninstallRequestV1): Promise<UninstallResultV1> {
  const hosts = request.hosts === "all" ? (["pi", "omp", "claude", "codex"] as const) : request.hosts;
  const transactionId = `uninstall-${Date.now()}-${process.pid}`; const journal = await InstallerJournal.open(join(request.stateRoot, "journal"));
  await journal.append({ operation: "uninstall-pending", transactionId, releaseVersion: request.bundle.releaseVersion, detailDigest: installerSha256(request.bundle.releaseManifestDigest) });
  const removed: InstallHostIdV1[] = []; const failed: { hostId: InstallHostIdV1; code: string }[] = [];
  for (const hostId of hosts) { const entry = request.bundle.contributions.find((candidate) => candidate.hostId === hostId); if (entry === undefined) { failed.push({ hostId, code: "CATALOG_ENTRY_MISSING" }); continue; }
    try { await disableAndRemoveContributionV1({ entry, root: request.discoveryRoots[hostId], workspaceId: request.workspaceId, accountId: request.accountId, daemon: request.daemon, ...(request.crash === undefined ? {} : { crash: request.crash }) }); removed.push(hostId); } catch (error) { failed.push({ hostId, code: error instanceof Error && "code" in error ? String((error as Error & { code: string }).code) : "UNINSTALL_FAILED" }); }
  }
  if (failed.length === 0) await journal.append({ operation: "uninstalled", transactionId, releaseVersion: request.bundle.releaseVersion, detailDigest: installerSha256(JSON.stringify(removed)) });
  return { schema: "horseness.uninstall-result.v1", exitCode: failed.length === 0 ? 0 : removed.length > 0 ? 3 : 1, removed: Object.freeze(removed), failed: Object.freeze(failed) };
}
