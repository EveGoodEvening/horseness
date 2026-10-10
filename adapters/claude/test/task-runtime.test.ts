import assert from "node:assert/strict";
import test from "node:test";
import { parseClaudeTaskTerminalV1, resolveClaudeTaskProfileV1 } from "../src/task-runtime.js";
import type { TaskEffortV1 } from "@horseness/domain";
const model = "claude-sonnet-4-20250514";
const init = { type: "system", subtype: "init", model, session_id: "native-session" };
const terminal = { type: "result", subtype: "success", is_error: false, session_id: "native-session", result: "arbitrary task output" };
const wire = (...items: unknown[]) => items.map(item => JSON.stringify(item)).join("\n");
void test("Claude accepts native terminal output and classifies real error terminals", () => {
  assert.equal(parseClaudeTaskTerminalV1(wire(init, terminal), model, 0).outcome, "succeeded");
  assert.equal(parseClaudeTaskTerminalV1(wire(init, { ...terminal, subtype: "error_max_turns", is_error: true }), model, 1).outcome, "failed");
  assert.equal(parseClaudeTaskTerminalV1(wire(init, { ...terminal, permission_denials: [{ tool_name: "Bash" }] }), model, 0).outcome, "failed");
  assert.equal(parseClaudeTaskTerminalV1(wire(init, { type: "user", message: { content: [{ type: "tool_result", is_error: true }] } }, terminal), model, 0).outcome, "failed");
});
void test("Claude rejects missing, duplicate, conflicting and unobservable native identity", () => {
  assert.throws(() => parseClaudeTaskTerminalV1(wire(init), model, 0), /AMBIGUOUS/);
  assert.throws(() => parseClaudeTaskTerminalV1(wire(init, terminal, terminal), model, 0), /AMBIGUOUS/);
  assert.throws(() => parseClaudeTaskTerminalV1(wire(init, { ...terminal, session_id: "other" }), model, 0), /BINDING_MISMATCH/);
  assert.throws(() => parseClaudeTaskTerminalV1(wire({ ...init, model: "other" }, terminal), model, 0), /MODEL_MISMATCH/);
  assert.throws(() => parseClaudeTaskTerminalV1(wire({ ...init, model: undefined }, terminal), model, 0), /UNOBSERVABLE/);
  assert.throws(() => parseClaudeTaskTerminalV1("not-json", model, 0));
});
void test("Claude unresolved default and mutable aliases fail before executable inspection", async () => {
  for (const selected of [null, "sonnet", "default"]) await assert.rejects(resolveClaudeTaskProfileV1({ workspacePath: "/unused", model: selected, purpose: "work", executablePath: "/does-not-exist" }), /MODEL_REQUIRED/);
});
void test("Claude rejects invalid effort before native inspection",async()=>{
 for(const effort of [null,"disabled","ultra",1])await assert.rejects(resolveClaudeTaskProfileV1({workspacePath:"/unused",model,purpose:"work",executablePath:"/does-not-exist",effort:effort as TaskEffortV1}),{code:"EXECUTION_INVALID"});
});
void test("Claude accepts every public effort before trusted executable inspection", async () => {
 for (const effort of ["off", "none", "low", "medium", "high", "xhigh", "max"] as const) {
  await assert.rejects(resolveClaudeTaskProfileV1({workspacePath:"/unused",model,purpose:"work",executablePath:"/does-not-exist",effort}), {code:"ENOENT"});
 }
});
