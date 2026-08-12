#!/usr/bin/env node
import { readFile } from "node:fs/promises";

if (process.argv[2] === "--version") {
  process.stdout.write("codex-native-contribution-validator 0.144.1\n");
  process.exit(0);
}
const record = JSON.parse(await readFile(process.argv[2], "utf8"));
const contribution = record.contribution ?? {};
const ok = record.schemaVersion === "CodexNativeFeasibilityV1"
  && record.native === true
  && record.cliFallback === false
  && typeof contribution.plugin === "string"
  && typeof contribution.skill === "string"
  && typeof contribution.mcp === "string"
  && record.contextInjected === true
  && typeof record.attempt?.id === "string"
  && record.receiptBinding?.attemptId === record.attempt.id
  && record.restartReconcile?.state === "reconciled"
  && record.resume?.supported === true
  && record.resume?.attemptId === record.attempt.id
  && record.forkSwitch?.state === "switched"
  && record.forkSwitch?.from !== record.forkSwitch?.to
  && record.uninstall?.state === "clean";
process.stdout.write(`${JSON.stringify({ validator: "codex-native-contribution-validator/0.144.1", status: ok ? "pass" : "fail" })}\n`);
process.exit(ok ? 0 : 1);
