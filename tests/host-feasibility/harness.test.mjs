import assert from "node:assert/strict";
import test from "node:test";
import { invokeValidator } from "../../scripts/host-feasibility/lib/runner.mjs";

const executable = "tests/host-feasibility/fixture-validator.mjs";
const fixture = "tests/fixtures/hosts/provider/request.v1.json";
const cases = [
  ["good native and official validator", "hermetic", "good", "pass", "OK"],
  ["missing native fails closed", "hermetic", "missing", "fail", "NATIVE_BINARY_MISSING"],
  ["tampered native fails closed", "hermetic", "tampered", "fail", "NATIVE_BINARY_TAMPERED"],
  ["incompatible native fails closed", "hermetic", "incompatible", "fail", "NATIVE_VERSION_INCOMPATIBLE"],
  ["CLI fallback cannot pass", "hermetic", "cli", "fail", "CLI_ONLY_FALLBACK"],
  ["missing official validator fails closed", "hermetic", "validatorMissing", "fail", "OFFICIAL_VALIDATOR_MISSING"],
  ["local live absent credential skips", "live", "liveAbsent", "skip", "LIVE_CREDENTIAL_ABSENT"],
  ["publication live absent credential fails", "live", "liveRequiredAbsent", "fail", "LIVE_REQUIRED_CREDENTIAL_ABSENT"],
  ["configured invalid live credential fails", "live", "liveInvalid", "fail", "LIVE_CREDENTIAL_INVALID"]
];
for (const [name, mode, scenario, status, reasonCode] of cases) test(name, async () => {
  const { result } = await invokeValidator({ executable, fixture, mode, env: { HORSENESS_TEST_SCENARIO: scenario } });
  assert.equal(result.status, status); assert.equal(result.reasonCode, reasonCode);
});

test("runner rejects extra output", async () => {
  await assert.rejects(invokeValidator({ executable: "tests/host-feasibility/invalid-output.mjs", fixture, mode: "hermetic" }), /emitted 2 JSON lines/);
});
