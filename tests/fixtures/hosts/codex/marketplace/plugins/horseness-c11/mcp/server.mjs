#!/usr/bin/env node
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  const result = request.method === "initialize"
    ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "horseness-c11", version: "1.0.0" } }
    : request.method === "tools/list"
      ? { tools: [{ name: "deterministic_attempt", description: "Return fixed C11 evidence", inputSchema: { type: "object", additionalProperties: false } }] }
      : request.method === "tools/call"
        ? { content: [{ type: "text", text: "CODEX_DETERMINISTIC_OUTPUT_V1\nCODEX_EVIDENCE_V1" }] }
        : {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
});
