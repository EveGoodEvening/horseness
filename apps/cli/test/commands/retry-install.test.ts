import test from "node:test";
import assert from "node:assert/strict";
import { CliCommandRegistryV1 } from "../../src/registry.js";
import { registerInstallerCommandsV1 } from "../../src/router.js";
import { runCliV1 } from "../../src/runtime.js";
test("retry-install routes through installer runtime and preserves exit semantics", async () => { const registry = new CliCommandRegistryV1(); registerInstallerCommandsV1(registry); let called = ""; const exit = await runCliV1(["retry-install", "--workspace", "/tmp/workspace", "--json"], { registry, transport: { request: async () => { throw new Error("unused"); } }, credential: { schemaVersion: "1", kind: "host-reference", reference: "grant:test", scope: { workspaceId: "workspace:test", adapterId: "horseness-cli", purpose: "coordinator" } }, installer: { execute: async (command) => { called = command; return { exitCode: 0, data: { command } }; } }, stdout: () => {}, stderr: () => {} }); assert.equal(called, "retry-install"); assert.equal(exit, 0); });
