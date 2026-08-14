import test from "node:test";
import assert from "node:assert/strict";
import { repairNeutralInstallV1 } from "../../src/index.js";
test("repair is a distinct mutating API", () => { assert.equal(typeof repairNeutralInstallV1, "function"); });
