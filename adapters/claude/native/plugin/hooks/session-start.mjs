import { createConnection } from "node:net";

const input = JSON.parse(await new Promise((resolve, reject) => { let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => resolve(value)); process.stdin.on("error", reject); }));
const socketPath = process.env.HORSENESS_CLAUDE_RUNTIME_SOCKET;
const nonce = process.env.HORSENESS_CLAUDE_RUNTIME_NONCE;
if (typeof socketPath !== "string" || socketPath.length === 0 || typeof nonce !== "string" || nonce.length < 32) throw new Error("HORSENESS_NATIVE_RUNTIME_UNAVAILABLE");
const source = input.source ?? "startup";
if (!["startup", "resume", "fork", "clear", "compact"].includes(source) || typeof input.session_id !== "string" || input.session_id.length === 0) throw new Error("HORSENESS_SESSION_START_INVALID");
const response = await new Promise((resolve, reject) => {
  const socket = createConnection({ path: socketPath }); let wire = "";
  socket.setEncoding("utf8");
  socket.once("connect", () => socket.end(`${JSON.stringify({ schemaVersion: "HorsenessClaudeSessionStartRequestV1", nonce, start: { sessionId: input.session_id, source, previousSessionId: process.env.HORSENESS_CLAUDE_PREVIOUS_SESSION_ID, branchEntryId: process.env.HORSENESS_CLAUDE_BRANCH_ENTRY_ID } })}\n`));
  socket.on("data", chunk => { wire += chunk; if (Buffer.byteLength(wire) > 16_384) socket.destroy(new Error("HORSENESS_NATIVE_RUNTIME_RESPONSE_TOO_LARGE")); });
  socket.once("error", reject);
  socket.once("end", () => { try { resolve(JSON.parse(wire)); } catch (error) { reject(error); } });
});
if (response.schemaVersion !== "HorsenessClaudeRuntimeResponseV1" || response.ok !== true) throw new Error(typeof response.reason === "string" ? response.reason : "HORSENESS_SESSION_BINDING_REJECTED");
const context = response.context;
if (context?.schemaVersion !== "HorsenessClaudeAttemptContextV1" || typeof context.renderedContext !== "string" || Buffer.byteLength(context.renderedContext) > 4096) throw new Error("HORSENESS_CONTEXT_INVALID");
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `[horseness-context-v1 session=${input.session_id} source=${source} forkPinDigest=${context.binding.forkPinDigest}]\n${context.renderedContext}` } }));
