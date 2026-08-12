import { spawn } from "node:child_process";
import { assertResult } from "./contracts.mjs";

export async function invokeValidator({ executable, fixture, mode, env = {}, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, "--fixture", fixture, "--mode", mode], {
      cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = ""; let stderr = ""; let settled = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("validator timeout")); }, timeoutMs);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", finish);
    child.on("close", (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      const lines = stdout.trimEnd().split("\n").filter(Boolean);
      if (lines.length !== 1) return finish(new Error(`validator emitted ${lines.length} JSON lines`));
      let result;
      try { result = JSON.parse(lines[0]); assertResult(result); }
      catch (error) { return finish(new Error(`invalid validator result: ${error.message}`)); }
      const expectedExit = result.status === "pass" || result.status === "skip" ? 0 : 1;
      if (code !== expectedExit || signal) return finish(new Error(`validator exit mismatch code=${code} signal=${signal ?? "none"}: ${stderr.trim()}`));
      settled = true; resolve({ result, stderr });
    });
    function finish(error) { if (settled) return; settled = true; clearTimeout(timer); reject(error); }
  });
}

export function parseValidatorArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("expected --fixture and --mode");
    args.set(argv[index].slice(2), argv[index + 1]);
  }
  if (args.size !== 2 || !args.has("fixture") || !["hermetic", "live"].includes(args.get("mode"))) throw new Error("expected --fixture <file> --mode hermetic|live");
  return { fixture: args.get("fixture"), mode: args.get("mode") };
}
