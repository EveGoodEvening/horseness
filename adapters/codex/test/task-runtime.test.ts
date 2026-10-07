import assert from "node:assert/strict";
import test from "node:test";
import { createCodexTaskParserV1, resolveCodexTaskProfileV1 } from "../src/task-runtime.js";
const model = "gpt-5.4";
function started(purpose: "work" | "planner" = "work") {
  const parser = createCodexTaskParserV1(model, "bound context", "/authority/workspace", purpose);
  const requests: string[] = [];
  const write = (input: string) => { requests.push(input); };
  const end = () => {};
  parser.onLine(JSON.stringify({ id: 1, result: {} }), write, end);
  parser.onLine(JSON.stringify({ id: 2, result: { thread: { id: "thread" }, model, modelProvider: "openai" } }), write, end);
  parser.onLine(JSON.stringify({ id: 4, result: { data: [], nextCursor: null } }), write, end);
  parser.onLine(JSON.stringify({ id: 3, result: { turn: { id: "turn" } } }), write, end);
  return { parser, requests, write, end };
}
test("Codex requires a native terminal and preserves real error/cancellation outcomes", () => {
  for (const status of ["completed", "failed", "interrupted"]) {
    const { parser, write, end } = started();
    assert.throws(() => parser.finish(0), /TERMINAL_MISSING/);
    parser.onLine(JSON.stringify({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status } } }), write, end);
    assert.equal(parser.finish(0).outcome, status === "completed" ? "succeeded" : status === "interrupted" ? "cancelled" : "failed");
    assert.throws(() => parser.onLine(JSON.stringify({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status } } }), write, end), /AMBIGUOUS/);
  }
});
test("Codex rejects model/provider substitution, foreign sessions, conflicting items and RPC failure", () => {
  const parser = createCodexTaskParserV1(model, "context", "/workspace");
  assert.throws(() => parser.onLine(JSON.stringify({ id: 2, result: { thread: { id: "thread" }, model: "other", modelProvider: "openai" } }), () => {}, () => {}), /BINDING_MISMATCH/);
  const { parser: active, write, end } = started();
  assert.throws(() => active.onLine(JSON.stringify({ error: { code: -1 } }), write, end), /RPC_ERROR/);
  assert.throws(() => active.onLine(JSON.stringify({ method: "item/completed", params: { threadId: "foreign" } }), write, end), /BINDING_MISMATCH/);
  active.onLine(JSON.stringify({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", id: "item", text: "first" } } }), write, end);
  assert.throws(() => active.onLine(JSON.stringify({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "agentMessage", id: "item", text: "different" } } }), write, end), /CONFLICT/);
  assert.throws(() => active.onLine(JSON.stringify({ id: 1, result: {} }), write, end), /INITIALIZE_AMBIGUOUS/);
});
test("Codex native tool failure cannot yield success and planner denies writing", () => {
  const { parser, requests, write, end } = started("planner");
  assert.equal(JSON.parse(requests[1]!).params.permissions, ":read-only");
  parser.onLine(JSON.stringify({ method: "item/completed", params: { threadId: "thread", turnId: "turn", item: { type: "commandExecution", id: "command", exitCode: 1 } } }), write, end);
  parser.onLine(JSON.stringify({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } }), write, end);
  assert.equal(parser.finish(0).outcome, "failed");
});
test("Codex defaults fail before native inspection", async () => {
  for (const selected of [null, "auto", "default"]) await assert.rejects(resolveCodexTaskProfileV1({ workspacePath: "/unused", model: selected, purpose: "work", executablePath: "/does-not-exist" }), /MODEL_REQUIRED/);
});

test("Codex sends no model turn until complete native MCP inventory proves confinement", () => {
  const parser = createCodexTaskParserV1(model, "context", "/workspace", "planner");
  const requests: Record<string, unknown>[] = [];
  const write = (line: string) => { requests.push(JSON.parse(line)); };
  const end = () => {};
  parser.onLine(JSON.stringify({ id: 1, result: {} }), write, end);
  const threadRequest = requests.find(request => request.method === "thread/start")!;
  const params = threadRequest.params as Record<string, unknown>;
  const config = params.config as Record<string, unknown>;
  for (const feature of ["apps", "enable_mcp_apps", "plugins", "shell_tool", "unified_exec", "code_mode", "code_mode_host", "code_mode_only", "tool_suggest", "multi_agent", "multi_agent_v2", "enable_fanout"]) assert.equal(config[`features.${feature}`], false);
  assert.deepEqual(params.dynamicTools, []);
  parser.onLine(JSON.stringify({ id: 2, result: { thread: { id: "thread" }, model, modelProvider: "openai" } }), write, end);
  assert.equal(requests.some(request => request.method === "turn/start"), false);
  assert.deepEqual(requests.at(-1), { jsonrpc: "2.0", id: 4, method: "mcpServerStatus/list", params: { threadId: "thread", detail: "full" } });
  parser.onLine(JSON.stringify({ id: 4, result: { data: [], nextCursor: null } }), write, end);
  assert.equal(requests.filter(request => request.method === "turn/start").length, 1);
  assert.throws(() => parser.onLine(JSON.stringify({ id: 4, result: { data: [], nextCursor: null } }), write, end), /CONFINEMENT_FAILED/);
});

test("Codex refuses ambient MCP servers, incomplete inventories, and unsupported inventory before a turn", () => {
  const inventories = [
    { data: [{ name: "mutating", tools: { erase: { name: "erase" } } }], nextCursor: null },
    { data: [{ name: "preconfigured", tools: {} }], nextCursor: null },
    { data: [], nextCursor: "more" }, { data: [] }, { nextCursor: null },
  ];
  for (const purpose of ["planner", "work"] as const) for (const inventory of inventories) {
    const parser = createCodexTaskParserV1(model, "context", "/workspace", purpose);
    const requests: string[] = [];
    const write = (line: string) => { requests.push(JSON.parse(line).method); };
    const end = () => {};
    parser.onLine(JSON.stringify({ id: 1, result: {} }), write, end);
    parser.onLine(JSON.stringify({ id: 2, result: { thread: { id: "thread" }, model, modelProvider: "openai" } }), write, end);
    assert.throws(() => parser.onLine(JSON.stringify({ id: 4, result: inventory }), write, end), /CONFINEMENT_FAILED/);
    assert.throws(() => parser.onLine(JSON.stringify({ id: 4, result: { data: [], nextCursor: null } }), write, end), /CONFINEMENT_FAILED/);
    assert.equal(requests.includes("turn/start"), false);
    assert.throws(() => parser.finish(0), /TERMINAL_MISSING/);
  }
  const parser = createCodexTaskParserV1(model, "context", "/workspace", "planner");
  const requests: string[] = [];
  const write = (line: string) => { requests.push(JSON.parse(line).method); };
  assert.throws(() => parser.onLine(JSON.stringify({ id: 3, result: { turn: { id: "turn" } } }), write, () => {}), /CONFINEMENT_FAILED/);
  const unsupported = createCodexTaskParserV1(model, "context", "/workspace", "planner");
  assert.throws(() => unsupported.onLine(JSON.stringify({ id: 4, error: { code: -32601 } }), write, () => {}), /RPC_ERROR/);
  assert.throws(() => unsupported.onLine(JSON.stringify({ id: 4, result: { data: [], nextCursor: null } }), write, () => {}), /CONFINEMENT_FAILED/);
  assert.equal(requests.includes("turn/start"), false);
});
