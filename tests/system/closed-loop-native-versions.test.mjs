import assert from "node:assert/strict";
import test from "node:test";
import { expectedNativeVersion } from "./closed-loop-native-versions.mjs";

test("closed-loop pins each host to its exact native artifact version", () => {
  assert.deepEqual(
    ["pi", "omp", "claude", "codex"].map((host) => [host, expectedNativeVersion(host)]),
    [
      ["pi", "0.73.1"],
      ["omp", "17.2.15"],
      ["claude", "2.1.228"],
      ["codex", "0.144.1-linux-x64"],
    ],
  );
  assert.notEqual(expectedNativeVersion("codex"), "0.144.1");
  assert.throws(() => expectedNativeVersion("unknown"), /unsupported closed-loop host unknown/);
});
