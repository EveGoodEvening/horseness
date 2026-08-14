import { readFile } from "node:fs/promises";
const input = JSON.parse(await new Promise((resolve, reject) => { let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => resolve(value)); process.stdin.on("error", reject); }));
const path = process.env.HORSENESS_CLAUDE_CONTEXT_FILE;
if (typeof path !== "string" || path.length === 0) throw new Error("HORSENESS_CONTEXT_UNAVAILABLE");
const context = JSON.parse(await readFile(path, "utf8"));
if (context.schemaVersion !== "HorsenessClaudeContextV1" || typeof context.renderedContext !== "string" || Buffer.byteLength(context.renderedContext) > 4096) throw new Error("HORSENESS_CONTEXT_INVALID");
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `[horseness-context-v1 session=${input.session_id} source=${input.source ?? "startup"}]\n${context.renderedContext}` } }));
