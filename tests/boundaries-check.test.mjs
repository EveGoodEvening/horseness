import test from "node:test";
import assert from "node:assert/strict";
import { checkBoundaries } from "../scripts/boundaries-check.mjs";
test("bootstrap is a registered executable boundary", async () => { const result = await checkBoundaries(); assert.equal(result.packageCount, 15); assert.deepEqual(result.errors, []); });
