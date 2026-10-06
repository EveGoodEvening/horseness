import { spawnSync } from "node:child_process";
import { createDefaultCliCommandRegistryV1 } from "./registry.js";
import { registerLifecycleCliCommandsV1 } from "./commands/lifecycle.js";
import { registerInstallerCommandsV1 } from "./router.js";
import { runCliV1 } from "./runtime.js";
import { AuthorizedLocalTransportV1 } from "./transport.js";
import type { JsonValue } from "./result.js";

const registry = createDefaultCliCommandRegistryV1();
registerLifecycleCliCommandsV1(registry);
registerInstallerCommandsV1(registry);

const endpointPath = process.env.HORSENESS_ENDPOINT_PATH ?? ".horseness/daemon.sock";
const workspaceId = process.env.HORSENESS_WORKSPACE_ID ?? "workspace:unbound";
const bootstrapExecutable = process.env.HORSENESS_BOOTSTRAP_EXECUTABLE ?? "horseness-bootstrap";
const grantReference = process.env.HORSENESS_GRANT_REFERENCE ?? "grant:unbound";

process.exitCode = await runCliV1(process.argv.slice(2), {
  registry,
  transport: new AuthorizedLocalTransportV1(endpointPath),
  credential: {
    schemaVersion: "1",
    kind: "host-reference",
    reference: grantReference,
    scope: { workspaceId, adapterId: "horseness-cli", purpose: "coordinator" },
  },
  installer: {
    async execute(command, invocation) {
      const args: string[] = [command];
      for (const [name, value] of Object.entries(invocation.options)) { if (name === "json") continue; args.push(`--${name}`); if (typeof value === "string") args.push(value); }
      const child = spawnSync(bootstrapExecutable, args, { encoding: "utf8", env: process.env, windowsHide: true });
      const exitCode = child.status === 0 || child.status === 1 || child.status === 2 || child.status === 3 || child.status === 4 ? child.status : 1;
      let data: JsonValue;
      try { data = JSON.parse(child.stdout) as JsonValue; } catch { data = { code: "BOOTSTRAP_EXECUTION_FAILED", stderr: child.stderr.slice(0, 4096) }; }
      return { exitCode, data };
    },
  },
});
