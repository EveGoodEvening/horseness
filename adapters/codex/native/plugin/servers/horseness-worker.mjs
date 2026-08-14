import { createConnection } from "node:net";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

const MAX_LINE_BYTES = 8_192;
const MAX_OUTPUT_BYTES = 1_024;
const MAX_EVIDENCE_BYTES = 1_024;
const socketPath = process.env.HORSENESS_CODEX_RUNTIME_SOCKET;
const runtimeNonce = process.env.HORSENESS_CODEX_RUNTIME_NONCE;
const threadClaim = process.env.HORSENESS_CODEX_THREAD_CLAIM;
const environmentKeys = Object.keys(process.env).sort();
const expectedEnvironmentKeys = ["HORSENESS_CODEX_RUNTIME_NONCE", "HORSENESS_CODEX_RUNTIME_SOCKET", "HORSENESS_CODEX_THREAD_CLAIM"].sort();
if (environmentKeys.some(key => /(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|COOKIE|API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|PROXY)/i.test(key)) || expectedEnvironmentKeys.some(key => !environmentKeys.includes(key))) {
  process.stderr.write("HORSENESS_NATIVE_ENVIRONMENT_INVALID\n");
  process.exit(1);
}
if (typeof socketPath !== "string" || socketPath.length === 0 || typeof runtimeNonce !== "string" || runtimeNonce.length < 32 || typeof threadClaim !== "string" || threadClaim.length < 32) {
  process.stderr.write("HORSENESS_NATIVE_RUNTIME_UNAVAILABLE\n");
  process.exit(1);
}

const digest = value => createHash("sha256").update(value).digest("hex");
function validateScenario(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BOUND_WORKER_INPUT");
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "attemptCapabilityReference,evidenceClaim,outputText") throw new Error("INVALID_BOUND_WORKER_INPUT");
  const { attemptCapabilityReference, outputText, evidenceClaim } = value;
  if (typeof attemptCapabilityReference !== "string" || attemptCapabilityReference.length < 8 || attemptCapabilityReference.length > 256) throw new Error("INVALID_ATTEMPT_CAPABILITY");
  const outputBytes = typeof outputText === "string" ? Buffer.byteLength(outputText) : 0;
  if (outputBytes === 0 || outputBytes > MAX_OUTPUT_BYTES) throw new Error("INVALID_OUTPUT_BOUNDS");
  const evidenceBytes = typeof evidenceClaim === "string" ? Buffer.byteLength(evidenceClaim) : 0;
  if (evidenceBytes === 0 || evidenceBytes > MAX_EVIDENCE_BYTES) throw new Error("INVALID_EVIDENCE_BOUNDS");
  return { attemptCapabilityReference, outputText, evidenceClaim, outputBytes, evidenceBytes };
}
function validateArguments(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join(",") !== "scenarios" || !Array.isArray(value.scenarios) || value.scenarios.length !== 5) throw new Error("INVALID_EXACT_SCENARIO_BATCH");
  const scenarios = value.scenarios.map(validateScenario);
  if (new Set(scenarios.map(item => item.attemptCapabilityReference)).size !== 5) throw new Error("INVALID_EXACT_SCENARIO_BATCH");
  return scenarios;
}
function invokeRuntime(input) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let response = "";
    const timer = setTimeout(() => socket.destroy(new Error("HORSENESS_NATIVE_RUNTIME_TIMEOUT")), 10_000);
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.end(`${JSON.stringify({ schemaVersion: "HorsenessCodexRuntimeRequestV1", nonce: runtimeNonce, threadClaim, input })}\n`));
    socket.on("data", chunk => { response += chunk; if (Buffer.byteLength(response) > MAX_LINE_BYTES) socket.destroy(new Error("HORSENESS_NATIVE_RUNTIME_RESPONSE_TOO_LARGE")); });
    socket.once("error", reject);
    socket.once("end", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(response);
        if (parsed.schemaVersion !== "HorsenessCodexRuntimeResponseV1" || parsed.ok !== true) throw new Error(typeof parsed.reason === "string" ? parsed.reason : "HORSENESS_NATIVE_RUNTIME_REJECTED");
        resolve(parsed.result);
      } catch (error) { reject(error); }
    });
  });
}
function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
async function handle(message) {
  if (message.method === "initialize") return send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "horseness-codex-worker", version: "0.1.0" } } });
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") return send({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "horseness_worker_return", description: "Deliver one exact batch of five bounded native Horseness WorkerReturns through the trusted adapter runtime.", inputSchema: { type: "object", additionalProperties: false, required: ["scenarios"], properties: { scenarios: { type: "array", minItems: 5, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["attemptCapabilityReference", "outputText", "evidenceClaim"], properties: { attemptCapabilityReference: { type: "string", minLength: 8, maxLength: 256 }, outputText: { type: "string", minLength: 1, maxLength: MAX_OUTPUT_BYTES }, evidenceClaim: { type: "string", minLength: 1, maxLength: MAX_EVIDENCE_BYTES } } } } } } }] } });
  if (message.method === "tools/call") {
    try {
      if (message.params?.name !== "horseness_worker_return") throw new Error("UNKNOWN_NATIVE_TOOL");
      const scenarios = validateArguments(message.params.arguments);
      const result = await invokeRuntime({ scenarios: scenarios.map(input => ({ attemptCapabilityReference: input.attemptCapabilityReference, output: { digest: digest(input.outputText), mediaType: "text/plain", byteLength: input.outputBytes }, evidence: { digest: digest(input.evidenceClaim), mediaType: "application/json", byteLength: input.evidenceBytes } })) });
      return send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: JSON.stringify({ ...result, environmentAudit: { passed: true, keys: environmentKeys } }) }] } });
    } catch (error) {
      return send({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "HORSENESS_NATIVE_TOOL_FAILED" }] } });
    }
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) process.exitCode = 1;
  while (buffer.includes("\n")) {
    const index = buffer.indexOf("\n");
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (line.trim().length > 0) void Promise.resolve().then(() => handle(JSON.parse(line))).catch(error => send({ jsonrpc: "2.0", id: null, error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" } }));
  }
});
