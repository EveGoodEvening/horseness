import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = await mkdtemp(join(tmpdir(), "horseness-doctor-packed-"));
const workspace = join(root, "missing-workspace");
const home = join(root, "missing-home");
const executable = resolve(import.meta.dirname, "../../apps/bootstrap/dist/horseness-bootstrap.mjs");
const result = spawnSync(process.execPath, [executable, "doctor", "--manifest", "https://127.0.0.1:9/never-fetch", "--workspace", workspace, "--scope", "user", "--clean-home", home], { encoding: "utf8", timeout: 30_000, env: { ...process.env, HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", NO_PROXY: "", no_proxy: "" } });
if (result.status !== 1) throw new Error(`packed doctor returned ${String(result.status)}: ${result.stderr}`);
const value = JSON.parse(result.stdout);
if (value.schema !== "horseness.doctor-result.v1" || value.healthy || value.findings.length !== 4 || value.findings.some((finding) => finding.code !== "MISSING")) throw new Error("packed doctor did not report missing state purely");
for (const path of [workspace, home]) {
  try { await access(path); throw new Error(`doctor created ${path}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
await rm(root, { recursive: true, force: true });
process.stdout.write("Packed doctor hostile no-side-effects passed\n");
