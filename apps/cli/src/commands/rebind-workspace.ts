import { cliFailureV1, cliSuccessV1 } from "../result.js";
import { requiredInstallerRuntimeV1, type CliCommandDefinitionV1 } from "../registry.js";

export const REBIND_WORKSPACE_COMMAND_V1: CliCommandDefinitionV1 = {
  name: "rebind-workspace", aliases: [], summary: "rebind-workspace Horseness installation state", usage: "rebind-workspace --workspace PATH [options]",
  secretOptions: [], optionNames: ["workspace", "create-workspace", "host", "accept-executable-risk", "manifest", "scope", "atomic-hosts", "target-version", "allow-major-downgrade"],
  async execute(invocation, context) {
    try {
      const result = await requiredInstallerRuntimeV1(context).execute("rebind-workspace", invocation);
      if (result.exitCode === 0 || result.exitCode === 3) return cliSuccessV1("rebind-workspace", result.data, result.exitCode);
      const code = result.exitCode === 2 ? "INVALID_INVOCATION" : result.exitCode === 4 ? "CONSENT_OR_TRUST_REFUSED" : "INSTALLER_OPERATION_FAILED";
      return cliFailureV1("rebind-workspace", code, "rebind-workspace failed", result.data, result.exitCode);
    } catch (error) { return cliFailureV1("rebind-workspace", "INSTALLER_RUNTIME_FAILED", error instanceof Error ? error.message : "installer runtime failed", null); }
  },
};
