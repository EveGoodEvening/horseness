import { evidenceDigest, stableResult } from "../../scripts/host-feasibility/lib/contracts.mjs";
import { parseValidatorArgs } from "../../scripts/host-feasibility/lib/runner.mjs";
const { mode } = parseValidatorArgs(process.argv.slice(2));
const scenario = process.env.HORSENESS_TEST_SCENARIO ?? "good";
const map = {
  good: ["pass", "OK", true, true],
  missing: ["fail", "NATIVE_BINARY_MISSING", false, false],
  tampered: ["fail", "NATIVE_BINARY_TAMPERED", false, false],
  incompatible: ["fail", "NATIVE_VERSION_INCOMPATIBLE", false, false],
  cli: ["fail", "CLI_ONLY_FALLBACK", false, true],
  validatorMissing: ["fail", "OFFICIAL_VALIDATOR_MISSING", true, false],
  liveAbsent: ["skip", "LIVE_CREDENTIAL_ABSENT", true, true],
  liveRequiredAbsent: ["fail", "LIVE_REQUIRED_CREDENTIAL_ABSENT", true, true],
  liveInvalid: ["fail", "LIVE_CREDENTIAL_INVALID", true, true]
};
const selected = map[scenario];
if (!selected) throw new Error("unknown test scenario");
const [status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied] = selected;
const result = stableResult({ host: "pi", mode, status, reasonCode, nativeMinimumSatisfied, officialValidatorSatisfied, capabilities: { scenario }, evidenceDigest: evidenceDigest({ scenario, mode }) });
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exitCode = status === "fail" ? 1 : 0;
