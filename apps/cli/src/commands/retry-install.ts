import { cliFailureV1, cliSuccessV1 } from "../result.js";
import { requiredInstallerRuntimeV1, type CliCommandDefinitionV1 } from "../registry.js";

export const RETRY_INSTALL_COMMAND_V1: CliCommandDefinitionV1 = {
  name: "retry-install", aliases: [], summary: "retry-install Horseness installation state", usage: "retry-install --workspace PATH [options]",
  secretOptions: [], optionNames: ["workspace", "create-workspace", "host", "accept-executable-risk", "manifest", "scope", "atomic-hosts", "target-version", "allow-major-downgrade"],
  async execute(invocation, context) {
    try {
      const result = await requiredInstallerRuntimeV1(context).execute("retry-install", invocation);
      if (result.exitCode === 0 || result.exitCode === 3) return cliSuccessV1("retry-install", result.data, result.exitCode);
      const code = result.exitCode === 2 ? "INVALID_INVOCATION" : result.exitCode === 4 ? "CONSENT_OR_TRUST_REFUSED" : "INSTALLER_OPERATION_FAILED";
      return cliFailureV1("retry-install", code, "retry-install failed", result.data, result.exitCode);
    } catch (error) { return cliFailureV1("retry-install", "INSTALLER_RUNTIME_FAILED", error instanceof Error ? error.message : "installer runtime failed", null); }
  },
};
