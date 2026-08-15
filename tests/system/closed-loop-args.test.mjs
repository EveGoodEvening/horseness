import assert from "node:assert/strict";
import test from "node:test";
import { parseHosts } from "./closed-loop-args.mjs";

const EXPECTED_HOSTS = ["pi", "omp", "claude", "codex"];

test("closed-loop arguments accept the exact host gate with at most one leading separator", () => {
  assert.deepEqual(parseHosts(["--hosts", "pi,omp,claude,codex"]), EXPECTED_HOSTS);
  assert.deepEqual(parseHosts(["--", "--hosts", "pi,omp,claude,codex"]), EXPECTED_HOSTS);
});

test("closed-loop arguments reject extras, reordering, omissions, and multiple separators", () => {
  const invalidArguments = [
    [],
    ["--hosts"],
    ["--hosts", "pi,omp,claude"],
    ["--hosts", "omp,pi,claude,codex"],
    ["--hosts", "pi,omp,claude,codex", "extra"],
    ["--", "--", "--hosts", "pi,omp,claude,codex"],
    ["--host", "pi,omp,claude,codex"],
  ];

  for (const argv of invalidArguments) assert.throws(() => parseHosts(argv));
});
