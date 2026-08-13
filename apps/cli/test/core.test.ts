import assert from "node:assert/strict";
import test from "node:test";
import { METHOD_REGISTRY_V1, type JsonRpcRequestV1, type JsonRpcResponseV1 } from "@horseness/protocol";
import type { AuthorizedProtocolTransportV1, OpaqueCredentialReferenceV1 } from "@horseness/sdk";
import { CliCommandRegistryV1, cliFailureV1, cliSuccessV1, createDefaultCliCommandRegistryV1, parseCliInvocationV1, protocolMethodCommandNameV1, redactCliValueV1, renderCliJsonV1, runCliV1, type CliCommandDefinitionV1 } from "../src/index.js";

const credential: OpaqueCredentialReferenceV1 = { schemaVersion: "1", kind: "host-reference", reference: "host:cli-test", scope: { workspaceId: "ws", adapterId: "authority", purpose: "cli" } };
const transport: AuthorizedProtocolTransportV1 = { request(_request: JsonRpcRequestV1): Promise<JsonRpcResponseV1> { throw new Error("unused transport"); } };
function command(name: string, aliases: readonly string[] = []): CliCommandDefinitionV1 { return { name, aliases, summary: name, usage: name, secretOptions: [], optionNames: [], async execute() { return cliSuccessV1(name, { answer: 42 }); } }; }

test("registry rejects duplicate names and aliases and resolves aliases", () => {
  const registry = new CliCommandRegistryV1();
  const first = command("first", ["one"]);
  registry.register(first);
  assert.equal(registry.resolve("one"), first);
  assert.throws(() => registry.register(command("first")), /duplicate/u);
  assert.throws(() => registry.register(command("second", ["one"])), /duplicate/u);
  assert.throws(() => registry.register(command("third", ["same", "same"])), /duplicate/u);
});

test("parser handles JSON anywhere and runtime rejects unknown commands and options", async () => {
  assert.deepEqual(parseCliInvocationV1(["--json", "first"]), { command: "first", args: [], options: {}, outputMode: "json" });
  const registry = new CliCommandRegistryV1(); registry.register(command("first"));
  const stdout: string[] = [], stderr: string[] = [];
  assert.equal(await runCliV1(["missing", "--json"], { registry, transport, credential, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) }), 2);
  assert.equal(JSON.parse(stdout.pop() ?? "").error.code, "UNKNOWN_COMMAND");
  assert.equal(await runCliV1(["first", "--unknown"], { registry, transport, credential, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) }), 2);
  assert.match(stderr.pop() ?? "", /UNKNOWN_OPTION/u);
});

test("runtime is extensible without router edits and preserves stable exits", async () => {
  const registry = new CliCommandRegistryV1(); registry.register(command("extension", ["ext"]));
  const output: string[] = [];
  assert.equal(await runCliV1(["ext", "--json"], { registry, transport, credential, stdout: (text) => output.push(text) }), 0);
  assert.equal(JSON.parse(output[0] ?? "").command, "extension");
  registry.register({ ...command("failure"), async execute() { return cliFailureV1("failure", "DENIED", "denied", null); } });
  assert.equal(await runCliV1(["failure"], { registry, transport, credential, stdout: () => undefined, stderr: () => undefined }), 1);
  registry.register({ ...command("throwing"), async execute() { throw new Error("boom"); } });
  assert.equal(await runCliV1(["throwing"], { registry, transport, credential, stdout: () => undefined, stderr: () => undefined }), 1);
});

test("coordinator command mapping is exhaustive and collision-free", () => {
  const registry = createDefaultCliCommandRegistryV1();
  assert.equal(registry.list().length, METHOD_REGISTRY_V1.length);
  assert.deepEqual(registry.list().map((entry) => entry.name).sort(), METHOD_REGISTRY_V1.map((entry) => protocolMethodCommandNameV1(entry.method)).sort());
  for (const method of METHOD_REGISTRY_V1) assert.equal(registry.resolve(protocolMethodCommandNameV1(method.method))?.name, protocolMethodCommandNameV1(method.method));
});

test("canonical JSON is deterministic and recursively redacts secrets", () => {
  const left = renderCliJsonV1(cliSuccessV1("x", { z: 1, nested: { password: "visible", a: "ok" }, token: "visible", text: "Bearer abc" }));
  const right = renderCliJsonV1(cliSuccessV1("x", { text: "Bearer abc", token: "different", nested: { a: "ok", password: "different" }, z: 1 }));
  assert.equal(left, right);
  assert.equal(left.split("\n").length, 2);
  assert.doesNotMatch(left, /visible|different|Bearer abc/u);
  assert.deepEqual(redactCliValueV1({ recoveryMaterial: "raw", array: [{ private_key: "raw" }] }), { array: [{ private_key: "[REDACTED]" }], recoveryMaterial: "[REDACTED]" });
  assert.doesNotMatch(renderCliJsonV1(cliFailureV1("x", "BAD", "ghp_abcdefghijklmnopqrstuvwxyz", { credential: { reference: "raw" } })), /ghp_|raw/u);
});
