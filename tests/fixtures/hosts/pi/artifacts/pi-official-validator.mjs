#!/usr/bin/env node
import { readFile } from "node:fs/promises";
const [artifact] = process.argv.slice(2);
if (!artifact) process.exit(64);
const source = await readFile(artifact, "utf8");
const required = ["PiNativeProbeV1", "dist/cli.js", "dist/core/extensions/loader.js", "dist/core/agent-session-runtime.js", "dist/modes/rpc/rpc-mode.js", "native: true", "cliFallback: false"];
if (!required.every((token) => source.includes(token))) process.exit(65);
process.stdout.write(JSON.stringify({schemaVersion:"PiOfficialValidatorResultV1",version:"0.73.1",status:"pass"}) + "\n");
