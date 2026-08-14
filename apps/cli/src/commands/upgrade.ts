import { cliFailureV1, cliSuccessV1 } from "../result.js";
import { requiredInstallerRuntimeV1, type CliCommandDefinitionV1 } from "../registry.js";

export const UPGRADE_COMMAND_V1: CliCommandDefinitionV1 = {
  name: "upgrade", aliases: [], summary: "upgrade Horseness installation state", usage: "upgrade --workspace PATH [options]",
  secretOptions: [], optionNames: ["workspace", "create-workspace", "host", "accept-executable-risk", "manifest", "scope", "atomic-hosts", "target-version", "allow-major-downgrade", "crash-point"],
  async execute(invocation, context) {
    try {
      const result = await requiredInstallerRuntimeV1(context).execute("upgrade", invocation);
      if (result.exitCode === 0 || result.exitCode === 3) return cliSuccessV1("upgrade", result.data, result.exitCode);
      const code = result.exitCode === 2 ? "INVALID_INVOCATION" : result.exitCode === 4 ? "CONSENT_OR_TRUST_REFUSED" : "INSTALLER_OPERATION_FAILED";
      return cliFailureV1("upgrade", code, "upgrade failed", result.data, result.exitCode);
    } catch (error) { return cliFailureV1("upgrade", "INSTALLER_RUNTIME_FAILED", error instanceof Error ? error.message : "installer runtime failed", null); }
  },
};
