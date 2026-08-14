import { doctorNeutralInstallV1, type DoctorResultV1 } from "../doctor/index.js";
import { installNeutralBundleV1, type InstallOperationResultV1, type InstallRequestV1 } from "../operations/index.js";
export interface RepairResultV1 { readonly schema: "horseness.repair-result.v1"; readonly before: DoctorResultV1; readonly operation: InstallOperationResultV1 | null; readonly after: DoctorResultV1; }
export async function repairNeutralInstallV1(request: InstallRequestV1): Promise<RepairResultV1> {
  const workspace = await request.daemon.ensureWorkspace({ workspacePath: request.workspacePath, create: false });
  const doctorInput = { bundle: request.bundle, discoveryRoots: request.roots.discoveryRoots, workspaceId: workspace.workspaceId, daemon: request.daemon };
  const before = await doctorNeutralInstallV1(doctorInput); const operation = before.healthy ? null : await installNeutralBundleV1(request); const after = await doctorNeutralInstallV1(doctorInput);
  return Object.freeze({ schema: "horseness.repair-result.v1", before, operation, after });
}
