const loaderPath = process.argv[2];
const extensionPath = process.argv[3];
const cwd = process.argv[4];
if (!loaderPath || !extensionPath || !cwd) throw new Error("usage: load-native <loader> <extension> <cwd>");
Object.defineProperty(globalThis, Symbol.for("horseness.adapter.omp.native-runtime.v1"), { configurable: true, value: { async deliver() { throw new Error("probe only"); }, async state() { return { attemptKeys: [] }; }, async shutdown() {} } });
const { loadExtensions } = await import(loaderPath); // Exact verified same-distribution interface selected by the smoke harness.
const loaded = await loadExtensions([extensionPath], cwd);
if (loaded.errors.length !== 0 || loaded.extensions.length !== 1) throw new Error(`OMP extension load failed: ${JSON.stringify(loaded.errors)}`);
const extension = loaded.extensions[0]!;
if (!extension.tools.has("horseness_worker_return") || !extension.tools.has("horseness_native_state") || !extension.commands.has("horseness-state") || !extension.handlers.has("agent_start")) throw new Error("OMP native registrations are incomplete");
process.stdout.write(JSON.stringify({ tools: [...extension.tools.keys()], commands: [...extension.commands.keys()], handlers: [...extension.handlers.keys()] }));
