import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

import { importBoundaryError } from "../../scripts/boundaries-check.mjs";

const packageDir = path.resolve("packages/orchestrator");
const file = path.join(packageDir, "src/attempts/attempts.ts");
const workspaceNames = new Set(["@horseness/domain", "@horseness/orchestrator", "@horseness/store-sqlite"]);

test("allows relative sibling imports contained by the current package", () => {
  assert.equal(importBoundaryError({ file, packageDir, specifier: "../context/reconstruction.js", workspaceNames }), null);
});

test("rejects relative imports that escape into another package", () => {
  assert.equal(
    importBoundaryError({ file, packageDir, specifier: "../../../domain/src/index.js", workspaceNames }),
    "deep or escaping import ../../../domain/src/index.js",
  );
});

test("rejects workspace package deep imports while allowing package roots", () => {
  assert.equal(importBoundaryError({ file, packageDir, specifier: "@horseness/domain", workspaceNames }), null);
  assert.equal(
    importBoundaryError({ file, packageDir, specifier: "@horseness/domain/src/events.js", workspaceNames }),
    "cross-package deep import @horseness/domain/src/events.js",
  );
});
