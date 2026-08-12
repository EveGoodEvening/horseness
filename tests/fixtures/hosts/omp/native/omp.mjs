#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  console.log("omp/17.2.15");
  process.exit(0);
}
if (args[0] === "plugin" && args[1] === "doctor" && args[2] === "--json") {
  console.log(JSON.stringify({ validator: "omp-plugin-doctor/17.2.15", status: "pass", native: true }));
  process.exit(0);
}
if (args[0] === "host-feasibility" && args[1] === "--input") {
  const input = JSON.parse(await readFile(args[2], "utf8"));
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  console.log(JSON.stringify({
    native: true,
    contribution: "omp-plugin-skills",
    contextInjected: input.context === "horseness deterministic context v1",
    attempt: { provider: input.provider, output: "OMP_DETERMINISTIC_OUTPUT_V1", evidence: "OMP_EVIDENCE_V1" },
    receiptBinding: input.receiptBinding,
    restartReconcile: "reconciled",
    resume: { supported: true, session: input.session, cursor: input.resumeCursor },
    forkSwitch: "new-binding",
    uninstall: "clean",
    requestDigest: `sha256:${digest}`
  }));
  process.exit(0);
}
console.error("unsupported OMP fixture invocation");
process.exit(64);
