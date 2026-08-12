#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("codex-cli 0.144.1\n");
  process.exit(0);
}
if (args[0] === "host-feasibility" && args[1] === "--input" && args[2]) {
  const input = JSON.parse(await readFile(args[2], "utf8"));
  const attemptId = createHash("sha256").update(`codex-attempt-v1\0${input.session}\0${input.provider}`).digest("hex");
  const receiptId = createHash("sha256").update(`codex-receipt-v1\0${attemptId}\0${input.binding}`).digest("hex");
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "CodexNativeFeasibilityV1",
    native: true,
    cliFallback: false,
    contribution: { plugin: "horseness", skill: "horseness-reconcile", mcp: "horseness" },
    contextInjected: input.context === "horseness deterministic context v1",
    attempt: { id: attemptId, provider: input.provider, output: "CODEX_DETERMINISTIC_OUTPUT_V1", evidence: "CODEX_EVIDENCE_V1" },
    receiptBinding: { id: receiptId, attemptId, binding: input.binding },
    restartReconcile: { state: "reconciled", attemptId, receiptId },
    resume: { supported: true, thread: input.session, cursor: input.resumeCursor, attemptId },
    forkSwitch: { state: "switched", from: input.binding, to: input.forkBinding },
    uninstall: { state: "clean", removed: ["plugin", "skill", "mcp"] }
  })}\n`);
  process.exit(0);
}
process.stderr.write("unsupported Codex fixture invocation\n");
process.exit(64);
