import { createDefaultCliCommandRegistryV1 } from "./registry.js";
import { registerLifecycleCliCommandsV1 } from "./commands/lifecycle.js";
import { runCliV1 } from "./runtime.js";
import { AuthorizedLocalTransportV1 } from "./transport.js";

const registry = createDefaultCliCommandRegistryV1();
registerLifecycleCliCommandsV1(registry);

const endpointPath = process.env.HORSENESS_ENDPOINT_PATH ?? ".horseness/daemon.sock";
const workspaceId = process.env.HORSENESS_WORKSPACE_ID ?? "workspace:unbound";
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
});
