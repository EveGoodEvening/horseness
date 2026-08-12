import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { evidenceDigest } from "./contracts.mjs";

export const LIFECYCLE = Object.freeze(["acquire", "verify-provenance", "install", "discover", "load", "inject-context", "attempt", "collect-receipt", "restart", "reconcile", "resume", "fork-switch", "uninstall", "audit-outputs"]);

export async function runSandboxLifecycle({ manifest, root, operations }) {
  const sandboxRoot = resolve(root);
  if (isAbsolute(manifest.sandbox.workRoot)) throw new Error("sandbox work root must be relative");
  await rm(sandboxRoot, { recursive: true, force: true });
  await mkdir(sandboxRoot, { recursive: false, mode: 0o700 });
  const rootReal = await realpath(sandboxRoot);
  const evidence = [];
  const capabilities = Object.fromEntries(manifest.requiredCapabilities.map(name => [name, false]));
  try {
    for (const phase of LIFECYCLE.slice(0, -1)) {
      const operation = operations[phase];
      if (typeof operation !== "function") throw new Error(`missing sandbox lifecycle operation ${phase}`);
      const observation = await operation({ root: rootReal, previous: Object.freeze([...evidence]) });
      assertObservation(phase, observation);
      evidence.push(Object.freeze({ phase, ...observation }));
      for (const capability of observation.observedCapabilities ?? []) {
        if (!(capability in capabilities)) throw new Error(`undeclared observed capability ${capability}`);
        capabilities[capability] = true;
      }
    }
    const outputs = await listFiles(rootReal);
    const unexpected = outputs.filter(path => !manifest.sandbox.allowedOutputs.includes(path));
    if (unexpected.length) throw new Error(`sandbox emitted unexpected output: ${unexpected.join(",")}`);
    evidence.push(Object.freeze({ phase: "audit-outputs", ok: true, outputs }));
    return Object.freeze({ capabilities: Object.freeze(capabilities), evidence: Object.freeze(evidence), evidenceDigest: evidenceDigest({ host: manifest.host, artifact: manifest.artifact.identity, evidence }) });
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

function assertObservation(phase, observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation) || observation.ok !== true) throw new Error(`sandbox phase ${phase} did not produce successful evidence`);
  if (observation.sourcePath !== undefined) {
    if (typeof observation.sourcePath !== "string" || isAbsolute(observation.sourcePath) || observation.sourcePath.split(/[\\/]/).includes("..")) throw new Error(`sandbox phase ${phase} reported unsafe source`);
    if (observation.sourcePath.startsWith("tests/fixtures/") || observation.sourcePath.startsWith("scripts/host-feasibility/")) throw new Error(`sandbox phase ${phase} used repository-authored host impersonation`);
  }
  if (observation.observedCapabilities !== undefined && (!Array.isArray(observation.observedCapabilities) || new Set(observation.observedCapabilities).size !== observation.observedCapabilities.length)) throw new Error(`sandbox phase ${phase} reported invalid capabilities`);
}

async function listFiles(root) {
  const found = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = resolve(dir, entry.name);
      const rel = relative(root, absolute).split(sep).join("/");
      if (rel === ".." || rel.startsWith("../")) throw new Error("sandbox output escaped root");
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`sandbox output contains symlink: ${rel}`);
      if (info.isDirectory()) await visit(absolute);
      else if (info.isFile()) found.push(rel);
      else throw new Error(`sandbox output has unsupported type: ${rel}`);
    }
  }
  await visit(root);
  return found.sort();
}
