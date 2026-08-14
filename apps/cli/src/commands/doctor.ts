import { cliFailureV1, cliSuccessV1 } from "../result.js";
import { requiredInstallerRuntimeV1, type CliCommandDefinitionV1 } from "../registry.js";

export const DOCTOR_COMMAND_V1: CliCommandDefinitionV1 = {
  name: "doctor", aliases: [], summary: "doctor Horseness installation state", usage: "doctor --workspace PATH [options]",
  secretOptions: [], optionNames: ["workspace", "create-workspace", "host", "accept-executable-risk", "manifest", "scope", "atomic-hosts", "target-version", "allow-major-downgrade"],
  async execute(invocation, context) {
    try {
      const result = await requiredInstallerRuntimeV1(context).execute("doctor", invocation);
      if (result.exitCode === 0 || result.exitCode === 3) return cliSuccessV1("doctor", result.data, result.exitCode);
      const code = result.exitCode === 2 ? "INVALID_INVOCATION" : result.exitCode === 4 ? "CONSENT_OR_TRUST_REFUSED" : "INSTALLER_OPERATION_FAILED";
      return cliFailureV1("doctor", code, "doctor failed", result.data, result.exitCode);
    } catch (error) { return cliFailureV1("doctor", "INSTALLER_RUNTIME_FAILED", error instanceof Error ? error.message : "installer runtime failed", null); }
  },
};
