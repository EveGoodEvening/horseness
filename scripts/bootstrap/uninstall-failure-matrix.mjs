import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeBootstrapV1 } from "../../apps/bootstrap/src/index.ts";
const bundlePath = new URL("../../apps/bootstrap/generated/fixture-release.json", import.meta.url).pathname;
process.env.HORSENESS_PROJECT_TRUST_ROOT = new URL("../../apps/bootstrap/generated/fixture-trust-root.json", import.meta.url).pathname;
process.env.HORSENESS_DAEMON_EXECUTABLE = new URL("../../apps/daemon/bin/horseness-daemon.mjs", import.meta.url).pathname;
const envelope = JSON.parse(await readFile(bundlePath, "utf8"));
for (const point of ["after-kill-switch", "after-discovery-disable", "after-revocation"]) {
  const root = await mkdtemp(join(tmpdir(), `horseness-uninstall-${point}-`)); const workspace = join(root, "workspace"); const home = join(root, "home");
  const installed = await executeBootstrapV1({ command: "install", workspace, createWorkspace: true, host: "all", acceptedReleaseDigest: envelope.signedManifest.manifestDigest, scope: "user", bundlePath, cleanHome: home });
  if (installed.exitCode !== 0) throw new Error(`setup failed at ${point}`);
  try { await executeBootstrapV1({ command: "uninstall", workspace, createWorkspace: false, host: "all", scope: "user", bundlePath, cleanHome: home, crashPoint: point }); } catch {}
  const resumed = await executeBootstrapV1({ command: "uninstall", workspace, createWorkspace: false, host: "all", scope: "user", bundlePath, cleanHome: home });
  if (resumed.exitCode !== 0) throw new Error(`uninstall recovery failed at ${point}`);
  try { const endpoint = JSON.parse(await readFile(join(workspace, ".horseness", "daemon-endpoint.v1.json"), "utf8")); process.kill(endpoint.processId, "SIGTERM"); } catch {}
}
process.stdout.write("Uninstall failure matrix passed\n");
