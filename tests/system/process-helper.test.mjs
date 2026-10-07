import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCommand } from "./process-helper.mjs";

test("an independent nested Node test executes its body and propagates assertion failure", { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "horseness-nested-test-"));
  const child = join(root, "failing.test.mjs");
  const marker = join(root, "executed");
  try {
    await writeFile(child, `
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";
test("intentional child failure", () => {
  writeFileSync(${JSON.stringify(marker)}, "child test body executed");
  assert.fail("intentional assertion failure for subprocess propagation");
});
`);
    const result = await runCommand(process.execPath, ["--test", child], { timeoutMs: 10_000 });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 1, `Child assertion failure was lost: ${result.stdout}\n${result.stderr}`);
    assert.equal(await readFile(marker, "utf8"), "child test body executed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
