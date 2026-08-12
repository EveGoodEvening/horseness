import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const [packageRoot, extensionPath, statePath, inputPath, providerPath] = process.argv.slice(2);
process.env.HORSENESS_PI_STATE = statePath;
process.env.HORSENESS_PI_INPUT = await readFile(inputPath, "utf8");
process.env.HORSENESS_PI_PROVIDER = await readFile(providerPath, "utf8");

const loaderUrl = pathToFileURL(`${packageRoot}/dist/core/extensions/loader.js`).href;
const { loadExtensions } = await import(loaderUrl);
const loaded = await loadExtensions([extensionPath], process.cwd());
if (loaded.errors.length || loaded.extensions.length !== 1) throw new Error(`extension load failed: ${JSON.stringify(loaded.errors)}`);
const extension = loaded.extensions[0];
const ctx = Object.freeze({});
const emit = async (name, event) => {
  for (const handler of extension.handlers.get(name) ?? []) await handler(event, ctx);
};

await writeFile(statePath, `${JSON.stringify({ events: [], installed: true })}\n`);
await emit("session_start", { type: "session_start", reason: "startup" });
const starts = extension.handlers.get("before_agent_start") ?? [];
const results = [];
for (const handler of starts) results.push(await handler({ type: "before_agent_start", prompt: "deterministic" }, ctx));
await emit("session_before_fork", { type: "session_before_fork", entryId: "fork-entry-1", position: "at" });
await emit("session_start", { type: "session_start", reason: "fork", previousSessionFile: "session-a.jsonl" });
await emit("session_start", { type: "session_start", reason: "resume", previousSessionFile: "session-b.jsonl" });
await emit("session_start", { type: "session_start", reason: "reload" });
await emit("session_shutdown", { type: "session_shutdown" });
const state = JSON.parse(await readFile(statePath, "utf8"));
state.results = results;
state.loaded = { path: extension.path, resolvedPath: extension.resolvedPath, handlerNames: [...extension.handlers.keys()].sort() };
state.installed = false;
await writeFile(statePath, `${JSON.stringify(state)}\n`);
process.stdout.write(`${JSON.stringify(state)}\n`);
