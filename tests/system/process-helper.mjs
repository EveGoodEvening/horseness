import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

export const repositoryRoot = resolve(import.meta.dirname, "../..");

export async function runCommand(command, args, options = {}) {
  const { timeoutMs = 180_000, env = {}, maxOutputBytes = 8 * 1024 * 1024 } = options;
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let overflow = false;
  function capture(chunk, channel) {
    outputBytes += chunk.length;
    if (outputBytes > maxOutputBytes) {
      overflow = true;
      child.kill("SIGKILL");
      return;
    }

    if (channel === "stdout") {
      stdout += chunk.toString("utf8");
    } else {
      stderr += chunk.toString("utf8");
    }
  }

  child.stdout.on("data", (chunk) => capture(chunk, "stdout"));
  child.stderr.on("data", (chunk) => capture(chunk, "stderr"));
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal }));
  });
  clearTimeout(timer);
  assert.equal(overflow, false, `${command} exceeded the ${maxOutputBytes}-byte aggregate output bound`);
  return { ...result, stdout, stderr };
}

export async function requireSuccess(label, command, args, options) {
  const result = await runCommand(command, args, options);
  assert.equal(result.signal, null, `${label} terminated by ${result.signal}\n${result.stderr}`);
  assert.equal(result.code, 0, `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

export function requirePackageTests(group) {
  const args = [
    "pnpm",
    "--filter",
    group.packageName,
    "exec",
    "node",
    "--import",
    "tsx",
    "--test",
    ...group.files,
  ];
  return requireSuccess(group.name, "corepack", args, { timeoutMs: 230_000 });
}

export function jsonObjects(text) {
  const values = [];
  for (const line of text.split(/\r?\n/u)) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) {
      continue;
    }

    try {
      values.push(JSON.parse(candidate));
    } catch {
      // pnpm and native hosts may emit non-JSON status lines.
    }
  }
  return values;
}
