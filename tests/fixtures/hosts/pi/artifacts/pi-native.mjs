#!/usr/bin/env node
const args = new Set(process.argv.slice(2));
if (!args.has("--horseness-native-probe")) process.exit(64);
process.stdout.write(JSON.stringify({
  schemaVersion: "PiNativeProbeV1",
  package: "@mariozechner/pi-coding-agent",
  version: "0.73.1",
  entrypoint: "dist/cli.js",
  extensionLoader: "dist/core/extensions/loader.js",
  sessionRuntime: "dist/core/agent-session-runtime.js",
  rpcMode: "dist/modes/rpc/rpc-mode.js",
  native: true,
  cliFallback: false
}) + "\n");
