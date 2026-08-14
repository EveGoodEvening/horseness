import test from "node:test";
import assert from "node:assert/strict";
import { doctorNeutralInstallV1 } from "../../src/inspectors/index.js";
test("inspectors expose only the pure doctor surface", () => assert.equal(typeof doctorNeutralInstallV1, "function"));
